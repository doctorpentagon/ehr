const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');

// Households are demographic/billing structure, so they follow the same
// permission as patient demographics rather than clinical write.
const read = [authenticate, tenant, requirePermission('patients')];
const write = [authenticate, tenant, requirePermission('patient_demographics_write')];

function audit(req, action, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId, action,
      resource: 'Household', resourceId, reason: reason || 'Household management', ip: req.ip,
    },
  }).catch(() => {});
}

const MEMBER_SELECT = {
  id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true,
  dateOfBirth: true, gender: true, phone: true, relationship: true, status: true,
};

router.get('/', read, async (req, res, next) => {
  try {
    const { search, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { members: { some: { universalPatientId: { contains: search, mode: 'insensitive' } } } },
        { members: { some: { phone: { contains: search, mode: 'insensitive' } } } },
        { members: { some: { lastName: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    const households = await prisma.household.findMany({
      where, take: Math.min(Number(limit) || 20, 50), orderBy: { name: 'asc' },
      include: { members: { select: MEMBER_SELECT, orderBy: { createdAt: 'asc' } } },
    });
    res.json({ households, total: households.length });
  } catch (e) { next(e); }
});

router.get('/:id', read, async (req, res, next) => {
  try {
    const household = await prisma.household.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { members: { select: MEMBER_SELECT, orderBy: { createdAt: 'asc' } } },
    });
    if (!household) return res.status(404).json({ error: 'Household not found' });
    res.json(household);
  } catch (e) { next(e); }
});

// Aggregated, read-only family history across every member of the household.
router.get('/:id/family-history', read, async (req, res, next) => {
  try {
    const household = await prisma.household.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { members: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true, relationship: true } } },
    });
    if (!household) return res.status(404).json({ error: 'Household not found' });

    const memberIds = household.members.map((m) => m.id);
    if (!memberIds.length) return res.json({ household, allergies: [], conditions: [], recentCases: [] });

    const [allergies, conditions, recentCases] = await prisma.$transaction([
      prisma.allergy.findMany({
        where: { patientId: { in: memberIds } },
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.condition.findMany({
        where: { patientId: { in: memberIds } },
        include: { patient: { select: { id: true, firstName: true, lastName: true } } },
      }),
      prisma.case.findMany({
        where: { patientId: { in: memberIds }, facilityId: req.ctx.facilityId },
        orderBy: { createdAt: 'desc' }, take: 20,
        select: {
          id: true, title: true, status: true, encounterType: true, createdAt: true, icdCodes: true,
          patient: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    audit(req, 'household.family_history.view', household.id, 'Family history reviewed');
    res.json({ household, allergies, conditions, recentCases });
  } catch (e) { next(e); }
});

router.post('/', write, async (req, res, next) => {
  try {
    const { name, principalPatientId, address, phone, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Household name is required' });

    let principal = null;
    if (principalPatientId) {
      principal = await requireTenantPatient(req.ctx.facilityId, principalPatientId);
    }

    const household = await prisma.$transaction(async (tx) => {
      const created = await tx.household.create({
        data: {
          facilityId: req.ctx.facilityId,
          name,
          principalPatientId: principal?.id || null,
          address: address || principal?.address || null,
          phone: phone || principal?.phone || null,
          notes: notes || null,
        },
      });
      if (principal) {
        await tx.patient.update({
          where: { id: principal.id },
          data: { householdId: created.id, relationship: 'PRINCIPAL' },
        });
      }
      return created;
    });

    audit(req, 'household.create', household.id);
    res.status(201).json(household);
  } catch (e) { next(e); }
});

// Add an existing patient to a household, or move them between households.
router.post('/:id/members', write, async (req, res, next) => {
  try {
    const { patientId, relationship, inheritInsurance } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const household = await prisma.household.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!household) return res.status(404).json({ error: 'Household not found' });
    const patient = await requireTenantPatient(req.ctx.facilityId, patientId);

    const rel = relationship || 'DEPENDENT';
    // A household has exactly one principal.
    if (rel === 'PRINCIPAL' && household.principalPatientId && household.principalPatientId !== patient.id) {
      return res.status(409).json({ error: 'This household already has a principal. Change the existing principal first.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.patient.update({
        where: { id: patient.id },
        data: { householdId: household.id, relationship: rel },
      });
      if (rel === 'PRINCIPAL') {
        await tx.household.update({ where: { id: household.id }, data: { principalPatientId: p.id } });
      }

      // A dependant normally sits on the principal's policy.
      if (inheritInsurance && household.principalPatientId && household.principalPatientId !== p.id) {
        const principalPolicy = await tx.insurance.findFirst({
          where: { patientId: household.principalPatientId, isActive: true },
          orderBy: { createdAt: 'desc' },
        });
        if (principalPolicy) {
          const alreadyHas = await tx.insurance.findFirst({ where: { patientId: p.id, isActive: true } });
          if (!alreadyHas) {
            await tx.insurance.create({
              data: {
                facilityId: req.ctx.facilityId,
                patientId: p.id,
                provider: principalPolicy.provider,
                planName: principalPolicy.planName,
                policyNumber: principalPolicy.policyNumber,
                principalInsured: false,
                inheritedFromPatientId: household.principalPatientId,
                validFrom: principalPolicy.validFrom,
                validTo: principalPolicy.validTo,
                coverageDetails: principalPolicy.coverageDetails,
                authorizationRequired: principalPolicy.authorizationRequired,
              },
            });
          }
        }
      }
      return p;
    });

    audit(req, 'household.member.add', household.id, `${rel} added`);
    res.status(201).json(updated);
  } catch (e) { next(e); }
});

router.delete('/:id/members/:patientId', write, async (req, res, next) => {
  try {
    const household = await prisma.household.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!household) return res.status(404).json({ error: 'Household not found' });
    const patient = await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    if (patient.householdId !== household.id) {
      return res.status(409).json({ error: 'That patient is not in this household' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.patient.update({ where: { id: patient.id }, data: { householdId: null, relationship: null } });
      if (household.principalPatientId === patient.id) {
        await tx.household.update({ where: { id: household.id }, data: { principalPatientId: null } });
      }
    });

    audit(req, 'household.member.remove', household.id);
    res.json({ message: 'Removed from household' });
  } catch (e) { next(e); }
});

module.exports = router;
