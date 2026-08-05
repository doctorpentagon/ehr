const express = require('express');

const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { normalisePhone } = require('../utils/patientValidation');

/**
 * Enquiries from the public: someone who has made contact but is not yet a patient.
 *
 * These are read and worked by the records desk. The public endpoint that creates
 * them lives in `public.js` because it must remain unauthenticated.
 */
const read = [authenticate, tenant, requirePermission('patients')];
const write = [authenticate, tenant, requirePermission('patient_demographics_write')];

const STATUSES = ['NEW', 'CONTACTED', 'BOOKED', 'CLOSED'];

router.get('/', read, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    // `ALL` means no filter. Matched against the enum it returns nothing, which
    // reads to staff as "the enquiries have disappeared".
    if (status && status !== 'ALL') where.status = status;

    const take = Math.min(Number(limit) || 50, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [inquiries, total, counts] = await Promise.all([
      prisma.patientInquiry.findMany({
        where,
        // Anything flagged urgent by the symptom routing goes to the top,
        // regardless of when it came in.
        orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
        take, skip,
      }),
      prisma.patientInquiry.count({ where }),
      prisma.patientInquiry.groupBy({
        by: ['status'],
        where: { facilityId: req.ctx.facilityId },
        _count: true,
      }),
    ]);

    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    res.json({
      inquiries,
      total,
      counts: {
        new: byStatus.NEW || 0,
        contacted: byStatus.CONTACTED || 0,
        booked: byStatus.BOOKED || 0,
        closed: byStatus.CLOSED || 0,
        urgentWaiting: await prisma.patientInquiry.count({
          where: { facilityId: req.ctx.facilityId, isUrgent: true, status: 'NEW' },
        }),
      },
    });
  } catch (e) { next(e); }
});

router.get('/:id', read, async (req, res, next) => {
  try {
    const inquiry = await prisma.patientInquiry.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!inquiry) return res.status(404).json({ error: 'Enquiry not found' });
    res.json(inquiry);
  } catch (e) { next(e); }
});

/** Move an enquiry along, recording who dealt with it and what was said. */
router.put('/:id/status', write, async (req, res, next) => {
  try {
    const inquiry = await prisma.patientInquiry.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!inquiry) return res.status(404).json({ error: 'Enquiry not found' });

    const { status, responseNote } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}`, field: 'status' });
    }
    // "We called them" is only useful if it says what happened.
    if (status === 'CONTACTED' && String(responseNote || '').trim().length < 3) {
      return res.status(400).json({ error: 'Say what was discussed', field: 'responseNote' });
    }

    const updated = await prisma.patientInquiry.update({
      where: { id: inquiry.id },
      data: {
        status,
        responseNote: responseNote || inquiry.responseNote,
        handledById: req.ctx.userId,
        handledAt: new Date(),
      },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

/**
 * The details needed to open a registration form, already parsed.
 *
 * Retyping a name and phone number that the person has already given is how
 * transcription errors enter the record, so the form is prefilled from what
 * they actually submitted.
 */
router.get('/:id/prefill', read, async (req, res, next) => {
  try {
    const inquiry = await prisma.patientInquiry.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!inquiry) return res.status(404).json({ error: 'Enquiry not found' });

    const parts = String(inquiry.name || '').trim().split(/\s+/).filter(Boolean);
    const phone = normalisePhone(inquiry.phone);

    res.json({
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      // Only offer a number the registration form will actually accept.
      phone: phone.ok ? phone.value : null,
      phoneNeedsChecking: !phone.ok && Boolean(inquiry.phone),
      rawPhone: inquiry.phone || null,
      email: inquiry.email || null,
      inquiryId: inquiry.id,
      context: {
        symptoms: inquiry.symptomsText,
        suggestedDepartment: inquiry.suggestedDepartment,
        isUrgent: inquiry.isUrgent,
      },
    });
  } catch (e) { next(e); }
});

/** Link an enquiry to the patient record it became. */
router.put('/:id/link-patient', write, async (req, res, next) => {
  try {
    const { patientId } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required', field: 'patientId' });

    const [inquiry, patient] = await Promise.all([
      prisma.patientInquiry.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } }),
      prisma.patient.findFirst({ where: { id: patientId, facilityId: req.ctx.facilityId } }),
    ]);
    if (!inquiry) return res.status(404).json({ error: 'Enquiry not found' });
    if (!patient) return res.status(404).json({ error: 'Patient not found in this facility' });

    const updated = await prisma.patientInquiry.update({
      where: { id: inquiry.id },
      data: {
        patientId, status: 'BOOKED',
        handledById: req.ctx.userId, handledAt: new Date(),
      },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
