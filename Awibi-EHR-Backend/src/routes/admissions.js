const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantBed, requireTenantCase } = require('../utils/tenantRecords');

const auth = [authenticate, tenant, requirePermission('admissions')];

/**
 * Who does what with beds.
 *
 * Creating and removing beds is estate management — how many beds exist, in
 * which ward, of what kind. That belongs to the facility administrator, and it
 * was previously impossible: there was no route to create a bed at all, so the
 * ward layout was whatever the seed happened to contain.
 *
 * Changing a bed's *state* is ward work and belongs to nursing: a patient has
 * left, the bed needs cleaning, the frame is broken. A nurse who has to find an
 * administrator before they can mark a bed free will simply not record it, and
 * the board stops reflecting the ward.
 */
const bedEstate = [authenticate, tenant, requirePermission('beds'), (req, res, next) => {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only a facility administrator can add or remove beds' });
  }
  next();
}];
const bedStatus = [authenticate, tenant, requirePermission('beds')];

const BED_TYPES = ['GENERAL', 'PRIVATE', 'ICU', 'HDU', 'MATERNITY'];
const BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE'];

// GET /v1/admissions/beds — must be before /:id to avoid route conflict
router.get('/beds', auth, async (req, res, next) => {
  try {
    const { status, ward, type } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (status && status !== 'ALL') where.status = status;
    if (ward && ward !== 'ALL') where.ward = ward;
    if (type && type !== 'ALL') where.type = type;

    const beds = await prisma.bed.findMany({
      where,
      orderBy: [{ ward: 'asc' }, { bedNumber: 'asc' }],
      include: {
        currentPatient: {
          select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true },
        },
        department: { select: { id: true, name: true } },
      },
    });

    // The counts a bed manager actually needs: what can take a patient right
    // now, versus what is merely not occupied.
    const counts = beds.reduce((acc, bed) => {
      acc[bed.status] = (acc[bed.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      beds,
      counts: {
        total: beds.length,
        available: counts.AVAILABLE || 0,
        occupied: counts.OCCUPIED || 0,
        cleaning: counts.CLEANING || 0,
        maintenance: counts.MAINTENANCE || 0,
        // Occupancy measured against beds that could be used, not against beds
        // that exist — counting broken beds as spare capacity flatters the ward.
        occupancyPercent: (() => {
          const usable = beds.filter((b) => b.status !== 'MAINTENANCE').length;
          return usable ? Math.round(((counts.OCCUPIED || 0) / usable) * 100) : 0;
        })(),
      },
      wards: [...new Set(beds.map((b) => b.ward).filter(Boolean))].sort(),
    });
  } catch (e) { next(e); }
});

/** Add a bed to the ward. Administrator only — this is estate, not ward work. */
router.post('/beds', bedEstate, async (req, res, next) => {
  try {
    const { bedNumber, ward, type = 'GENERAL', departmentId } = req.body || {};
    if (!String(bedNumber || '').trim()) {
      return res.status(400).json({ error: 'Give the bed a number staff will recognise', field: 'bedNumber' });
    }
    if (!BED_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${BED_TYPES.join(', ')}`, field: 'type' });
    }

    // Two beds with the same number in the same ward is how a patient gets sent
    // to the wrong one.
    const clash = await prisma.bed.findFirst({
      where: {
        facilityId: req.ctx.facilityId,
        bedNumber: String(bedNumber).trim(),
        ward: ward ? String(ward).trim() : null,
      },
    });
    if (clash) {
      return res.status(409).json({ error: `Bed ${bedNumber}${ward ? ` in ${ward}` : ''} already exists` });
    }

    const bed = await prisma.bed.create({
      data: {
        facilityId: req.ctx.facilityId,
        bedNumber: String(bedNumber).trim(),
        ward: ward ? String(ward).trim() : null,
        type,
        departmentId: departmentId || null,
      },
    });
    res.status(201).json(bed);
  } catch (e) { next(e); }
});

/** Add a run of beds at once — setting up a ward one bed at a time is tedious. */
router.post('/beds/bulk', bedEstate, async (req, res, next) => {
  try {
    const { ward, type = 'GENERAL', departmentId, prefix = '', from, to } = req.body || {};
    const start = Number(from);
    const end = Number(to);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      return res.status(400).json({ error: 'Give a valid range, for example 1 to 20', field: 'from' });
    }
    if (end - start + 1 > 200) {
      return res.status(400).json({ error: 'Add at most 200 beds at a time', field: 'to' });
    }
    if (!BED_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${BED_TYPES.join(', ')}`, field: 'type' });
    }

    const wardName = ward ? String(ward).trim() : null;
    const existing = new Set(
      (await prisma.bed.findMany({
        where: { facilityId: req.ctx.facilityId, ward: wardName },
        select: { bedNumber: true },
      })).map((b) => b.bedNumber),
    );

    const rows = [];
    for (let n = start; n <= end; n += 1) {
      const bedNumber = `${prefix}${n}`;
      // Skip rather than fail: re-running after adding a few by hand should
      // fill the gaps, not refuse the whole batch.
      if (existing.has(bedNumber)) continue;
      rows.push({
        facilityId: req.ctx.facilityId,
        bedNumber, ward: wardName, type,
        departmentId: departmentId || null,
      });
    }

    if (rows.length) await prisma.bed.createMany({ data: rows });
    res.status(201).json({
      created: rows.length,
      skipped: (end - start + 1) - rows.length,
      ward: wardName,
    });
  } catch (e) { next(e); }
});

router.put('/beds/:id', bedEstate, async (req, res, next) => {
  try {
    const bed = await prisma.bed.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!bed) return res.status(404).json({ error: 'Bed not found' });

    const { bedNumber, ward, type, departmentId } = req.body || {};
    if (type && !BED_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${BED_TYPES.join(', ')}`, field: 'type' });
    }

    const updated = await prisma.bed.update({
      where: { id: bed.id },
      data: {
        ...(bedNumber ? { bedNumber: String(bedNumber).trim() } : {}),
        ...(ward !== undefined ? { ward: ward ? String(ward).trim() : null } : {}),
        ...(type ? { type } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
      },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/beds/:id', bedEstate, async (req, res, next) => {
  try {
    const bed = await prisma.bed.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!bed) return res.status(404).json({ error: 'Bed not found' });
    // Removing a bed with someone in it would orphan the admission.
    if (bed.currentPatientId || bed.status === 'OCCUPIED') {
      return res.status(409).json({ error: 'Discharge or move the patient before removing this bed' });
    }
    const admissions = await prisma.admission.count({ where: { bedId: bed.id } });
    if (admissions > 0) {
      // History matters more than tidiness: retire it instead of deleting.
      const retired = await prisma.bed.update({
        where: { id: bed.id }, data: { status: 'MAINTENANCE' },
      });
      return res.json({
        ...retired,
        note: 'This bed has admission history, so it was taken out of service rather than deleted.',
      });
    }
    await prisma.bed.delete({ where: { id: bed.id } });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

/**
 * Change a bed's state. Nursing work — a nurse who must find an administrator
 * to mark a bed clean will not record it, and the board stops matching the ward.
 */
router.put('/beds/:id/status', bedStatus, async (req, res, next) => {
  try {
    const bed = await prisma.bed.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!bed) return res.status(404).json({ error: 'Bed not found' });

    const { status, note } = req.body || {};
    if (!BED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${BED_STATUSES.join(', ')}`, field: 'status' });
    }
    // Occupancy is set by admitting and discharging, never by hand — otherwise
    // a bed can read occupied with no admission behind it.
    if (status === 'OCCUPIED') {
      return res.status(400).json({ error: 'Admit a patient to occupy a bed' });
    }
    if (bed.currentPatientId) {
      return res.status(409).json({ error: 'This bed has a patient in it — discharge or transfer them first' });
    }

    const updated = await prisma.bed.update({ where: { id: bed.id }, data: { status } });
    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId,
        action: 'bed.status', resource: 'Bed', resourceId: bed.id,
        reason: note || `${bed.status} → ${status}`, ip: req.ip,
      },
    }).catch(() => {});
    res.json(updated);
  } catch (e) { next(e); }
});

router.get('/', auth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    const rows = await prisma.admission.findMany({
      where, orderBy: { admittedAt: 'desc' },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true, gender: true, dateOfBirth: true } },
        bed: { select: { id: true, bedNumber: true, ward: true, type: true } },
      },
    });
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { patientId, bedId, caseId, diagnosis, notes } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (bedId) {
      const bed = await requireTenantBed(req.ctx.facilityId, bedId);
      if (bed.status !== 'AVAILABLE') return res.status(409).json({ error: 'Bed is not available' });
    }
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);
    const a = await prisma.$transaction(async (tx) => {
      const activeAdmission = await tx.admission.findFirst({
        where: { facilityId: req.ctx.facilityId, patientId, status: 'ADMITTED' },
        select: { id: true },
      });
      if (activeAdmission) throw Object.assign(new Error('Patient already has an active admission'), { status: 409 });

      if (bedId) {
        const reserved = await tx.bed.updateMany({
          where: {
            id: bedId, facilityId: req.ctx.facilityId,
            status: 'AVAILABLE', currentPatientId: null,
          },
          data: { status: 'OCCUPIED', currentPatientId: patientId },
        });
        if (reserved.count !== 1) throw Object.assign(new Error('Bed is no longer available'), { status: 409 });
      }

      const admission = await tx.admission.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, bedId: bedId || null,
          caseId: caseId || null, diagnosis, notes, admittedById: req.ctx.userId,
        },
      });
      await tx.patient.update({ where: { id: patientId }, data: { status: 'IN_PATIENT' } });
      return admission;
    });
    res.status(201).json(a);
  } catch (e) { next(e); }
});

router.put('/:id/discharge', auth, async (req, res, next) => {
  try {
    const a = await prisma.admission.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (a.status !== 'ADMITTED') return res.status(409).json({ error: 'Admission is already closed' });
    const allowedStatuses = new Set(['DISCHARGED', 'TRANSFERRED', 'DAMA', 'DECEASED']);
    const dischargeStatus = req.body.status || 'DISCHARGED';
    if (!allowedStatuses.has(dischargeStatus)) return res.status(400).json({ error: 'Invalid discharge status' });

    const updated = await prisma.$transaction(async (tx) => {
      const closed = await tx.admission.updateMany({
        where: { id: req.params.id, facilityId: req.ctx.facilityId, status: 'ADMITTED' },
        data: { status: dischargeStatus, dischargedAt: new Date(), notes: req.body.notes },
      });
      if (closed.count !== 1) throw Object.assign(new Error('Admission is already closed'), { status: 409 });

      if (a.bedId) {
        await tx.bed.updateMany({
          where: { id: a.bedId, facilityId: req.ctx.facilityId, currentPatientId: a.patientId },
          data: { status: 'AVAILABLE', currentPatientId: null },
        });
      }
      const remaining = await tx.admission.count({
        where: { facilityId: req.ctx.facilityId, patientId: a.patientId, status: 'ADMITTED' },
      });
      await tx.patient.update({
        where: { id: a.patientId },
        data: { status: remaining ? 'IN_PATIENT' : 'DISCHARGED' },
      });
      return tx.admission.findUnique({ where: { id: req.params.id } });
    });
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
