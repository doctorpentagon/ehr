const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const https = require('https');
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const billingAuth = [authenticate, tenant, requirePermission('billing')];

function paystackRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from Paystack')); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

router.post('/initialize', billingAuth, async (req, res, next) => {
  try {
    const { amount, email, invoiceId, plan, metadata = {} } = req.body;
    if (!amount || !email) return res.status(400).json({ error: 'amount and email are required' });
    const reference = `AWB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    if (!PAYSTACK_SECRET) {
      return res.json({
        reference,
        authorizationUrl: `https://checkout.paystack.com/mock?ref=${reference}&amount=${amount}`,
        accessCode: 'mock_access_code',
      });
    }
    const body = JSON.stringify({
      email, amount: Math.round(amount * 100), reference,
      metadata: { ...metadata, invoiceId, plan, facilityId: req.ctx.facilityId },
      callback_url: `${process.env.FRONTEND_URL || 'http://localhost:5177'}/dashboard/billing?ref=${reference}`,
    });
    const psRes = await paystackRequest({
      hostname: 'api.paystack.co', port: 443, path: '/transaction/initialize', method: 'POST',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    if (!psRes.status) return res.status(502).json({ error: 'Paystack initialization failed', detail: psRes });
    res.json({ reference: psRes.data.reference, authorizationUrl: psRes.data.authorization_url, accessCode: psRes.data.access_code });
  } catch (e) { next(e); }
});

router.get('/verify/:reference', billingAuth, async (req, res, next) => {
  try {
    const { reference } = req.params;
    if (!PAYSTACK_SECRET) {
      return res.json({ status: 'success', reference, amount: 0, paidAt: new Date() });
    }
    const psRes = await paystackRequest({
      hostname: 'api.paystack.co', port: 443,
      path: `/transaction/verify/${encodeURIComponent(reference)}`, method: 'GET',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    }, null);
    if (!psRes.status || psRes.data?.status !== 'success') {
      return res.status(402).json({ error: 'Payment not successful', detail: psRes.data });
    }
    const { amount, metadata, paid_at } = psRes.data;
    const amountNaira = amount / 100;

    if (metadata?.invoiceId) {
      const inv = await prisma.invoice.findFirst({ where: { id: metadata.invoiceId, facilityId: req.ctx.facilityId } });
      if (inv) {
        const newPaid = Number(inv.amountPaid) + amountNaira;
        const newBalance = Number(inv.total) - newPaid;
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { amountPaid: newPaid, balance: newBalance, paystackRef: reference, paidAt: paid_at ? new Date(paid_at) : new Date(), paymentStatus: newBalance <= 0 ? 'PAID' : 'PART_PAID' },
        });
      }
    }

    if (metadata?.plan) {
      const PLAN_LIMITS = {
        SMALL:       { patientLimit: 200,  staffLimit: 10 },
        CLINIC_PLUS: { patientLimit: 2000, staffLimit: 50 },
        INSTITUTION: { patientLimit: 99999, staffLimit: 999 },
      };
      const limits = PLAN_LIMITS[metadata.plan] || {};
      const endDate = new Date(); endDate.setMonth(endDate.getMonth() + 1);
      let sub = await prisma.subscription.findUnique({ where: { facilityId: req.ctx.facilityId } });
      if (sub) {
        await prisma.subscription.update({
          where: { facilityId: req.ctx.facilityId },
          data: { plan: metadata.plan, status: 'ACTIVE', paystackRef: reference, endDate, ...limits },
        });
      } else {
        await prisma.subscription.create({
          data: {
            facilityId: req.ctx.facilityId, plan: metadata.plan, status: 'ACTIVE',
            paystackRef: reference, startDate: new Date(), endDate,
            patientsUsed: 0, staffUsed: 0, ...limits,
          },
        });
      }
      await prisma.facility.update({ where: { id: req.ctx.facilityId }, data: { plan: metadata.plan } });
    }

    res.json({ status: 'success', reference, amount: amountNaira, paidAt: paid_at, metadata });
  } catch (e) { next(e); }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) return res.status(401).json({ error: 'Invalid signature' });
    const event = JSON.parse(req.body);
    console.log('[Paystack webhook]', event.event);
    res.sendStatus(200);
  } catch (e) { next(e); }
});

module.exports = router;
