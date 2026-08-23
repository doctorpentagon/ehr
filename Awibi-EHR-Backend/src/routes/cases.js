const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');
const { inferMonitoringType } = require('../utils/orderRouting');

const auth = [authenticate, tenant, requirePermission('cases')];
const createEncounter = [authenticate, tenant, requirePermission('clinical_write')];
const STRUCTURED_ORDER_TYPES = ['MEDICATION', 'NURSING', 'DIET', 'ACTIVITY', 'TREATMENT', 'LAB', 'IMAGING'];
const PRIORITIES = ['ROUTINE', 'URGENT', 'STAT'];

function parseOrders(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

function validateOrders(orders) {
  if (orders === null) return { error: 'orders must be a JSON array', field: 'orders' };
  if (orders.length > 30) return { error: 'An encounter cannot submit more than 30 orders at once', field: 'orders' };
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index] || {};
    if (!STRUCTURED_ORDER_TYPES.includes(order.type)) {
      return { error: `Order ${index + 1} needs a valid type`, field: `orders.${index}.type` };
    }
    if (!String(order.name || '').trim()) {
      return { error: `Order ${index + 1} needs a clear name`, field: `orders.${index}.name` };
    }
    if (order.priority && !PRIORITIES.includes(order.priority)) {
      return { error: `Order ${index + 1} has an invalid priority`, field: `orders.${index}.priority` };
    }
    if (order.frequencyHours != null && order.frequencyHours !== ''
      && (!Number.isFinite(Number(order.frequencyHours)) || Number(order.frequencyHours) <= 0)) {
      return { error: `Order ${index + 1} frequency must be a positive number of hours`, field: `orders.${index}.frequencyHours` };
    }
    for (const key of ['goalMin', 'criticalLow']) {
      if (order[key] != null && order[key] !== '' && !Number.isFinite(Number(order[key]))) {
        return { error: `Order ${index + 1} ${key} must be a number`, field: `orders.${index}.${key}` };
      }
    }
    if (order.goalMin !== '' && order.goalMin != null && order.criticalLow !== '' && order.criticalLow != null
      && Number(order.criticalLow) > Number(order.goalMin)) {
      return { error: `Order ${index + 1} critical threshold cannot be above its expected minimum`, field: `orders.${index}.criticalLow` };
    }
    if (order.type === 'MEDICATION' && !String(order.dosage || '').trim()) {
      return { error: `Medication ${index + 1} needs a dose`, field: `orders.${index}.dosage` };
    }
    if ((order.type === 'LAB' || order.type === 'IMAGING') && !String(order.catalogueTestId || '').trim()) {
      return {
        error: `${order.type === 'IMAGING' ? 'Imaging' : 'Laboratory'} order ${index + 1} must be selected from the facility diagnostic catalogue`,
        field: `orders.${index}.catalogueTestId`,
      };
    }
  }
  return null;
}

router.get('/', auth, async (req, res, next) => {
  try {
    const { patientId, status, page = 1, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    const skip = (Number(page) - 1) * Number(limit);
    if (req.query.encounterTypeId && req.query.encounterTypeId !== 'ALL') {
      where.encounterTypeId = req.query.encounterTypeId;
    }

    const [total, cases] = await prisma.$transaction([
      prisma.case.count({ where }),
      prisma.case.findMany({
        where, skip, take: Number(limit), orderBy: { occurredAt: 'desc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true } },
          author: { select: { id: true, firstName: true, lastName: true, role: true, subRole: true } },
          // The classification belongs in the history list, not just on the
          // encounter — otherwise a doctor scanning past visits cannot tell an
          // emergency attendance from a routine clinic review.
          encounterTypeConfig: { select: { id: true, name: true } },
        },
      }),
    ]);
    res.json({ cases, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const c = await prisma.case.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: true,
        author: { select: { id: true, firstName: true, lastName: true, role: true, subRole: true, specialty: true } },
        signedBy: { select: { id: true, firstName: true, lastName: true, role: true, subRole: true, specialty: true } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true, role: true, subRole: true, specialty: true } },
        encounterTypeConfig: { select: { id: true, name: true, description: true } },
        vitals: true,
      },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const [orders, medications, investigations] = await prisma.$transaction([
      prisma.order.findMany({
        where: { caseId: c.id, facilityId: req.ctx.facilityId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.prescription.findMany({
        where: { caseId: c.id, facilityId: req.ctx.facilityId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.labRequest.findMany({
        where: { caseId: c.id, facilityId: req.ctx.facilityId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    prisma.auditLog.create({ data: { facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'case.view', resource: 'Case', resourceId: c.id, reason: req.query.reason || 'Treatment', ip: req.ip } }).catch(() => {});
    res.json({ ...c, structuredOrders: { orders, medications, investigations } });
  } catch (e) { next(e); }
});

router.post('/', createEncounter, async (req, res, next) => {
  try {
    const { patientId, title, chiefComplaint, history, reviewOfSystems, examination, assessment, plan, notes,
      captureMethod, audioUrl, transcription, scanUrl, ocrText, icdCodes, aiSuggestions,
      encounterType, encounterTypeId, doctorsOrders, clinicianReviewedCapture, saveAsDraft,
      occurredAt, lateEntryReason } = req.body || {};
    const orders = parseOrders(req.body?.orders);
    const orderError = validateOrders(orders);
    if (orderError) return res.status(400).json(orderError);
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    const patient = await requireTenantPatient(req.ctx.facilityId, patientId);

    // Clinical time and audit time are deliberately different. A clinician may
    // document care later, but may never rewrite when the EHR actually received it.
    let clinicalTime = new Date();
    if (occurredAt) {
      clinicalTime = new Date(occurredAt);
      if (Number.isNaN(clinicalTime.getTime())) {
        return res.status(400).json({ error: 'Care date/time is not valid', field: 'occurredAt' });
      }
      if (clinicalTime.getTime() > Date.now() + 60_000) {
        return res.status(400).json({ error: 'Care date/time cannot be in the future', field: 'occurredAt' });
      }
      if (!String(lateEntryReason || '').trim()) {
        return res.status(400).json({ error: 'Give a reason for this retrospective entry', field: 'lateEntryReason' });
      }
    }
    if (patient.dateOfBirth && clinicalTime < new Date(patient.dateOfBirth)) {
      return res.status(400).json({ error: 'Care date/time cannot be before the patient was born', field: 'occurredAt' });
    }

    // Every new encounter must say what kind of contact it was. Billing, the
    // clinic timetable and every report are built on this, and a record that
    // cannot distinguish an emergency attendance from a routine clinic visit
    // is not much use to any of them. Historical encounters stay unclassified;
    // only new ones are held to it.
    if (!encounterTypeId) {
      return res.status(400).json({
        error: 'Choose the encounter context — Emergency, OPD Clinic, Ward Round and so on',
        field: 'encounterTypeId',
      });
    }
    const chosen = await prisma.encounterTypeConfig.findFirst({
      where: { id: encounterTypeId, facilityId: req.ctx.facilityId, isActive: true },
      select: { id: true, name: true },
    });
    if (!chosen) {
      return res.status(400).json({
        error: 'That encounter type is not available in this facility',
        field: 'encounterTypeId',
      });
    }

    const method = captureMethod || 'NOTE_TAKER';
    const captureNeedsReview = method === 'VOICE' || method === 'OCR';
    const isDraft = saveAsDraft === true || (captureNeedsReview && clinicianReviewedCapture !== true);
    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, authorId: req.ctx.userId,
          title, chiefComplaint, history, reviewOfSystems, examination, assessment, plan, notes,
          captureMethod: method,
          encounterTypeId: chosen.id,
          encounterType: encounterType || 'CONSULTATION',
          // Kept as a readable snapshot for older reports. Execution is driven
          // exclusively by the structured records created below.
          doctorsOrders: doctorsOrders || (orders.length
            ? orders.map((order, index) => `${index + 1}. ${order.name}`).join('\n')
            : null),
          audioUrl, transcription, scanUrl, ocrText,
          icdCodes: icdCodes || [],
          aiSuggestions: aiSuggestions || {},
          status: isDraft ? 'DRAFT' : 'OPEN',
          reviewedByClinicianAt: isDraft ? null : new Date(),
          reviewedById: isDraft ? null : req.ctx.userId,
          occurredAt: clinicalTime,
          lateEntryReason: occurredAt ? String(lateEntryReason).trim() : null,
        },
      });

      const routed = { orders: [], medications: [], investigations: [] };
      for (const raw of orders) {
        const order = {
          ...raw,
          name: String(raw.name).trim(),
          priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'ROUTINE',
        };
        if (order.type === 'MEDICATION') {
          routed.medications.push(await tx.prescription.create({
            data: {
              facilityId: req.ctx.facilityId, patientId, caseId: c.id,
              prescribedById: req.ctx.userId,
              drugName: order.name, dosage: String(order.dosage).trim(),
              frequency: order.frequency || null, duration: order.duration || null,
              route: order.route || 'ORAL', instructions: order.instructions || null,
            },
          }));
          continue;
        }
        if (order.type === 'LAB' || order.type === 'IMAGING') {
          const expectedTestType = order.type === 'IMAGING' ? 'IMAGING' : 'LAB';
          const catalogueTest = await tx.diagnosticTest.findFirst({
            where: {
              id: order.catalogueTestId,
              facilityId: req.ctx.facilityId,
              isActive: true,
              testType: expectedTestType,
            },
          });
          if (!catalogueTest) {
            throw Object.assign(new Error(`The selected ${expectedTestType === 'IMAGING' ? 'imaging' : 'laboratory'} test is not active in this facility catalogue`), {
              statusCode: 400,
              field: 'orders.catalogueTestId',
            });
          }
          routed.investigations.push(await tx.labRequest.create({
            data: {
              facilityId: req.ctx.facilityId, patientId, caseId: c.id,
              requestedById: req.ctx.userId,
              testName: catalogueTest.name,
              testType: catalogueTest.testType,
              priority: order.priority, notes: order.instructions || null,
              catalogueTestId: catalogueTest.id,
              patientDateOfBirthAtOrder: patient.dateOfBirth,
              patientGenderAtOrder: patient.gender,
              diagnosticDiscipline: catalogueTest.category || null,
              requestOrigin: 'CLINICIAN_ORDER',
              resultUnit: catalogueTest.unit || null,
              referenceLow: catalogueTest.referenceLow ?? null,
              referenceHigh: catalogueTest.referenceHigh ?? null,
              specimenType: catalogueTest.specimenType || null,
            },
          }));
          continue;
        }
        routed.orders.push(await tx.order.create({
          data: {
            facilityId: req.ctx.facilityId, patientId, caseId: c.id,
            type: order.type, name: order.name,
            details: {
              ...(order.details && typeof order.details === 'object' ? order.details : {}),
              ...((order.goalMin !== '' && order.goalMin != null) || (order.criticalLow !== '' && order.criticalLow != null)
                ? {
                  monitoringBands: {
                    ...(order.goalMin !== '' && order.goalMin != null ? { goalMin: Number(order.goalMin) } : {}),
                    ...(order.criticalLow !== '' && order.criticalLow != null ? { criticalLow: Number(order.criticalLow) } : {}),
                  },
                }
                : {}),
            },
            goal: order.goal || null, instructions: order.instructions || null,
            frequencyHours: order.frequencyHours !== '' && order.frequencyHours != null
              ? Number(order.frequencyHours) : null,
            priority: order.priority, orderedById: req.ctx.userId,
            monitoringType: order.monitoringType || inferMonitoringType(`${order.name} ${order.instructions || ''}`),
          },
        }));
      }

      return { case: c, routed };
    });

    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId,
        action: 'case.create_with_orders', resource: 'Case', resourceId: created.case.id,
        reason: `${orders.length} structured order(s) routed`, ip: req.ip,
        details: {
          standingOrders: created.routed.orders.length,
          medications: created.routed.medications.length,
          investigations: created.routed.investigations.length,
        },
      },
    }).catch(() => {});

    res.status(201).json({ ...created.case, structuredOrders: created.routed });
  } catch (e) { next(e); }
});

router.put('/:id', createEncounter, async (req, res, next) => {
  try {
    const exists = await prisma.case.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Case not found' });

    // A signed note is a legal clinical record: it is never edited in place.
    // Corrections must be made as a new amendment case.
    if (exists.signedAt) {
      return res.status(409).json({
        error: 'This note is signed and cannot be edited. Create an amendment instead.',
        signedAt: exists.signedAt,
      });
    }

    const { id, facilityId, authorId, occurredAt, lateEntryReason, createdAt, updatedAt, signedAt, signedById, reviewedById, version, ...data } = req.body;

    // Optimistic lock: two clinicians on the same draft must not silently
    // overwrite one another.
    if (version != null && Number(version) !== exists.version) {
      return res.status(409).json({
        error: 'This note was changed by someone else while you were editing. Reload to see their changes.',
        currentVersion: exists.version,
      });
    }

    if (data.reviewedByClinicianAt) data.reviewedByClinicianAt = new Date(data.reviewedByClinicianAt);
    const c = await prisma.case.update({
      where: { id: req.params.id },
      data: { ...data, version: { increment: 1 } },
    });
    res.json(c);
  } catch (e) { next(e); }
});

// Signing is an act of clinical accountability, so it needs clinical_write —
// a facility administrator can read every note but can never sign one.
router.post('/:id/sign', [authenticate, tenant, requirePermission('clinical_write')], async (req, res, next) => {
  try {
    const existing = await prisma.case.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!existing) return res.status(404).json({ error: 'Case not found' });
    if (existing.signedAt) return res.status(409).json({ error: 'This note is already signed' });

    // Refuse to sign an empty note — a signature must attest to something.
    const hasContent = [existing.chiefComplaint, existing.history, existing.reviewOfSystems, existing.examination,
      existing.assessment, existing.plan, existing.notes, existing.transcription, existing.ocrText]
      .some((f) => f && String(f).trim().length);
    if (!hasContent) return res.status(400).json({ error: 'Cannot sign an empty note. Document the encounter first.' });

    const icd = Array.isArray(existing.icdCodes) ? existing.icdCodes : [];
    if (!icd.length) return res.status(400).json({ error: 'Add at least one diagnosis before signing.' });

    const c = await prisma.case.update({
      where: { id: existing.id },
      data: {
        signedAt: new Date(),
        signedById: req.ctx.userId,
        status: 'SIGNED',
        reviewedByClinicianAt: existing.reviewedByClinicianAt || new Date(),
        reviewedById: existing.reviewedById || req.ctx.userId,
        version: { increment: 1 },
      },
    });

    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'case.sign',
        resource: 'Case', resourceId: c.id, reason: 'Clinical note signed', ip: req.ip,
      },
    }).catch(() => {});

    res.json(c);
  } catch (e) { next(e); }
});

router.put('/:id/review', createEncounter, async (req, res, next) => {
  try {
    const existing = await prisma.case.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!existing) return res.status(404).json({ error: 'Case not found' });
    if (existing.signedAt) {
      return res.status(409).json({ error: 'This note is signed and cannot be edited. Create an amendment instead.' });
    }
    const { id, facilityId, authorId, occurredAt, lateEntryReason, createdAt, updatedAt, signedAt, signedById, reviewedById, version, ...rest } = req.body;
    const data = { ...rest, reviewedByClinicianAt: new Date(), reviewedById: req.ctx.userId };
    if (existing.status === 'DRAFT') data.status = 'OPEN';
    const c = await prisma.case.update({ where: { id: req.params.id }, data });
    res.json(c);
  } catch (e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.case.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Case not found' });
    // Signed clinical history is never destroyed.
    if (exists.signedAt) {
      return res.status(409).json({ error: 'A signed note cannot be deleted. It is part of the permanent record.' });
    }
    await prisma.case.delete({ where: { id: req.params.id } });
    res.json({ message: 'Case deleted' });
  } catch (e) { next(e); }
});

module.exports = router;
