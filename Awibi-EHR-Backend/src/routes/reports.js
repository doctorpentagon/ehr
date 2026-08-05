const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

const auth = [authenticate, tenant, requirePermission('reports')];

router.get('/patients', auth, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const fid = req.ctx.facilityId;
    const dateFilter = startDate && endDate ? { gte: new Date(startDate), lte: new Date(endDate) } : undefined;
    const where = { facilityId: fid };
    const whereDate = dateFilter ? { ...where, createdAt: dateFilter } : where;

    const [total, male, female, inPatient, outPatient, discharged] = await prisma.$transaction([
      prisma.patient.count({ where: whereDate }),
      prisma.patient.count({ where: { ...whereDate, gender: 'MALE' } }),
      prisma.patient.count({ where: { ...whereDate, gender: 'FEMALE' } }),
      prisma.patient.count({ where: { ...where, status: 'IN_PATIENT' } }),
      prisma.patient.count({ where: { ...where, status: 'OUT_PATIENT' } }),
      prisma.patient.count({ where: { ...where, status: 'DISCHARGED' } }),
    ]);
    res.json({ total, male, female, inPatient, outPatient, discharged });
  } catch (e) { next(e); }
});

router.get('/disease-incidence', auth, async (req, res, next) => {
  try {
    const grouped = await prisma.condition.groupBy({
      by: ['name'],
      where: { facilityId: req.ctx.facilityId },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });
    res.json(grouped.map(r => ({ name: r.name, count: r._count.id })));
  } catch (e) { next(e); }
});

router.get('/lab', auth, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const [pending, completed, imaging, lab] = await prisma.$transaction([
      prisma.labRequest.count({ where: { facilityId: fid, status: 'PENDING' } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'COMPLETED' } }),
      prisma.labRequest.count({ where: { facilityId: fid, testType: 'IMAGING' } }),
      prisma.labRequest.count({ where: { facilityId: fid, testType: 'LAB' } }),
    ]);
    res.json({ pending, completed, imaging, lab });
  } catch (e) { next(e); }
});

module.exports = router;
