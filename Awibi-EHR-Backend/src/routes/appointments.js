const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { sendMail, escapeHtml } = require('../utils/mailer');
const { requireTenantPatient, requireTenantUser } = require('../utils/tenantRecords');

const auth = [authenticate, tenant, requirePermission('appointments')];

router.get('/', auth, async (req, res, next) => {
  try {
    const { date, status, doctorId, patientId, startDate, endDate, search, page = 1, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    if (doctorId) where.doctorId = doctorId;
    if (patientId) where.patientId = patientId;
    if (date) {
      const d = new Date(date);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      where.scheduledAt = { gte: d, lt: next };
    }
    if (startDate && endDate) where.scheduledAt = { gte: new Date(startDate), lte: new Date(endDate) };
    if (search) {
      where.patient = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { universalPatientId: { contains: search, mode: 'insensitive' } },
        ],
      };
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, appointments] = await prisma.$transaction([
      prisma.appointment.count({ where }),
      prisma.appointment.findMany({
        where, skip, take: Number(limit), orderBy: { scheduledAt: 'asc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true, phone: true, avatar: true } },
          doctor: { select: { id: true, firstName: true, lastName: true, specialty: true } },
        },
      }),
    ]);
    res.json({ appointments, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const a = await prisma.appointment.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: true,
        doctor: { select: { id: true, firstName: true, lastName: true, specialty: true } },
      },
    });
    if (!a) return res.status(404).json({ error: 'Appointment not found' });
    res.json(a);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { patientId, doctorId, scheduledAt, visitType, charges, remarks, duration } = req.body;
    if (!patientId || !scheduledAt) return res.status(400).json({ error: 'patientId and scheduledAt required' });
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'scheduledAt must be a valid date' });
    const chargeAmount = charges === undefined || charges === '' ? 0 : Number(charges);
    if (!Number.isFinite(chargeAmount) || chargeAmount < 0) return res.status(400).json({ error: 'charges must be a non-negative number' });
    const durationMinutes = duration === undefined || duration === '' ? 30 : Number(duration);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      return res.status(400).json({ error: 'duration must be a whole number between 5 and 480 minutes' });
    }
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (doctorId) await requireTenantUser(req.ctx.facilityId, doctorId);
    const assignedDoctorId = doctorId || (req.ctx.subRole === 'DOCTOR' ? req.ctx.userId : null);

    const a = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, doctorId: assignedDoctorId,
        scheduledAt: scheduledDate, visitType, charges: chargeAmount,
        remarks, duration: durationMinutes,
      },
    });

    if (chargeAmount > 0) {
      await tx.invoice.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, appointmentId: appointment.id,
          invoiceNumber: `INV-${Date.now()}-${appointment.id.slice(0, 8)}`,
          items: [{ description: `Consultation — ${visitType || 'Visit'}`, amount: Number(charges) }],
          subtotal: chargeAmount, total: chargeAmount, balance: chargeAmount,
          dueDate: scheduledDate,
        },
      });
    }

      return appointment;
    });

    const full = await prisma.appointment.findUnique({
      where: { id: a.id },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, email: true, phone: true } },
        doctor: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (full.patient?.email) {
      const dt = new Date(scheduledAt);
      const dateStr = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const doctorName = full.doctor ? `Dr. ${full.doctor.firstName} ${full.doctor.lastName}` : 'your assigned clinician';
      const safePatientName = escapeHtml(full.patient.firstName);
      const safeDoctorName = escapeHtml(doctorName);
      const safeVisitType = escapeHtml((visitType || 'Consultation').replace(/_/g, ' '));
      sendMail({
        to: full.patient.email,
        subject: 'Appointment Confirmation — Awibi EHR',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
            <div style="background:#0B1F66;padding:28px 32px">
              <h1 style="color:#fff;margin:0;font-size:20px">Appointment Confirmed</h1>
            </div>
            <div style="padding:28px 32px;color:#374151">
              <p style="margin-top:0">Hi <strong>${safePatientName}</strong>,</p>
              <p>Your appointment has been scheduled. Here are the details:</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;width:40%">Date</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${dateStr}</strong></td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280">Time</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${timeStr}</strong></td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;color:#6b7280">Clinician</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6"><strong>${safeDoctorName}</strong></td></tr>
                <tr><td style="padding:8px 0;color:#6b7280">Visit Type</td><td style="padding:8px 0"><strong>${safeVisitType}</strong></td></tr>
              </table>
              <p style="font-size:13px;color:#6b7280">Please arrive 10 minutes before your scheduled time. To reschedule or cancel, contact the facility directly.</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
              <p style="font-size:12px;color:#9ca3af;margin:0">This is an automated message from Awibi EHR. Please do not reply to this email.</p>
            </div>
          </div>`,
      }).catch(() => {});
    }

    res.status(201).json(full);
  } catch (e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.appointment.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Appointment not found' });
    const { id, facilityId, createdAt, updatedAt, ...data } = req.body;
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt);
    if (data.charges !== undefined) data.charges = Number(data.charges);
    if (data.duration !== undefined) data.duration = Number(data.duration);
    const a = await prisma.appointment.update({ where: { id: req.params.id }, data });
    res.json(a);
  } catch (e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.appointment.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Appointment not found' });
    await prisma.appointment.delete({ where: { id: req.params.id } });
    res.json({ message: 'Appointment cancelled' });
  } catch (e) { next(e); }
});

module.exports = router;
