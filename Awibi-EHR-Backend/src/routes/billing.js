const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantAppointment } = require('../utils/tenantRecords');
const { buildInvoicePdf } = require('../utils/invoicePdf');

const auth = [authenticate, tenant, requirePermission('billing')];

router.get('/', auth, async (req, res, next) => {
  try {
    const { paymentStatus, page = 1, limit = 20, startDate, endDate, search } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (startDate && endDate) where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        {
          patient: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { universalPatientId: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, invoices] = await prisma.$transaction([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, phone: true } } },
      }),
    ]);
    res.json({ invoices, total });
  } catch (e) { next(e); }
});

router.get('/summary', auth, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const [totalBilledAgg, totalCollectedAgg, unpaidCount] = await prisma.$transaction([
      prisma.invoice.aggregate({ where: { facilityId: fid }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: { facilityId: fid }, _sum: { amountPaid: true } }),
      prisma.invoice.count({ where: { facilityId: fid, paymentStatus: { in: ['UNPAID', 'PART_PAID'] } } }),
    ]);
    const totalBilled = Number(totalBilledAgg._sum.total || 0);
    const totalCollected = Number(totalCollectedAgg._sum.amountPaid || 0);
    const outstanding = Math.max(0, totalBilled - totalCollected);
    res.json({ totalBilled, totalCollected, outstanding, unpaidCount });
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { patient: true, appointment: true },
    });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (e) { next(e); }
});

// Build a draft invoice from what actually happened in an encounter, so staff
// never re-key charges that the clinical record already knows about.
router.get('/draft-from-case/:caseId', auth, async (req, res, next) => {
  try {
    const clinicalCase = await prisma.case.findFirst({
      where: { id: req.params.caseId, facilityId: req.ctx.facilityId },
      include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, householdId: true } } },
    });
    if (!clinicalCase) return res.status(404).json({ error: 'Case not found' });

    const [labs, prescriptions, catalogue] = await prisma.$transaction([
      prisma.labRequest.findMany({
        where: { caseId: clinicalCase.id, facilityId: req.ctx.facilityId, status: { not: 'CANCELLED' } },
      }),
      prisma.prescription.findMany({ where: { caseId: clinicalCase.id, facilityId: req.ctx.facilityId } }),
      prisma.diagnosticTest.findMany({ where: { facilityId: req.ctx.facilityId, isActive: true } }),
    ]);

    const priceOf = (testName) => Number(catalogue.find((c) => c.name === testName)?.price || 0);
    const settings = (await prisma.facility.findUnique({ where: { id: req.ctx.facilityId }, select: { settings: true } }))?.settings || {};
    const consultationFee = Number(settings.consultationFee ?? 5000);

    const items = [
      { category: 'Consultation', description: `${clinicalCase.encounterType?.replace(/_/g, ' ').toLowerCase() || 'consultation'} — ${clinicalCase.title || 'encounter'}`, quantity: 1, unitPrice: consultationFee, amount: consultationFee },
      ...labs.map((l) => ({
        category: l.testType === 'IMAGING' ? 'Imaging' : 'Laboratory',
        description: l.testName, quantity: 1, unitPrice: priceOf(l.testName), amount: priceOf(l.testName),
        sourceType: 'LAB_REQUEST', sourceId: l.id,
      })),
      ...prescriptions.map((p) => ({
        category: 'Medication',
        description: [p.drugName, p.dosage, p.frequency, p.duration].filter(Boolean).join(' · '),
        // Drug pricing is not modelled yet; staff set it before sending.
        quantity: 1, unitPrice: 0, amount: 0,
        sourceType: 'PRESCRIPTION', sourceId: p.id,
      })),
    ];

    const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    res.json({
      caseId: clinicalCase.id,
      patient: clinicalCase.patient,
      items,
      subtotal,
      warnings: prescriptions.length
        ? ['Medication prices are not in the catalogue yet — set them before sending this invoice.']
        : [],
    });
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { patientId, appointmentId, items, discount, dueDate, notes } = req.body;
    if (!patientId || !items?.length) return res.status(400).json({ error: 'patientId and items required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (appointmentId) await requireTenantAppointment(req.ctx.facilityId, appointmentId, patientId);
    const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const total = subtotal - Number(discount || 0);
    const inv = await prisma.invoice.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, appointmentId: appointmentId || null,
        invoiceNumber: `INV-${Date.now()}`,
        items, subtotal, discount: Number(discount || 0), total, balance: total,
        dueDate: dueDate ? new Date(dueDate) : null, notes,
      },
    });
    res.status(201).json(inv);
  } catch (e) { next(e); }
});

// Itemised invoice PDF. Regenerated on demand from live data rather than cached,
// so a corrected charge or payment is always reflected.
router.get('/:id/pdf', auth, async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: {
          include: {
            household: { select: { id: true, name: true, principalPatientId: true } },
            insurances: { where: { isActive: true }, take: 1, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const facility = await prisma.facility.findUnique({ where: { id: req.ctx.facilityId } });

    // A dependant's bill is addressed to the household principal.
    let responsibleParty = null;
    const household = invoice.patient.household;
    if (household?.principalPatientId && household.principalPatientId !== invoice.patientId) {
      responsibleParty = await prisma.patient.findFirst({
        where: { id: household.principalPatientId, facilityId: req.ctx.facilityId },
        select: { id: true, firstName: true, lastName: true, universalPatientId: true },
      });
    }

    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const pdf = await buildInvoicePdf({
      invoice,
      facility,
      patient: invoice.patient,
      household,
      insurance: invoice.patient.insurances?.[0] || null,
      items,
      responsibleParty,
    });

    prisma.auditLog.create({
      data: {
        facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'invoice.pdf.download',
        resource: 'Invoice', resourceId: invoice.id, reason: 'Invoice PDF generated', ip: req.ip,
      },
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (e) { next(e); }
});

router.post('/:id/pay', auth, async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    const ref = `AWB-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    res.json({ reference: ref, amount: Math.round(Number(inv.balance) * 100), currency: 'NGN', invoiceId: inv.id });
  } catch (e) { next(e); }
});

router.post('/paystack-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const sig = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
  if (hash !== sig) return res.status(401).end();
  try {
    const event = JSON.parse(req.body);
    if (event.event === 'charge.success') {
      const ref = event.data?.reference;
      const paid = event.data?.amount / 100;
      const inv = await prisma.invoice.findFirst({ where: { paystackRef: ref } });
      if (inv) {
        // Paystack retries a webhook until it gets a 200, and duplicates are
        // normal. Crediting the same reference twice would show a patient as
        // having paid double, so the reference is the idempotency key.
        const already = await prisma.payment.findFirst({
          where: { invoiceId: inv.id, reference: ref, isVoided: false },
        });
        if (already) return res.status(200).end();

        const outstanding = Number(inv.balance);
        const applied = Math.min(paid, outstanding);
        const newPaid = Number((Number(inv.amountPaid) + applied).toFixed(2));
        const balance = Number((Number(inv.total) - newPaid).toFixed(2));
        const settled = balance <= 0;

        await prisma.$transaction([
          prisma.payment.create({
            data: {
              facilityId: inv.facilityId,
              invoiceId: inv.id,
              amount: applied,
              changeGiven: Number((paid - applied).toFixed(2)),
              method: 'CARD',
              reference: ref,
              note: 'Paystack charge.success',
            },
          }),
          prisma.invoice.update({
            where: { id: inv.id },
            data: {
              amountPaid: newPaid, balance, paystackRef: ref,
              paidAt: settled ? new Date() : inv.paidAt,
              paymentStatus: settled ? 'PAID' : 'PART_PAID',
            },
          }),
        ]);
        if (inv.appointmentId) {
          await prisma.appointment.update({
            where: { id: inv.appointmentId },
            data: { paymentStatus: settled ? 'PAID' : 'PART_PAID', paystackRef: ref, paidAmount: newPaid },
          });
        }
      }
    }
    res.status(200).end();
  } catch { res.status(200).end(); }
});

router.put('/:id/mark-paid', auth, async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (Number(inv.balance) <= 0) return res.json(inv);

    // Settling an invoice in one action still has to appear in the cash book,
    // otherwise the drawer and the reports disagree by exactly this amount.
    const outstanding = Number(inv.balance);
    const [, updated] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          facilityId: req.ctx.facilityId,
          invoiceId: inv.id,
          amount: outstanding,
          method: PAYMENT_METHODS.includes(req.body?.method) ? req.body.method : 'CASH',
          note: 'Marked paid in full',
          receivedById: req.user?.id || null,
        },
      }),
      prisma.invoice.update({
        where: { id: inv.id },
        data: { amountPaid: inv.total, balance: 0, paymentStatus: 'PAID', paidAt: new Date() },
      }),
    ]);
    res.json(updated);
  } catch (e) { next(e); }
});

const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'POS', 'HMO', 'WAIVER'];

/**
 * Record money received against an invoice.
 *
 * This used to take `amount` straight from the request and add it to
 * `amountPaid`, which allowed three ways to corrupt the facility's books:
 * a negative amount erased collections that had already been recorded, an
 * overpayment inflated takings by the change still sitting in the till, and a
 * missing or non-numeric amount wrote NaN and returned a Prisma stack trace
 * with the server's file paths in it.
 *
 * Every payment is now also written as its own row so the day's takings can be
 * reconciled against the drawer and each sum is attributable to the cashier who
 * took it.
 */
router.put('/:id/record-payment', auth, async (req, res, next) => {
  try {
    const { amount, method = 'CASH', reference, note } = req.body;

    const value = Number(amount);
    if (!Number.isFinite(value)) {
      return res.status(400).json({ error: 'Enter the amount received', field: 'amount' });
    }
    if (value <= 0) {
      // A refund or a correction must be an explicit, reasoned action that
      // leaves a trace — not a negative payment that quietly rewrites history.
      return res.status(400).json({
        error: 'A payment must be greater than zero. To reverse a payment, void it instead.',
        field: 'amount',
      });
    }
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ error: `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`, field: 'method' });
    }

    const inv = await prisma.invoice.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!inv) return res.status(404).json({ error: 'Not found' });

    const outstanding = Number(inv.balance);
    if (outstanding <= 0) {
      return res.status(400).json({ error: 'This invoice is already settled', balance: 0 });
    }

    // A patient handing over more than the balance is normal; the excess is
    // change owed back, not income. Apply only what the invoice is owed.
    const applied = Math.min(value, outstanding);
    const changeGiven = Number((value - applied).toFixed(2));

    const newPaid = Number((Number(inv.amountPaid) + applied).toFixed(2));
    const balance = Number((Number(inv.total) - newPaid).toFixed(2));
    const settled = balance <= 0;

    const [, updated] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          facilityId: req.ctx.facilityId,
          invoiceId: inv.id,
          amount: applied,
          changeGiven,
          method,
          reference: reference || null,
          note: note || null,
          receivedById: req.user?.id || null,
        },
      }),
      prisma.invoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: newPaid,
          balance,
          paymentStatus: settled ? 'PAID' : 'PART_PAID',
          // Only a settled invoice has a payment date. Stamping this on every
          // part-payment made unpaid invoices look closed on every report.
          paidAt: settled ? new Date() : inv.paidAt,
          paystackRef: reference || inv.paystackRef,
        },
      }),
    ]);

    res.json({ ...updated, applied, changeGiven });
  } catch (e) { next(e); }
});

/** The payment history behind an invoice's balance. */
router.get('/:id/payments', auth, async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const payments = await prisma.payment.findMany({
      where: { invoiceId: inv.id },
      orderBy: { receivedAt: 'desc' },
      include: { receivedBy: { select: { firstName: true, lastName: true, staffId: true } } },
    });
    res.json({ payments, totalReceived: payments.filter((p) => !p.isVoided).reduce((s, p) => s + Number(p.amount), 0) });
  } catch (e) { next(e); }
});

/**
 * Void a payment entered in error. The row stays, marked and reasoned, and the
 * invoice balance is recomputed from the surviving payments — so the books show
 * what happened rather than pretending the mistake never occurred.
 */
router.put('/payments/:paymentId/void', auth, async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) {
      return res.status(400).json({ error: 'Give a reason for voiding this payment', field: 'reason' });
    }

    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId, facilityId: req.ctx.facilityId },
      include: { invoice: true },
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.isVoided) return res.status(400).json({ error: 'This payment is already voided' });

    const remaining = await prisma.payment.findMany({
      where: { invoiceId: payment.invoiceId, isVoided: false, id: { not: payment.id } },
      select: { amount: true },
    });
    const newPaid = Number(remaining.reduce((s, p) => s + Number(p.amount), 0).toFixed(2));
    const total = Number(payment.invoice.total);
    const balance = Number((total - newPaid).toFixed(2));
    const settled = balance <= 0;

    const [voided, invoice] = await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { isVoided: true, voidReason: reason, voidedById: req.user?.id || null, voidedAt: new Date() },
      }),
      prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          amountPaid: newPaid,
          balance,
          paymentStatus: settled ? 'PAID' : (newPaid > 0 ? 'PART_PAID' : 'UNPAID'),
          paidAt: settled ? payment.invoice.paidAt : null,
        },
      }),
    ]);

    res.json({ payment: voided, invoice });
  } catch (e) { next(e); }
});

module.exports = router;
