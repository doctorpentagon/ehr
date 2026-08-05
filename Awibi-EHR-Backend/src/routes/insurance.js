const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');

// Insurance is administrative/billing data, not clinical — a doctor should not
// be editing a policy. Reads follow patient access; writes follow demographics.
const read = [authenticate, tenant, requirePermission('patients')];
const write = [authenticate, tenant, requirePermission('patient_demographics_write')];
const adminRead = [authenticate, tenant, requirePermission('billing')];

function audit(req, action, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId, action,
      resource: 'Insurance', resourceId, reason: reason || 'Insurance record', ip: req.ip,
    },
  }).catch(() => {});
}

// Report first — declared before '/:id' so "report" is not read as an id.
router.get('/report', adminRead, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const policies = await prisma.insurance.findMany({
      where: { facilityId: fid, isActive: true },
      select: { provider: true, planName: true, patientId: true },
    });

    const byProvider = new Map();
    for (const p of policies) {
      const entry = byProvider.get(p.provider) || { provider: p.provider, patients: new Set(), plans: new Set() };
      entry.patients.add(p.patientId);
      if (p.planName) entry.plans.add(p.planName);
      byProvider.set(p.provider, entry);
    }

    // Billed/collected per provider, computed from that provider's patients.
    const rows = [];
    for (const entry of byProvider.values()) {
      const patientIds = [...entry.patients];
      const totals = await prisma.invoice.aggregate({
        _sum: { total: true, amountPaid: true, balance: true },
        _count: { _all: true },
        where: { facilityId: fid, patientId: { in: patientIds } },
      });
      rows.push({
        provider: entry.provider,
        plans: [...entry.plans],
        patients: patientIds.length,
        invoices: totals._count._all,
        billed: Number(totals._sum.total || 0),
        collected: Number(totals._sum.amountPaid || 0),
        outstanding: Number(totals._sum.balance || 0),
      });
    }
    rows.sort((a, b) => b.patients - a.patients);

    const uninsured = await prisma.patient.count({
      where: { facilityId: fid, isArchived: false, insurances: { none: { isActive: true } } },
    });

    res.json({ providers: rows, uninsuredPatients: uninsured, totalProviders: rows.length });
  } catch (e) { next(e); }
});

router.get('/report.csv', adminRead, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const policies = await prisma.insurance.findMany({
      where: { facilityId: fid, isActive: true },
      include: { patient: { select: { firstName: true, lastName: true, universalPatientId: true } } },
      orderBy: [{ provider: 'asc' }],
    });

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Provider', 'Plan', 'Policy number', 'Patient', 'UPID', 'Principal insured', 'Valid from', 'Valid to', 'Coverage'];
    const lines = policies.map((p) => [
      p.provider, p.planName, p.policyNumber,
      `${p.patient.firstName} ${p.patient.lastName}`, p.patient.universalPatientId,
      p.principalInsured ? 'Yes' : 'No',
      p.validFrom ? new Date(p.validFrom).toISOString().slice(0, 10) : '',
      p.validTo ? new Date(p.validTo).toISOString().slice(0, 10) : '',
      Object.entries(p.coverageDetails || {}).map(([k, v]) => `${k}: ${v}`).join('; '),
    ].map(esc).join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="insurance-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header.map(esc).join(','), ...lines].join('\n'));
  } catch (e) { next(e); }
});

router.get('/patient/:patientId', read, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const insurances = await prisma.insurance.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ insurances, active: insurances.find((i) => i.isActive) || null });
  } catch (e) { next(e); }
});

router.post('/', write, async (req, res, next) => {
  try {
    const {
      patientId, provider, planName, policyNumber, principalInsured,
      validFrom, validTo, coverageDetails, authorizationRequired, notes,
    } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!provider) return res.status(400).json({ error: 'provider is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);

    if (validFrom && validTo && new Date(validTo) < new Date(validFrom)) {
      return res.status(400).json({ error: 'validTo cannot be before validFrom' });
    }

    const insurance = await prisma.$transaction(async (tx) => {
      // One active policy at a time keeps billing unambiguous.
      await tx.insurance.updateMany({
        where: { patientId, isActive: true },
        data: { isActive: false },
      });
      return tx.insurance.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, provider,
          planName: planName || null,
          policyNumber: policyNumber || null,
          principalInsured: principalInsured !== false,
          validFrom: validFrom ? new Date(validFrom) : null,
          validTo: validTo ? new Date(validTo) : null,
          coverageDetails: coverageDetails && typeof coverageDetails === 'object' ? coverageDetails : {},
          authorizationRequired: Boolean(authorizationRequired),
          notes: notes || null,
        },
      });
    });

    audit(req, 'insurance.create', insurance.id, `${provider} policy recorded`);
    res.status(201).json(insurance);
  } catch (e) { next(e); }
});

router.put('/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.insurance.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Insurance record not found' });

    const { id, facilityId, patientId, createdAt, updatedAt, ...data } = req.body;
    if (data.validFrom) data.validFrom = new Date(data.validFrom);
    if (data.validTo) data.validTo = new Date(data.validTo);

    const insurance = await prisma.insurance.update({ where: { id: existing.id }, data });
    audit(req, 'insurance.update', insurance.id);
    res.json(insurance);
  } catch (e) { next(e); }
});

// Placeholder until an approved provider integration exists. It records the
// request so the audit trail is honest about what was and was not verified.
router.post('/:id/check-eligibility', write, async (req, res, next) => {
  try {
    const existing = await prisma.insurance.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Insurance record not found' });

    audit(req, 'insurance.eligibility.request', existing.id, 'Eligibility check requested (no provider integration)');
    res.json({
      checked: false,
      status: 'NOT_VERIFIED',
      message: 'Eligibility was not verified. No insurance provider integration is configured — confirm cover with the provider directly.',
      provider: existing.provider,
      policyNumber: existing.policyNumber,
      requestedAt: new Date(),
    });
  } catch (e) { next(e); }
});

module.exports = router;
