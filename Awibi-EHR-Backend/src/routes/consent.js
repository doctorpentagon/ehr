const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

const auth = [authenticate, tenant, requirePermission('patients')];

router.post('/', auth, async (req, res, next) => {
  try {
    const { patientId, purpose } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    const patient = await prisma.patient.findFirst({ where: { id: patientId, facilityId: req.ctx.facilityId } });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    const grant = await prisma.consentGrant.create({
      data: {
        patientId, facilityId: req.ctx.facilityId,
        grantedBy: req.ctx.userId,
        purpose: purpose || 'General treatment',
        isActive: true,
        ip: req.ip,
      },
    });
    res.status(201).json(grant);
  } catch (e) { next(e); }
});

router.get('/patient/:patientId', auth, async (req, res, next) => {
  try {
    const grants = await prisma.consentGrant.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ grants });
  } catch (e) { next(e); }
});

router.put('/:id/revoke', auth, async (req, res, next) => {
  try {
    const grant = await prisma.consentGrant.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!grant) return res.status(404).json({ error: 'Consent grant not found' });
    const updated = await prisma.consentGrant.update({
      where: { id: req.params.id },
      data: { isActive: false, revokedAt: new Date() },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
