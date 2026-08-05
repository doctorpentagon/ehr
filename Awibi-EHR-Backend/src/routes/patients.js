const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { ensureUniqueUPID } = require('../utils/upid');
const { requireTenantPatient, requireTenantCase } = require('../utils/tenantRecords');
const { normalizeVitals } = require('../utils/vitals');
const {
  normalisePhone, validateDateOfBirth, ageInYears, createPatientWithMrn,
} = require('../utils/patientValidation');

const auth = [authenticate, tenant, requirePermission('patients')];
const demographicsWriteAuth = [authenticate, tenant, requirePermission('patient_demographics_write')];
const vitalsWriteAuth = [authenticate, tenant, requirePermission('vitals_write')];
const clinicalWriteAuth = [authenticate, tenant, requirePermission('clinical_write')];
const prescriptionsWriteAuth = [authenticate, tenant, requirePermission('prescriptions_write')];

const IDENTITY_URL = process.env.IDENTITY_BACKEND_URL || 'http://localhost:8001';

// GET /v1/patients
router.get('/', auth, async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const fid = req.ctx.facilityId;
    const where = { facilityId: fid, isArchived: false };
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { universalPatientId: { contains: search, mode: 'insensitive' } },
        { mrn: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, patients] = await prisma.$transaction([
      prisma.patient.count({ where }),
      prisma.patient.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({ patients, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { next(e); }
});

// Type-ahead patient picker. Deliberately separate from GET '/' because it
// returns only the handful of fields a picker renders — loading full patient
// records into a dropdown does not scale past a few hundred patients.
// Declared before '/:id' so "lookup" is never parsed as a record id.
router.get('/lookup', auth, async (req, res, next) => {
  try {
    const { q, limit = 8 } = req.query;
    const term = (q || '').trim();
    if (term.length < 2) return res.json({ patients: [], total: 0, query: term });

    const where = {
      facilityId: req.ctx.facilityId,
      isArchived: false,
      OR: [
        { universalPatientId: { contains: term, mode: 'insensitive' } },
        { mrn: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
      ],
    };

    const patients = await prisma.patient.findMany({
      where,
      take: Math.min(Number(limit) || 8, 25),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true, firstName: true, lastName: true, universalPatientId: true,
        mrn: true, phone: true, dateOfBirth: true, gender: true, status: true, avatar: true,
      },
    });

    // An exact UPID/MRN match should always sort first — that is the fastest
    // path for staff who already know the identifier.
    const upper = term.toUpperCase();
    patients.sort((a, b) => {
      const aExact = a.universalPatientId?.toUpperCase() === upper || a.mrn?.toUpperCase() === upper;
      const bExact = b.universalPatientId?.toUpperCase() === upper || b.mrn?.toUpperCase() === upper;
      return (bExact ? 1 : 0) - (aExact ? 1 : 0);
    });

    res.json({ patients, total: patients.length, query: term });
  } catch (e) { next(e); }
});

// GET /v1/patients/resolve/:query
router.get('/resolve/:query', auth, async (req, res, next) => {
  try {
    const q = req.params.query.toUpperCase().trim();
    const fid = req.ctx.facilityId;
    const patient = await prisma.patient.findFirst({
      where: {
        facilityId: fid,
        isArchived: false,
        OR: [
          { universalPatientId: q },
          { mrn: q },
          { nin: q },
          { phone: { contains: req.params.query, mode: 'insensitive' } },
        ],
      },
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found', register: true });
    prisma.auditLog.create({ data: { facilityId: fid, userId: req.ctx.userId, action: 'patient.resolve', resource: 'Patient', resourceId: patient.id, reason: req.query.reason || 'Treatment', ip: req.ip } }).catch(() => {});
    res.json(patient);
  } catch (e) { next(e); }
});

// GET /v1/patients/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const patient = await prisma.patient.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId, isArchived: false },
      include: {
        vitals: { orderBy: { recordedAt: 'desc' }, take: 10 },
        allergies: true,
        conditions: true,
        prescriptions: { orderBy: { createdAt: 'desc' }, take: 10 },
        appointments: {
          orderBy: { scheduledAt: 'desc' }, take: 10,
          include: { doctor: { select: { id: true, firstName: true, lastName: true } } },
        },
        labRequests: { orderBy: { createdAt: 'desc' }, take: 10 },
        cases: {
          orderBy: { createdAt: 'desc' }, take: 10,
          include: { author: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    prisma.auditLog.create({ data: { facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'patient.view', resource: 'Patient', resourceId: patient.id, reason: req.query.reason || 'Treatment', ip: req.ip } }).catch(() => {});
    res.json(patient);
  } catch (e) { next(e); }
});

// POST /v1/patients
router.post('/', demographicsWriteAuth, async (req, res, next) => {
  try {
    const { firstName, lastName, dateOfBirth, gender, phone, email, address, state, nin, hmo,
      bloodType, height, weight, maritalStatus, religion, emergencyContactName, emergencyContactPhone,
      emergencyContactRelation, entryMode, status } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ error: 'firstName and lastName are required' });

    // Identity data is validated hard: it is what staff use to find this person
    // again, and a typo here becomes permanent.
    const phoneCheck = normalisePhone(phone);
    if (!phoneCheck.ok) return res.status(400).json({ error: phoneCheck.error, field: 'phone' });

    const dobCheck = validateDateOfBirth(dateOfBirth);
    if (!dobCheck.ok) return res.status(400).json({ error: dobCheck.error, field: 'dateOfBirth' });

    const emergencyPhoneCheck = normalisePhone(emergencyContactPhone);
    if (!emergencyPhoneCheck.ok) {
      return res.status(400).json({ error: `Emergency contact: ${emergencyPhoneCheck.error}`, field: 'emergencyContactPhone' });
    }

    // A shared phone number is normal in Nigeria — a family line, a neighbour's
    // handset — so this warns rather than blocks, and names who else has it so
    // the receptionist can tell a family member from a genuine duplicate.
    const warnings = [];
    if (phoneCheck.value) {
      const sharing = await prisma.patient.findMany({
        where: { facilityId: req.ctx.facilityId, phone: phoneCheck.value, isArchived: false },
        select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true },
        take: 5,
      });
      if (sharing.length) {
        warnings.push({
          code: 'DUPLICATE_PHONE',
          message: `${sharing.length} existing patient${sharing.length === 1 ? '' : 's'} already use this phone number. Check this is not the same person before continuing.`,
          matches: sharing,
        });
      }
    }

    const sub = await prisma.subscription.findUnique({ where: { facilityId: req.ctx.facilityId } });
    if (sub) {
      // Count the patients that actually exist rather than trusting a running
      // total. A stored counter only ever drifts upward — a data migration, an
      // archived record, any removal outside this route — and a drifted counter
      // refuses registrations from a facility that is genuinely under its limit.
      // Turning a paying hospital away from the front desk over a bookkeeping
      // error is far worse than counting rows.
      const actual = await prisma.patient.count({
        where: { facilityId: req.ctx.facilityId, isArchived: false },
      });
      if (actual >= sub.patientLimit) {
        return res.status(402).json({
          error: 'Patient limit reached. Upgrade your plan to add more patients.',
          code: 'PATIENT_LIMIT',
          used: actual,
          limit: sub.patientLimit,
        });
      }
      // Repair the stored figure when it has drifted, so dashboards agree with
      // the gate rather than quietly disagreeing.
      if (sub.patientsUsed !== actual) {
        await prisma.subscription.update({
          where: { facilityId: req.ctx.facilityId }, data: { patientsUsed: actual },
        }).catch(() => {});
      }
    }

    let universalPatientId = null;
    if (nin) {
      try {
        const idRes = await fetch(`${IDENTITY_URL}/v1/identity/lookup/${encodeURIComponent(nin)}`, {
          headers: {
            'x-awibi-secret': process.env.AWIBI_SHARED_SECRET,
            'x-facility-id': req.ctx.facilityId,
          },
          signal: AbortSignal.timeout(3000),
        });
        if (idRes.ok) {
          const idData = await idRes.json();
          if (idData?.patient?.universalPatientId) universalPatientId = idData.patient.universalPatientId;
        }
      } catch { /* Identity Backend unreachable — degrade gracefully */ }
    }
    if (!universalPatientId) universalPatientId = await ensureUniqueUPID();

    // MRN allocation is serialised per facility — see createPatientWithMrn for
    // why counting rows was unsafe.
    const patient = await createPatientWithMrn(prisma, req.ctx.facilityId, {
      universalPatientId,
      firstName, lastName,
      dateOfBirth: dobCheck.value,
      gender, email, address, state, nin, hmo,
      phone: phoneCheck.value,
      bloodType, height: height ? Number(height) : null, weight: weight ? Number(weight) : null,
      maritalStatus, religion,
      emergencyContactName,
      emergencyContactPhone: emergencyPhoneCheck.value,
      emergencyContactRelation,
      entryMode: entryMode || 'WALK_IN', status: status || 'OUT_PATIENT',
    });

    if (sub) {
      await prisma.subscription.update({ where: { facilityId: req.ctx.facilityId }, data: { patientsUsed: { increment: 1 } } });
    }

    // A patient under 18 needs a guardian on file; surface that to the UI so the
    // form can prompt for it rather than relying on the receptionist to remember.
    const age = ageInYears(dobCheck.value);
    if (age !== null && age < 18 && !emergencyContactName) {
      warnings.push({
        code: 'GUARDIAN_REQUIRED',
        message: `This patient is ${age} year${age === 1 ? '' : 's'} old. Record a parent or guardian as the emergency contact.`,
      });
    }

    res.status(201).json(warnings.length ? { ...patient, warnings } : patient);
  } catch (e) { next(e); }
});

// PUT /v1/patients/:id
router.put('/:id', demographicsWriteAuth, async (req, res, next) => {
  try {
    const exists = await prisma.patient.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId, isArchived: false } });
    if (!exists) return res.status(404).json({ error: 'Patient not found' });
    const { id, facilityId, universalPatientId, mrn, createdAt, updatedAt, ...data } = req.body;

    // The same identity rules as registration — an edit must not be a way to
    // slip past validation that creation enforces.
    if (data.phone !== undefined) {
      const check = normalisePhone(data.phone);
      if (!check.ok) return res.status(400).json({ error: check.error, field: 'phone' });
      data.phone = check.value;
    }
    if (data.emergencyContactPhone !== undefined) {
      const check = normalisePhone(data.emergencyContactPhone);
      if (!check.ok) return res.status(400).json({ error: `Emergency contact: ${check.error}`, field: 'emergencyContactPhone' });
      data.emergencyContactPhone = check.value;
    }
    if (data.dateOfBirth !== undefined) {
      const check = validateDateOfBirth(data.dateOfBirth);
      if (!check.ok) return res.status(400).json({ error: check.error, field: 'dateOfBirth' });
      data.dateOfBirth = check.value;
    }

    if (data.height !== undefined) data.height = data.height ? Number(data.height) : null;
    if (data.weight !== undefined) data.weight = data.weight ? Number(data.weight) : null;
    const patient = await prisma.patient.update({ where: { id: req.params.id }, data });
    res.json(patient);
  } catch (e) { next(e); }
});

// DELETE /v1/patients/:id
router.delete('/:id', demographicsWriteAuth, async (req, res, next) => {
  try {
    const exists = await prisma.patient.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId, isArchived: false } });
    if (!exists) return res.status(404).json({ error: 'Patient not found' });
    await prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id: req.params.id },
        data: { isArchived: true, archivedAt: new Date(), archivedById: req.ctx.userId },
      });
      await tx.subscription.updateMany({
        where: { facilityId: req.ctx.facilityId, patientsUsed: { gt: 0 } },
        data: { patientsUsed: { decrement: 1 } },
      });
      await tx.auditLog.create({
        data: {
          facilityId: req.ctx.facilityId, userId: req.ctx.userId,
          action: 'patient.archive', resource: 'Patient', resourceId: req.params.id,
          reason: req.body?.reason || 'Administrative archive', ip: req.ip,
        },
      });
    });
    res.json({ message: 'Patient archived' });
  } catch (e) { next(e); }
});

router.get('/archived/list', demographicsWriteAuth, async (req, res, next) => {
  try {
    const patients = await prisma.patient.findMany({
      where: { facilityId: req.ctx.facilityId, isArchived: true },
      orderBy: { archivedAt: 'desc' },
    });
    res.json(patients);
  } catch (e) { next(e); }
});

router.put('/:id/restore', demographicsWriteAuth, async (req, res, next) => {
  try {
    const restored = await prisma.$transaction(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: req.params.id, facilityId: req.ctx.facilityId, isArchived: true },
      });
      if (!patient) throw Object.assign(new Error('Archived patient not found'), { status: 404 });
      const subscription = await tx.subscription.findUnique({ where: { facilityId: req.ctx.facilityId } });
      if (subscription) {
        // Counted, not tracked — same reason as registration: a drifted total
        // would refuse to restore a record the facility has room for.
        const actual = await tx.patient.count({
          where: { facilityId: req.ctx.facilityId, isArchived: false },
        });
        if (actual >= subscription.patientLimit) {
          throw Object.assign(new Error('Patient limit reached. Upgrade your plan before restoring this patient.'), { status: 402 });
        }
      }
      const updated = await tx.patient.update({
        where: { id: req.params.id },
        data: { isArchived: false, archivedAt: null, archivedById: null },
      });
      if (subscription) {
        await tx.subscription.update({
          where: { facilityId: req.ctx.facilityId },
          data: { patientsUsed: { increment: 1 } },
        });
      }
      await tx.auditLog.create({
        data: {
          facilityId: req.ctx.facilityId, userId: req.ctx.userId,
          action: 'patient.restore', resource: 'Patient', resourceId: req.params.id,
          reason: req.body?.reason || 'Administrative restore', ip: req.ip,
        },
      });
      return updated;
    });
    res.json(restored);
  } catch (e) { next(e); }
});

// ── Vitals ─────────────────────────────────────────────────────────────────────
router.get('/:id/vitals', auth, async (req, res, next) => {
  try {
    const vitals = await prisma.vitals.findMany({
      where: { patientId: req.params.id, facilityId: req.ctx.facilityId },
      orderBy: { recordedAt: 'desc' },
    });
    res.json(vitals);
  } catch (e) { next(e); }
});

router.post('/:id/vitals', vitalsWriteAuth, async (req, res, next) => {
  try {
    const { bloodPressureSystolic, bloodPressureDiastolic, heartRate, respiratoryRate, temperature,
      oxygenSaturation, height, weight, bloodGlucose, notes, caseId } = req.body;
    await requireTenantPatient(req.ctx.facilityId, req.params.id);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, req.params.id);
    const normalized = normalizeVitals({
      bloodPressureSystolic, bloodPressureDiastolic, heartRate, respiratoryRate,
      temperature, oxygenSaturation, height, weight, bloodGlucose,
    });
    const v = await prisma.vitals.create({
      data: {
        facilityId: req.ctx.facilityId, patientId: req.params.id, recordedById: req.ctx.userId, caseId: caseId || null,
        ...normalized,
        notes,
      },
    });
    res.status(201).json(v);
  } catch (e) { next(e); }
});

// ── Allergies ──────────────────────────────────────────────────────────────────
router.get('/:id/allergies', auth, async (req, res, next) => {
  try { res.json(await prisma.allergy.findMany({ where: { patientId: req.params.id, facilityId: req.ctx.facilityId } })); } catch (e) { next(e); }
});
router.post('/:id/allergies', clinicalWriteAuth, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.id);
    const { substance, allergen, severity, reaction, notes } = req.body;
    res.status(201).json(await prisma.allergy.create({ data: { patientId: req.params.id, facilityId: req.ctx.facilityId, substance: substance || allergen, severity, reaction, notes } }));
  } catch (e) { next(e); }
});
router.delete('/:id/allergies/:aid', clinicalWriteAuth, async (req, res, next) => {
  try {
    await prisma.allergy.deleteMany({ where: { id: req.params.aid, patientId: req.params.id, facilityId: req.ctx.facilityId } });
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

// ── Conditions ─────────────────────────────────────────────────────────────────
router.get('/:id/conditions', auth, async (req, res, next) => {
  try { res.json(await prisma.condition.findMany({ where: { patientId: req.params.id, facilityId: req.ctx.facilityId } })); } catch (e) { next(e); }
});
router.post('/:id/conditions', clinicalWriteAuth, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.id);
    const { name, icdCode, status, onsetDate, notes } = req.body;
    res.status(201).json(await prisma.condition.create({
      data: { patientId: req.params.id, facilityId: req.ctx.facilityId, name, icdCode, status, onsetDate: onsetDate ? new Date(onsetDate) : null, notes },
    }));
  } catch (e) { next(e); }
});
router.put('/:id/conditions/:cid', clinicalWriteAuth, async (req, res, next) => {
  try {
    const exists = await prisma.condition.findFirst({ where: { id: req.params.cid, patientId: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { id, patientId, facilityId, createdAt, updatedAt, ...data } = req.body;
    if (data.onsetDate) data.onsetDate = new Date(data.onsetDate);
    const c = await prisma.condition.update({ where: { id: req.params.cid }, data });
    res.json(c);
  } catch (e) { next(e); }
});

// ── Prescriptions ──────────────────────────────────────────────────────────────
router.get('/:id/prescriptions', auth, async (req, res, next) => {
  try {
    res.json(await prisma.prescription.findMany({ where: { patientId: req.params.id, facilityId: req.ctx.facilityId }, orderBy: { createdAt: 'desc' } }));
  } catch (e) { next(e); }
});
router.post('/:id/prescriptions', prescriptionsWriteAuth, async (req, res, next) => {
  try {
    const { drugName, medicationName, dosage, frequency, duration, route, status, instructions, notes, caseId } = req.body;
    await requireTenantPatient(req.ctx.facilityId, req.params.id);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, req.params.id);
    res.status(201).json(await prisma.prescription.create({
      data: {
        patientId: req.params.id, facilityId: req.ctx.facilityId, prescribedById: req.ctx.userId,
        drugName: drugName || medicationName, dosage, frequency, duration, route,
        status, instructions: instructions || notes, caseId: caseId || null,
      },
    }));
  } catch (e) { next(e); }
});
router.put('/:id/prescriptions/:pid', prescriptionsWriteAuth, async (req, res, next) => {
  try {
    const exists = await prisma.prescription.findFirst({ where: { id: req.params.pid, patientId: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { id, patientId, facilityId, createdAt, updatedAt, startDate, endDate, refills, medicationName, allergen, ...data } = req.body;
    if (medicationName && !data.drugName) data.drugName = medicationName;
    const p = await prisma.prescription.update({ where: { id: req.params.pid }, data });
    res.json(p);
  } catch (e) { next(e); }
});

module.exports = router;
