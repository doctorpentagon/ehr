const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

const auth = [authenticate, tenant, requirePermission('subscription')];

const PLANS = {
  FREE:        { label: 'Free Trial',    price: 0,      patientLimit: 50,    staffLimit: 5 },
  SMALL:       { label: 'Small Clinic',  price: 20000,  patientLimit: 200,   staffLimit: 10 },
  CLINIC_PLUS: { label: 'Clinic+ / Lab', price: 45000,  patientLimit: 2000,  staffLimit: 50 },
  INSTITUTION: { label: 'Institution',   price: 300000, patientLimit: 99999, staffLimit: 999 },
};

router.get('/', auth, async (req, res, next) => {
  try {
    const sub = await prisma.subscription.findUnique({ where: { facilityId: req.ctx.facilityId } });
    res.json({ subscription: sub, plans: PLANS });
  } catch (e) { next(e); }
});

router.post('/upgrade', auth, async (req, res, next) => {
  try {
    const { plan, paystackRef } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
    const endDate = new Date(); endDate.setMonth(endDate.getMonth() + 1);
    const planData = PLANS[plan];
    let sub = await prisma.subscription.findUnique({ where: { facilityId: req.ctx.facilityId } });
    if (sub) {
      sub = await prisma.subscription.update({
        where: { facilityId: req.ctx.facilityId },
        data: { plan, status: 'ACTIVE', paystackRef, endDate, patientLimit: planData.patientLimit, staffLimit: planData.staffLimit },
      });
    } else {
      sub = await prisma.subscription.create({
        data: {
          facilityId: req.ctx.facilityId, plan, status: 'ACTIVE', paystackRef, startDate: new Date(), endDate,
          patientLimit: planData.patientLimit, staffLimit: planData.staffLimit, patientsUsed: 0, staffUsed: 0,
        },
      });
    }
    await prisma.facility.update({ where: { id: req.ctx.facilityId }, data: { plan } });
    res.json(sub);
  } catch (e) { next(e); }
});

module.exports = router;
