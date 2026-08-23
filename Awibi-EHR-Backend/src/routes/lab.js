const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantCase } = require('../utils/tenantRecords');
const { TRANSITIONS, canTransition, transitionError, interpretResult } = require('../utils/diagnostics');
const { can } = require('../utils/permissions');

const auth = [authenticate, tenant, requirePermission('lab')];
const orderAuth = [authenticate, tenant, requirePermission('diagnostic_order')];
const processAuth = [authenticate, tenant, requirePermission('diagnostic_process')];
const deliveryAuth = [authenticate, tenant, (req, res, next) => {
  if (can(req.ctx.role, req.ctx.subRole, 'diagnostic_process') || can(req.ctx.role, req.ctx.subRole, 'clinical_write')) return next();
  return res.status(403).json({ error: 'Only the responsible diagnostic professional or doctor can release a result to the patient' });
}];

const DISCIPLINE_SCOPE = {
  RADIOLOGIST: { testType: { in: ['IMAGING', 'ECG'] } },
  RADIOGRAPHER: { testType: 'IMAGING' },
  HAEMATOLOGIST: { diagnosticDiscipline: { in: ['Haematology', 'Hematology'] } },
  CHEMICAL_PATHOLOGIST: { diagnosticDiscipline: { in: ['Chemistry', 'Chemical Pathology'] } },
  HISTOPATHOLOGIST: { diagnosticDiscipline: { in: ['Histopathology', 'Morbid Anatomy', 'Anatomical Pathology'] } },
  MICROBIOLOGIST: { diagnosticDiscipline: { in: ['Microbiology', 'Parasitology', 'Serology'] } },
};

function scopedQueueWhere(req, base = {}) {
  return { ...base, ...(DISCIPLINE_SCOPE[req.ctx?.subRole] || {}) };
}

const IDENTITY_URL = process.env.IDENTITY_BACKEND_URL || 'http://localhost:8001';
const SHARED_SECRET = process.env.AWIBI_SHARED_SECRET;

router.get('/', auth, async (req, res, next) => {
  try {
    const { status, patientId, testType, search, page = 1, limit = 20 } = req.query;
    let where = scopedQueueWhere(req, { facilityId: req.ctx.facilityId });
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    if (patientId) where.patientId = patientId;
    if (testType) where.testType = testType;
    if (search) {
      where = {
        ...where,
        OR: [
          { testName: { contains: search, mode: 'insensitive' } },
          { diagnosticDiscipline: { contains: search, mode: 'insensitive' } },
          { patient: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
          { patient: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
          { patient: { is: { universalPatientId: { contains: search, mode: 'insensitive' } } } },
          { patient: { is: { mrn: { contains: search, mode: 'insensitive' } } } },
        ],
      };
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, requests] = await prisma.$transaction([
      prisma.labRequest.count({ where }),
      prisma.labRequest.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true, dateOfBirth: true, gender: true } },
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
    const queue = (status) => scopedQueueWhere(req, { facilityId: fid, status });
    const [pending, inProgress, completed, cancelled] = await prisma.$transaction([
      prisma.labRequest.count({ where: queue('PENDING') }),
      prisma.labRequest.count({ where: queue('IN_PROGRESS') }),
      prisma.labRequest.count({ where: scopedQueueWhere(req, { facilityId: fid, status: { in: ['PRELIMINARY', 'COMPLETED', 'CORRECTED'] } }) }),
      prisma.labRequest.count({ where: queue('CANCELLED') }),
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
      where: scopedQueueWhere(req, { id: req.params.id, facilityId: req.ctx.facilityId }),
      include: {
        patient: true,
        requestedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/', orderAuth, async (req, res, next) => {
  try {
    const { patientId, testName, testType, priority, caseId, notes, catalogueTestId, tests } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    const patient = await requireTenantPatient(req.ctx.facilityId, patientId);
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
          patientDateOfBirthAtOrder: patient.dateOfBirth,
          patientGenderAtOrder: patient.gender,
          diagnosticDiscipline: cat?.category || null,
          requestOrigin: 'CLINICIAN_ORDER',
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

/**
 * Fields that must never be written through the generic update.
 *
 * This route previously copied the whole request body into the record. That
 * allowed a numeric result to be stored with no reference range applied and no
 * abnormal flag computed — a potassium of 7.2 saved as an ordinary result,
 * raising no alert and appearing normal on the chart. It also allowed a
 * critical-result acknowledgement to be written without anybody acknowledging
 * anything, which is the audit trail that proves somebody was told.
 *
 * Results go through PUT /:id/result, which interprets them against the range.
 */
const RESULT_FIELDS = [
  'status', 'result', 'resultFileUrl', 'aiDraft', 'aiDraftReviewed',
  'resultValue', 'resultUnit', 'referenceLow', 'referenceHigh',
  'abnormalFlag', 'isCritical', 'criticalAckById', 'criticalAckAt',
  'verifiedById', 'verifiedAt', 'reviewedByDoctorAt', 'completedAt',
  'reportFindings', 'reportImpression', 'attachments', 'processedById',
  'patientDateOfBirthAtOrder', 'patientGenderAtOrder', 'diagnosticDiscipline',
  'requestOrigin', 'referredAffiliateId', 'referredAt', 'resultVersion',
];

router.put('/:id', processAuth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: scopedQueueWhere(req, { id: req.params.id, facilityId: req.ctx.facilityId }) });
    if (!exists) return res.status(404).json({ error: 'Not found' });

    const { id, facilityId, createdAt, updatedAt, ...data } = req.body;

    const attempted = RESULT_FIELDS.filter((f) => f in data);
    if (attempted.length) {
      return res.status(400).json({
        error: 'Lifecycle and result fields must use their dedicated audited endpoints',
        fields: attempted,
        use: `POST /lab/${req.params.id}/status or PUT /lab/${req.params.id}/result`,
      });
    }

    const r = await prisma.labRequest.update({ where: { id: req.params.id }, data });
    res.json(r);
  } catch (e) { next(e); }
});

// Move an investigation through its lifecycle, recording who did what and when.
router.post('/:id/status', processAuth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: scopedQueueWhere(req, { id: req.params.id, facilityId: req.ctx.facilityId }) });
    if (!exists) return res.status(404).json({ error: 'Not found' });

    const { status, specimenId, specimenType } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (['PRELIMINARY', 'COMPLETED', 'CORRECTED'].includes(status)) {
      return res.status(400).json({
        error: 'A diagnostic result can only be finalized through the result endpoint',
        use: `PUT /lab/${req.params.id}/result`,
      });
    }
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

router.put('/:id/result', processAuth, async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({ where: scopedQueueWhere(req, { id: req.params.id, facilityId: req.ctx.facilityId }) });
    if (!exists) return res.status(404).json({ error: 'Not found' });

    const {
      result, aiDraft, resultValue, resultUnit,
      referenceLow, referenceHigh, criticalLow, criticalHigh,
      reportFindings, reportImpression, attachments, preliminary,
    } = req.body || {};

    if ([referenceLow, referenceHigh, criticalLow, criticalHigh].some((value) => value !== undefined)) {
      return res.status(400).json({
        error: 'Reference and critical ranges are controlled by the facility diagnostic catalogue, not result entry',
      });
    }
    if (resultValue !== undefined && resultValue !== null && !Number.isFinite(Number(resultValue))) {
      return res.status(400).json({ error: 'resultValue must be a finite number' });
    }
    if (resultValue == null && !String(result || '').trim() && !String(reportFindings || '').trim() && !String(reportImpression || '').trim()) {
      return res.status(400).json({ error: 'Enter a numeric result, narrative result, findings, or impression before saving' });
    }
    if (exists.testType === 'LAB' && ['PENDING', 'ACCEPTED'].includes(exists.status)) {
      return res.status(409).json({
        error: 'Record specimen collection/receipt before entering a laboratory result',
        allowedNext: TRANSITIONS[exists.status],
      });
    }

    // Reference ranges come only from the facility catalogue. Result-entry
    // staff cannot silently redefine a range while entering a value.
    let ranges = {
      referenceLow: exists.referenceLow,
      referenceHigh: exists.referenceHigh,
      criticalLow: null,
      criticalHigh: null,
    };
    let unit = resultUnit ?? exists.resultUnit;

    if (exists.catalogueTestId) {
      const cat = await prisma.diagnosticTest.findFirst({
        where: { id: exists.catalogueTestId, facilityId: req.ctx.facilityId },
      });
      if (cat) {
        ranges = {
          referenceLow: cat.referenceLow,
          referenceHigh: cat.referenceHigh,
          criticalLow: cat.criticalLow,
          criticalHigh: cat.criticalHigh,
        };
        unit = unit ?? cat.unit;
      }
    }

    const { abnormalFlag, isCritical } = interpretResult(resultValue, ranges);

    // Re-resulting something already final is a correction, not an overwrite.
    const isCorrection = exists.status === 'COMPLETED' || exists.status === 'CORRECTED';
    const nextStatus = preliminary ? 'PRELIMINARY' : (isCorrection ? 'CORRECTED' : 'COMPLETED');

    const nextVersion = exists.resultVersion + 1;
    const { saved, clinicalAlert } = await prisma.$transaction(async (tx) => {
      const savedResult = await tx.labRequest.update({
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
          resultVersion: nextVersion,
          // A new/corrected result has not been seen by the ordering doctor yet.
          reviewedByDoctorAt: null,
          criticalAckById: isCritical ? null : exists.criticalAckById,
          criticalAckAt: isCritical ? null : exists.criticalAckAt,
        },
      });

      let alert = null;
      if (isCritical) {
        const numeric = resultValue != null ? `${Number(resultValue)}${unit ? ` ${unit}` : ''}` : (result || 'Critical result');
        alert = await tx.clinicalAlert.create({
          data: {
            facilityId: req.ctx.facilityId,
            patientId: exists.patientId,
            assignedToId: exists.requestedById,
            sourceType: 'LAB_REQUEST',
            sourceId: exists.id,
            sourceKey: exists.testName,
            dedupeKey: `LAB_REQUEST:${exists.id}:v${nextVersion}`,
            category: 'DIAGNOSTIC_RESULT',
            severity: 'CRITICAL',
            status: 'OPEN',
            title: `${exists.testName} is critical`,
            detail: `${abnormalFlag?.replace('_', ' ') || 'Critical'} diagnostic result requires acknowledgement, action and resolution.`,
            latestValue: numeric,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          facilityId: req.ctx.facilityId,
          userId: req.ctx.userId,
          action: isCorrection ? 'lab.result.correct' : 'lab.result.enter',
          resource: 'LabRequest',
          resourceId: savedResult.id,
          reason: isCritical ? `CRITICAL result entered; alert ${alert?.id}` : 'Result entered',
          ip: req.ip,
        },
      });

      return { saved: savedResult, clinicalAlert: alert };
    });

    res.json({ ...saved, clinicalAlert });
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

// A routine result has a separate, explicit clinician-review event. Critical
// results must go through the acknowledged critical-alert lifecycle instead.
router.post('/:id/review', [authenticate, tenant, requirePermission('clinical_write')], async (req, res, next) => {
  try {
    const exists = await prisma.labRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!exists) return res.status(404).json({ error: 'Diagnostic request not found' });
    if (!['PRELIMINARY', 'COMPLETED', 'CORRECTED'].includes(exists.status)) {
      return res.status(409).json({ error: 'Only a reported diagnostic result can be marked reviewed' });
    }
    if (exists.isCritical && !exists.criticalAckAt) {
      return res.status(409).json({ error: 'A critical result must be acknowledged through the critical-alert workflow first' });
    }

    const reviewed = await prisma.$transaction(async (tx) => {
      const saved = await tx.labRequest.update({
        where: { id: exists.id },
        data: { reviewedByDoctorAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          facilityId: req.ctx.facilityId,
          userId: req.ctx.userId,
          action: 'lab.result.review',
          resource: 'LabRequest',
          resourceId: exists.id,
          reason: req.body?.note || `Reviewed result version ${exists.resultVersion}`,
          ip: req.ip,
        },
      });
      return saved;
    });
    res.json(reviewed);
  } catch (e) { next(e); }
});

// Refer an ordered investigation to a configured affiliate provider. This is
// deliberately distinct from /transfer below, which delivers a completed
// result to the patient's Awibi Identity inbox.
router.post('/:id/refer', processAuth, async (req, res, next) => {
  try {
    const request = await prisma.labRequest.findFirst({
      where: scopedQueueWhere(req, { id: req.params.id, facilityId: req.ctx.facilityId }),
    });
    if (!request) return res.status(404).json({ error: 'Diagnostic request not found' });

    const { affiliateId, notes } = req.body || {};
    if (!affiliateId) return res.status(400).json({ error: 'affiliateId is required' });
    const affiliate = await prisma.affiliate.findFirst({
      where: {
        id: affiliateId,
        facilityId: req.ctx.facilityId,
        isActive: true,
        type: { in: request.testType === 'IMAGING' ? ['IMAGING', 'HOSPITAL'] : ['LAB', 'HOSPITAL'] },
      },
    });
    if (!affiliate) return res.status(404).json({ error: 'Compatible affiliate provider not found in this facility' });
    if (!canTransition(request.status, 'IN_PROGRESS')) {
      return res.status(409).json({ error: transitionError(request.status, 'IN_PROGRESS') });
    }

    const referred = await prisma.$transaction(async (tx) => {
      const saved = await tx.labRequest.update({
        where: { id: request.id },
        data: {
          status: 'IN_PROGRESS',
          processedById: req.ctx.userId,
          referredAffiliateId: affiliate.id,
          referredAt: new Date(),
          referralNotes: notes || null,
          receivedAt: request.receivedAt || new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          facilityId: req.ctx.facilityId,
          userId: req.ctx.userId,
          action: 'lab.refer.affiliate',
          resource: 'LabRequest',
          resourceId: request.id,
          reason: `Referred to ${affiliate.name}`,
          ip: req.ip,
        },
      });
      return saved;
    });
    res.json({ ...referred, affiliate: { id: affiliate.id, name: affiliate.name, type: affiliate.type } });
  } catch (e) { next(e); }
});

router.post('/:id/transfer', deliveryAuth, async (req, res, next) => {
  try {
    const r = await prisma.labRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { patient: { select: {
        id: true, firstName: true, lastName: true, universalPatientId: true,
        identityPairwiseId: true, identityLinkStatus: true, identityConsentGrantId: true,
      } } },
    });
    if (!r) return res.status(404).json({ error: 'Lab request not found' });
    if (!['COMPLETED', 'CORRECTED'].includes(r.status)) return res.status(400).json({ error: 'Only a final diagnostic result can be released' });
    const reportBody = [
      r.result,
      r.reportFindings ? `Findings\n${r.reportFindings}` : null,
      r.reportImpression ? `Impression\n${r.reportImpression}` : null,
    ].filter(Boolean).join('\n\n');
    if (!reportBody) return res.status(400).json({ error: 'No result to transfer' });
    const consent = await prisma.consentGrant.findFirst({
      where: {
        id: r.patient.identityConsentGrantId || undefined,
        patientId: r.patient.id,
        facilityId: req.ctx.facilityId,
        isActive: true,
        revokedAt: null,
        scope: { in: ['FULL', 'LAB_ONLY'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { grantedAt: 'desc' },
    });
    if (!consent) {
      return res.status(403).json({
        error: 'A current FULL or LAB_ONLY patient consent is required before releasing this result to Awibi Identity',
      });
    }
    if (!r.patient.identityPairwiseId || r.patient.identityLinkStatus !== 'ACTIVE') {
      return res.status(409).json({
        error: 'Link this patient record to Awibi Identity before releasing results',
      });
    }
    if (!SHARED_SECRET) return res.status(503).json({ error: 'Identity service secret is not configured' });

    const inboxRes = await fetch(`${IDENTITY_URL}/v1/identity/facility/${encodeURIComponent(r.patient.identityPairwiseId)}/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-awibi-secret': SHARED_SECRET,
        'x-facility-id': req.ctx.facilityId,
      },
      body: JSON.stringify({
        type: 'DIAGNOSTIC_RESULT', title: `Diagnostic Result: ${r.testName}`, body: reportBody,
        meta: {
          labRequestId: r.id,
          testType: r.testType,
          discipline: r.diagnosticDiscipline,
          completedAt: r.completedAt,
          resultVersion: r.resultVersion,
          facilityId: req.ctx.facilityId,
          consentGrantId: consent.id,
        },
        source: { recordType: 'LabRequest', recordId: r.id, version: r.resultVersion },
        consent: { reference: consent.id },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!inboxRes.ok) {
      const errBody = await inboxRes.text();
      return res.status(502).json({ error: 'Failed to deliver to patient inbox', detail: errBody });
    }
    const message = await inboxRes.json();
    await prisma.$transaction([
      prisma.patient.update({ where: { id: r.patient.id }, data: { consentLinkedToIdentity: true } }),
      prisma.auditLog.create({
        data: {
          facilityId: req.ctx.facilityId,
          userId: req.ctx.userId,
          action: 'lab.result.release.identity',
          resource: 'LabRequest',
          resourceId: r.id,
          reason: `Released result version ${r.resultVersion} under consent ${consent.id}`,
          ip: req.ip,
        },
      }),
    ]);
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
