const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantCase } = require('../utils/tenantRecords');
const { canTransition, transitionError, interpretResult } = require('../utils/diagnostics');

const auth = [authenticate, tenant, requirePermission('lab')];

const IDENTITY_URL = process.env.IDENTITY_BACKEND_URL || 'http://localhost:8001';
const SHARED_SECRET = process.env.AWIBI_SHARED_SECRET;

router.get('/', auth, async (req, res, next) => {
  try {
    const { status, patientId, testType, search, page = 1, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    if (patientId) where.patientId = patientId;
    if (testType) where.testType = testType;
    if (search) where.testName = { contains: search, mode: 'insensitive' };
    const skip = (Number(page) - 1) * Number(limit);
    const [total, requests] = await prisma.$transaction([
      prisma.labRequest.count({ where }),
      prisma.labRequest.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true } },
          requestedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);
    res.json({ requests, total });
  } catch (e) { next(e); }
});

router.get('/stats', auth, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const [pending, inProgress, completed, cancelled] = await prisma.$transaction([
      prisma.labRequest.count({ where: { facilityId: fid, status: 'PENDING' } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'IN_PROGRESS' } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'COMPLETED' } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'CANCELLED' } }),
    ]);
    res.json({ pending, inProgress, completed, cancelled, total: pending + inProgress + completed + cancelled });
  } catch (e) { next(e); }
});

// ── Diagnostics catalogue ───────────────────────────────────────────────────
// Declared before '/:id' so "catalogue" is never parsed as a record id.
router.get('/catalogue', auth, async (req, res, next) => {
  try {
    const { testType, search } = req.query;
    const where = { facilityId: req.ctx.facilityId, isActive: true };
    if (testType) where.testType = testType;
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const tests = await prisma.diagnosticTest.findMany({ where, orderBy: [{ testType: 'asc' }, { name: 'asc' }] });
    res.json({ tests, total: tests.length });
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const r = await prisma.labRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: true,
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { patientId, testName, testType, priority, caseId, notes, catalogueTestId, tests } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    // Doctors order several investigations at once; accept a batch or a single test.
    const batch = Array.isArray(tests) && tests.length
      ? tests
      : [{ testName, testType, priority, notes, catalogueTestId }];

    const created = [];
    for (const item of batch) {
      let cat = null;
      if (item.catalogueTestId) {
        cat = await prisma.diagnosticTest.findFirst({
          where: { id: item.catalogueTestId, facilityId: req.ctx.facilityId, isActive: true },
        });
        if (!cat) return res.status(404).json({ error: 'Diagnostic test not found in this facility catalogue' });
      }
      const name = item.testName || cat?.name;
      if (!name) return res.status(400).json({ error: 'testName or catalogueTestId required' });

      created.push(await prisma.labRequest.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, caseId: caseId || null,
          requestedById: req.ctx.userId,
          testName: name,
          testType: item.testType || cat?.testType || 'LAB',
          priority: item.priority || 'ROUTINE',
          notes: item.notes || null,
          // Snapshot the catalogue reference range so a later catalogue edit
          // never retro-changes how an existing result was interpreted.
          catalogueTestId: cat?.id || null,
          resultUnit: cat?.unit || null,
          referenceLow: cat?.referenceLow ?? null,
          referenceHigh: cat?.referenceHigh ?? null,
          specimenType: cat?.specimenType || null,
        },
      }));
    }

    res.status(201).json(created.length === 1 ? created[0] : { requests: created, count: created.length });
  } catch (e) { next(e); }
});

// Catalogue maintenance belongs to whoever manages facility settings.
router.post('/catalogue', [authenticate, tenant, requirePermission('settings')], async (req, res, next) => {
  try {
    const { name, testType, unit, referenceLow, referenceHigh, criticalLow, criticalHigh,
      specimenType, price, category, code, resultKind, turnaroundHours } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const test = await prisma.diagnosticTest.create({
      data: {
        facilityId: req.ctx.facilityId, name, code: code || null,
        testType: testType || 'LAB', category: category || null,
        specimenType: specimenType || null, unit: unit || null,
        referenceLow: referenceLow != null ? Number(referenceLow) : null,
        referenceHigh: referenceHigh != null ? Number(referenceHigh) : null,
        criticalLow: criticalLow != null ? Number(criticalLow) : null,
        criticalHigh: criticalHigh != null ? Number(criticalHigh) : null,
        resultKind: resultKind || 'NUMERIC',
        price: price != null ? Number(price) : 0,
        turnaroundHours: turnaroundHours != null ? Number(turnaroundHours) : null,
      },
    });
    res.status(201).json(test);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'A test with that name already exists' });
    next(e);
  }
});

router.put('/catalogue/:id', [authenticate, tenant, requirePermission('settings')], async (req, res, next) => {
  try {
    const exists = await prisma.diagnosticTest.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { id, facilityId, createdAt, updatedAt, ...data } = req.body;
    const test = await prisma.diagnosticTest.update({ where: { id: exists.id }, data });
    res.json(test);
  } catch (e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { id, facilityId, createdAt, updatedAt, ...data } = req.body;
    if (data.status === 'COMPLETED' && !exists.completedAt) data.completedAt = new Date();
    const r = await prisma.labRequest.update({ where: { id: req.params.id }, data });
    res.json(r);
  } catch (e) { next(e); }
});

// Move an investigation through its lifecycle, recording who did what and when.
router.post('/:id/status', auth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });

    const { status, specimenId, specimenType } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (!canTransition(exists.status, status)) {
      return res.status(409).json({ error: transitionError(exists.status, status) });
    }

    const data = { status };
    if (specimenId !== undefined) data.specimenId = specimenId;
    if (specimenType !== undefined) data.specimenType = specimenType;
    if (status === 'COLLECTED' && !exists.collectedAt) data.collectedAt = new Date();
    if (status === 'IN_PROGRESS' && !exists.receivedAt) data.receivedAt = new Date();
    if (status === 'IN_PROGRESS' || status === 'ACCEPTED') data.processedById = req.ctx.userId;

    const r = await prisma.labRequest.update({ where: { id: exists.id }, data });
    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: `lab.${status.toLowerCase()}`,
        resource: 'LabRequest', resourceId: r.id, reason: 'Investigation lifecycle', ip: req.ip,
      },
    }).catch(() => {});
    res.json(r);
  } catch (e) { next(e); }
});

router.put('/:id/result', auth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });

    const {
      result, aiDraft, resultValue, resultUnit,
      referenceLow, referenceHigh, criticalLow, criticalHigh,
      reportFindings, reportImpression, attachments, preliminary,
    } = req.body || {};

    // Reference ranges come from the catalogue unless the operator overrides them.
    let ranges = {
      referenceLow: referenceLow ?? exists.referenceLow,
      referenceHigh: referenceHigh ?? exists.referenceHigh,
      criticalLow: criticalLow ?? null,
      criticalHigh: criticalHigh ?? null,
    };
    let unit = resultUnit ?? exists.resultUnit;

    if (exists.catalogueTestId) {
      const cat = await prisma.diagnosticTest.findFirst({
        where: { id: exists.catalogueTestId, facilityId: req.ctx.facilityId },
      });
      if (cat) {
        ranges = {
          referenceLow: referenceLow ?? cat.referenceLow,
          referenceHigh: referenceHigh ?? cat.referenceHigh,
          criticalLow: criticalLow ?? cat.criticalLow,
          criticalHigh: criticalHigh ?? cat.criticalHigh,
        };
        unit = unit ?? cat.unit;
      }
    }

    const { abnormalFlag, isCritical } = interpretResult(resultValue, ranges);

    // Re-resulting something already final is a correction, not an overwrite.
    const isCorrection = exists.status === 'COMPLETED' || exists.status === 'CORRECTED';
    const nextStatus = preliminary ? 'PRELIMINARY' : (isCorrection ? 'CORRECTED' : 'COMPLETED');

    const r = await prisma.labRequest.update({
      where: { id: exists.id },
      data: {
        result: result ?? exists.result,
        aiDraft: aiDraft || null,
        resultValue: resultValue != null ? Number(resultValue) : exists.resultValue,
        resultUnit: unit,
        referenceLow: ranges.referenceLow,
        referenceHigh: ranges.referenceHigh,
        abnormalFlag,
        isCritical,
        reportFindings: reportFindings ?? exists.reportFindings,
        reportImpression: reportImpression ?? exists.reportImpression,
        attachments: Array.isArray(attachments) ? attachments : exists.attachments,
        status: nextStatus,
        completedAt: nextStatus === 'PRELIMINARY' ? exists.completedAt : new Date(),
        processedById: req.ctx.userId,
        // A new/corrected result has not been seen by the ordering doctor yet.
        reviewedByDoctorAt: null,
        criticalAckById: isCritical ? null : exists.criticalAckById,
        criticalAckAt: isCritical ? null : exists.criticalAckAt,
      },
    });

    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId,
        action: isCorrection ? 'lab.result.correct' : 'lab.result.enter',
        resource: 'LabRequest', resourceId: r.id,
        reason: isCritical ? 'CRITICAL result entered' : 'Result entered', ip: req.ip,
      },
    }).catch(() => {});

    res.json(r);
  } catch (e) { next(e); }
});

// A critical result is not handled until a named practitioner acknowledges it.
router.post('/:id/acknowledge', [authenticate, tenant, requirePermission('clinical_write')], async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    if (!exists.isCritical) return res.status(400).json({ error: 'This result is not flagged critical' });
    if (exists.criticalAckAt) return res.status(409).json({ error: 'Already acknowledged' });

    const r = await prisma.labRequest.update({
      where: { id: exists.id },
      data: { criticalAckById: req.ctx.userId, criticalAckAt: new Date(), reviewedByDoctorAt: new Date() },
    });
    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'lab.critical.acknowledge',
        resource: 'LabRequest', resourceId: r.id, reason: req.body?.reason || 'Critical result acknowledged', ip: req.ip,
      },
    }).catch(() => {});
    res.json(r);
  } catch (e) { next(e); }
});

// Unreviewed and critical results drive the doctor's dashboard badge.
router.get('/alerts/critical', auth, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const [critical, unreviewed] = await prisma.$transaction([
      prisma.labRequest.findMany({
        where: { facilityId: fid, isCritical: true, criticalAckAt: null },
        orderBy: { completedAt: 'desc' }, take: 25,
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
      }),
      prisma.labRequest.count({
        where: { facilityId: fid, status: { in: ['COMPLETED', 'CORRECTED', 'PRELIMINARY'] }, reviewedByDoctorAt: null },
      }),
    ]);
    res.json({ critical, criticalCount: critical.length, unreviewedCount: unreviewed });
  } catch (e) { next(e); }
});

router.post('/:id/transfer', auth, async (req, res, next) => {
  try {
    const r = await prisma.labRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, nin: true } } },
    });
    if (!r) return res.status(404).json({ error: 'Lab request not found' });
    if (r.status !== 'COMPLETED') return res.status(400).json({ error: 'Lab result must be COMPLETED before transfer' });
    if (!r.result) return res.status(400).json({ error: 'No result to transfer' });
    const lookupKey = r.patient.universalPatientId || r.patient.nin;
    if (!lookupKey) return res.status(400).json({ error: 'Patient has no UPID or NIN — cannot locate identity record' });

    const lookupRes = await fetch(`${IDENTITY_URL}/v1/identity/lookup/${encodeURIComponent(lookupKey)}`, {
      headers: {
        'x-facility-id': req.ctx.facilityId,
        'x-awibi-secret': SHARED_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!lookupRes.ok) return res.status(502).json({ error: 'Could not locate patient in Identity system' });
    const identityPatient = await lookupRes.json();

    const inboxRes = await fetch(`${IDENTITY_URL}/v1/identity/${identityPatient.id}/inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-awibi-secret': SHARED_SECRET },
      body: JSON.stringify({
        type: 'LAB_RESULT', title: `Lab Result: ${r.testName}`, body: r.result,
        meta: { labRequestId: r.id, testType: r.testType, completedAt: r.completedAt, facilityId: req.ctx.facilityId },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!inboxRes.ok) {
      const errBody = await inboxRes.text();
      return res.status(502).json({ error: 'Failed to deliver to patient inbox', detail: errBody });
    }
    const message = await inboxRes.json();
    res.json({ message: 'Lab result sent to patient inbox', inboxMessage: message });
  } catch (e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    await prisma.labRequest.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

module.exports = router;
