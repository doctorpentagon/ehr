const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

const auth = [authenticate, tenant, requirePermission('affiliates')];

router.get('/', auth, async (req, res, next) => {
  try {
    const affiliates = await prisma.affiliate.findMany({
      where: { facilityId: req.ctx.facilityId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ affiliates });
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { name, type, contactName, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const affiliate = await prisma.affiliate.create({
      data: { facilityId: req.ctx.facilityId, name, type, contactName, phone, email, address, notes },
    });
    res.status(201).json(affiliate);
  } catch (e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.affiliate.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { id, facilityId, createdAt, updatedAt, ...data } = req.body;
    const a = await prisma.affiliate.update({ where: { id: req.params.id }, data });
    res.json(a);
  } catch (e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.affiliate.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    await prisma.affiliate.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

module.exports = router;
