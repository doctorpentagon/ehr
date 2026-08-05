const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantDepartment } = require('../utils/tenantRecords');

const auth = [authenticate, tenant, requirePermission('departments')];

router.get('/', auth, async (req, res, next) => {
  try {
    const depts = await prisma.department.findMany({
      where: { facilityId: req.ctx.facilityId },
      include: { beds: { select: { id: true, status: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(depts);
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const d = await prisma.department.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { beds: true },
    });
    if (!d) return res.status(404).json({ error: 'Department not found' });
    res.json(d);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { name, code, description, isEmergency } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const d = await prisma.department.create({
      data: { facilityId: req.ctx.facilityId, name, code, description, isEmergency: !!isEmergency },
    });
    res.status(201).json(d);
  } catch (e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.department.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { id, facilityId, createdAt, updatedAt, ...data } = req.body;
    const d = await prisma.department.update({ where: { id: req.params.id }, data });
    res.json(d);
  } catch (e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.department.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    await prisma.department.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

router.get('/:id/beds', auth, async (req, res, next) => {
  try {
    res.json(await prisma.bed.findMany({ where: { departmentId: req.params.id, facilityId: req.ctx.facilityId } }));
  } catch (e) { next(e); }
});

router.post('/:id/beds', auth, async (req, res, next) => {
  try {
    const { bedNumber, ward, type, status } = req.body;
    await requireTenantDepartment(req.ctx.facilityId, req.params.id);
    const b = await prisma.bed.create({
      data: { departmentId: req.params.id, facilityId: req.ctx.facilityId, bedNumber, ward, type, status: status || 'AVAILABLE' },
    });
    res.status(201).json(b);
  } catch (e) { next(e); }
});

module.exports = router;
