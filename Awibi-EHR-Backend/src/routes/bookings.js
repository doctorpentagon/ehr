const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { ensureUniqueUPID } = require('../utils/upid');
const { allocateMrn } = require('../utils/patientValidation');

// Booking review is front-desk/administrative work. It deliberately uses the
// `bookings` permission rather than `appointments`: clinicians hold
// `appointments` so they can run their own diary, but confirming a public
// booking request is reception's decision, not a nurse's or doctor's.
const auth = [authenticate, tenant, requirePermission('bookings')];

function audit(req, action, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId, action,
      resource: 'BookingRequest', resourceId, reason: reason || 'Booking review', ip: req.ip,
    },
  }).catch(() => {});
}

router.get('/', auth, async (req, res, next) => {
  try {
    const { status = 'PENDING', limit = 50 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (status && status !== 'ALL') where.status = status;

    const requests = await prisma.bookingRequest.findMany({
      where, take: Math.min(Number(limit) || 50, 100),
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
    });

    // Attach the referenced doctor without a relation on the model.
    const doctorIds = [...new Set(requests.map((r) => r.doctorId).filter(Boolean))];
    const doctors = doctorIds.length
      ? await prisma.user.findMany({
        where: { id: { in: doctorIds } },
        select: { id: true, firstName: true, lastName: true, specialty: true },
      })
      : [];
    const byId = Object.fromEntries(doctors.map((d) => [d.id, d]));

    res.json({
      requests: requests.map((r) => ({ ...r, doctor: r.doctorId ? byId[r.doctorId] || null : null })),
      total: requests.length,
    });
  } catch (e) { next(e); }
});

router.get('/stats', auth, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const [pending, emergencyRouted, today] = await prisma.$transaction([
      prisma.bookingRequest.count({ where: { facilityId: fid, status: 'PENDING' } }),
      prisma.bookingRequest.count({ where: { facilityId: fid, status: 'PENDING', routing: 'EMERGENCY' } }),
      prisma.bookingRequest.count({
        where: {
          facilityId: fid, status: 'PENDING',
          requestedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lt: new Date(new Date().setHours(23, 59, 59, 999)) },
        },
      }),
    ]);
    res.json({ pending, emergencyRouted, forToday: today });
  } catch (e) { next(e); }
});

/**
 * Confirm a request: create the appointment, and for a new patient create the
 * record too. The patient row is intentionally minimal — reception completes
 * the full registration when the person arrives.
 */
router.post('/:id/confirm', auth, async (req, res, next) => {
  try {
    const booking = await prisma.bookingRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!booking) return res.status(404).json({ error: 'Booking request not found' });
    if (booking.status !== 'PENDING') return res.status(409).json({ error: `This request is already ${booking.status.toLowerCase()}` });

    const { scheduledAt, doctorId, note } = req.body || {};
    const when = scheduledAt ? new Date(scheduledAt) : booking.requestedAt;
    if (Number.isNaN(new Date(when).getTime())) return res.status(400).json({ error: 'Invalid appointment time' });

    const finalDoctorId = doctorId || booking.doctorId || null;
    if (finalDoctorId) {
      const doctor = await prisma.user.findFirst({
        where: { id: finalDoctorId, facilityId: req.ctx.facilityId, isActive: true },
      });
      if (!doctor) return res.status(400).json({ error: 'That clinician is not part of this facility' });

      // The same double-booking rule the internal calendar uses.
      const clash = await prisma.appointment.findFirst({
        where: {
          facilityId: req.ctx.facilityId, doctorId: finalDoctorId, scheduledAt: new Date(when),
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
      });
      if (clash) return res.status(409).json({ error: 'That clinician already has an appointment at this time' });
    }

    const upid = booking.patientId ? null : await ensureUniqueUPID();

    const result = await prisma.$transaction(async (tx) => {
      let patientId = booking.patientId;

      if (!patientId) {
        const parts = booking.fullName.trim().split(/\s+/);
        // This is a real person who will walk into the clinic, so they need the
        // number reception quotes to pull a chart. Without it they existed in
        // the system but could not be found the way staff actually search.
        const mrn = await allocateMrn(tx, req.ctx.facilityId);
        const created = await tx.patient.create({
          data: {
            facilityId: req.ctx.facilityId,
            universalPatientId: upid,
            mrn,
            firstName: parts[0],
            lastName: parts.slice(1).join(' ') || 'Unknown',
            phone: booking.phone,
            email: booking.email,
            dateOfBirth: booking.dateOfBirth,
            entryMode: 'ONLINE_BOOKING',
            notes: 'Created from an online booking — registration not yet completed.',
          },
        });
        patientId = created.id;
      }

      const appointment = await tx.appointment.create({
        data: {
          facilityId: req.ctx.facilityId,
          patientId,
          doctorId: finalDoctorId,
          scheduledAt: new Date(when),
          visitType: 'ROUTINE',
          status: 'CONFIRMED',
          remarks: booking.reason || null,
        },
      });

      const updated = await tx.bookingRequest.update({
        where: { id: booking.id },
        data: {
          status: 'CONFIRMED',
          reviewedById: req.ctx.userId,
          reviewedAt: new Date(),
          decisionNote: note || null,
          appointmentId: appointment.id,
          patientId,
        },
      });

      return { booking: updated, appointment, patientId, createdPatient: !booking.patientId };
    });

    audit(req, 'booking.confirm', booking.id, `Confirmed for ${new Date(when).toISOString()}`);
    res.json({
      message: result.createdPatient
        ? 'Appointment confirmed and a provisional patient record was created. Complete registration when the patient arrives.'
        : 'Appointment confirmed.',
      ...result,
    });
  } catch (e) { next(e); }
});

router.post('/:id/reject', auth, async (req, res, next) => {
  try {
    const booking = await prisma.bookingRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!booking) return res.status(404).json({ error: 'Booking request not found' });
    if (booking.status !== 'PENDING') return res.status(409).json({ error: `This request is already ${booking.status.toLowerCase()}` });

    const { reason } = req.body || {};
    // Someone is waiting on this answer; they deserve to know why.
    if (!reason) return res.status(400).json({ error: 'A reason is required so the patient can be told' });

    const updated = await prisma.bookingRequest.update({
      where: { id: booking.id },
      data: { status: 'REJECTED', reviewedById: req.ctx.userId, reviewedAt: new Date(), decisionNote: reason },
    });
    audit(req, 'booking.reject', booking.id, reason);
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/:id/reschedule', auth, async (req, res, next) => {
  try {
    const booking = await prisma.bookingRequest.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!booking) return res.status(404).json({ error: 'Booking request not found' });
    if (booking.status !== 'PENDING') return res.status(409).json({ error: `This request is already ${booking.status.toLowerCase()}` });

    const { requestedAt, note } = req.body || {};
    if (!requestedAt) return res.status(400).json({ error: 'A new time is required' });
    const when = new Date(requestedAt);
    if (Number.isNaN(when.getTime()) || when < new Date()) {
      return res.status(400).json({ error: 'Choose a valid future time' });
    }

    const updated = await prisma.bookingRequest.update({
      where: { id: booking.id },
      data: { requestedAt: when, status: 'PENDING', decisionNote: note || 'Rescheduled by the clinic' },
    });
    audit(req, 'booking.reschedule', booking.id, when.toISOString());
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
