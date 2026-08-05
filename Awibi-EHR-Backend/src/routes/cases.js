const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');

const auth = [authenticate, tenant, requirePermission('cases')];

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
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
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
        encounterTypeConfig: { select: { id: true, name: true, description: true } },
        vitals: true,
      },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    prisma.auditLog.create({ data: { facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'case.view', resource: 'Case', resourceId: c.id, reason: req.query.reason || 'Treatment', ip: req.ip } }).catch(() => {});
    res.json(c);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { patientId, title, chiefComplaint, history, examination, assessment, plan, notes,
      captureMethod, audioUrl, transcription, scanUrl, ocrText, icdCodes, aiSuggestions,
      encounterType, encounterTypeId, doctorsOrders } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);

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
    const isDraft = method === 'VOICE' || method === 'OCR';
    const c = await prisma.case.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, authorId: req.ctx.userId,
        title, chiefComplaint, history, examination, assessment, plan, notes,
        captureMethod: method,
        encounterTypeId: chosen.id,
        encounterType: encounterType || 'CONSULTATION',
        doctorsOrders: doctorsOrders || null,
        audioUrl, transcription, scanUrl, ocrText,
        icdCodes: icdCodes || [],
        aiSuggestions: aiSuggestions || {},
        status: isDraft ? 'DRAFT' : 'OPEN',
        reviewedByClinicianAt: isDraft ? null : new Date(),
      },
    });
    res.status(201).json(c);
  } catch (e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
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

    const { id, facilityId, authorId, createdAt, updatedAt, signedAt, signedById, version, ...data } = req.body;

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
    const hasContent = [existing.chiefComplaint, existing.history, existing.examination,
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

router.put('/:id/review', auth, async (req, res, next) => {
  try {
    const existing = await prisma.case.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!existing) return res.status(404).json({ error: 'Case not found' });
    if (existing.signedAt) {
      return res.status(409).json({ error: 'This note is signed and cannot be edited. Create an amendment instead.' });
    }
    const { id, facilityId, authorId, createdAt, updatedAt, signedAt, signedById, version, ...rest } = req.body;
    const data = { ...rest, reviewedByClinicianAt: new Date() };
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
