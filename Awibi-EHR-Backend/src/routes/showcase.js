const express = require('express');
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');

const router = express.Router();

// A read-only index of deliberately synthetic records. This endpoint never
// creates data and never falls back to a real patient. Its only purpose is to
// let a beta tester jump into a completed example without learning every form
// first.
router.get('/', authenticate, tenant, async (req, res, next) => {
  try {
    if (process.env.LOCAL_DEMO_ACCESS !== 'true' && process.env.DEMO_MODE !== 'true') {
      return res.json({ enabled: false });
    }
    const facilityId = req.ctx.facilityId;
    const patient = await prisma.patient.findFirst({
      where: { facilityId, mrn: 'DEMO-SAMPLE-001', isArchived: false },
      select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true },
    });
    if (!patient) return res.json({ enabled: false });

    const [consultation, monitoring, appointment, admission, handover, diagnostics, message, invoice, household, insurance, affiliate] = await Promise.all([
      prisma.case.findFirst({ where: { facilityId, patientId: patient.id, title: 'Sample: Structured outpatient consultation' }, select: { id: true } }),
      prisma.monitoringSheet.findFirst({ where: { facilityId, patientId: patient.id, title: 'Sample: Fluid balance and urine output' }, select: { id: true } }),
      prisma.appointment.findFirst({ where: { facilityId, patientId: patient.id, remarks: '[Sample journey] Follow-up after medicine review' }, select: { id: true } }),
      prisma.admission.findFirst({ where: { facilityId, patientId: patient.id, notes: '[Sample journey] Nurse completed the admission after the doctor order.' }, select: { id: true } }),
      prisma.handoverNote.findFirst({ where: { facilityId, patientId: patient.id, situation: 'Sample: Admitted for blood pressure observation and medicine review.' }, select: { id: true } }),
      prisma.labRequest.count({ where: { facilityId, patientId: patient.id, testName: { startsWith: 'Sample:' } } }),
      prisma.message.findFirst({ where: { facilityId, patientId: patient.id, subject: 'Sample: Monitoring update for review' }, select: { id: true, senderId: true, recipientId: true } }),
      prisma.invoice.findFirst({ where: { facilityId, patientId: patient.id, notes: 'Synthetic paid invoice for the beta example.' }, select: { id: true } }),
      prisma.household.findFirst({ where: { facilityId, name: 'Bello household (Sample)' }, select: { id: true } }),
      prisma.insurance.findFirst({ where: { facilityId, patientId: patient.id, notes: 'Synthetic insurance record.' }, select: { id: true } }),
      prisma.affiliate.findFirst({ where: { facilityId, name: 'Awibi Demo Imaging Partner' }, select: { id: true } }),
    ]);

    res.json({
      enabled: true,
      synthetic: true,
      patient,
      examples: {
        patient: patient.id,
        consultation: consultation?.id || null,
        monitoring: monitoring?.id || null,
        appointment: appointment?.id || null,
        admission: admission?.id || null,
        handover: handover?.id || null,
        diagnostics: diagnostics || 0,
        pharmacy: true,
        orders: Boolean(monitoring),
        // The message inbox is participant-scoped. Do not advertise an example
        // that the signed-in staff member cannot actually open in their inbox.
        message: message && [message.senderId, message.recipientId].includes(req.ctx.userId) ? message.id : null,
        invoice: invoice?.id || null,
        household: household?.id || null,
        insurance: insurance?.id || null,
        affiliate: affiliate?.id || null,
      },
    });
  } catch (error) { next(error); }
});

module.exports = router;
