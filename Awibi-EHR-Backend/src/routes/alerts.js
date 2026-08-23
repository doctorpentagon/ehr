const express = require('express');

const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { can } = require('../utils/permissions');

const auth = [authenticate, tenant];
const respondToAlert = [authenticate, tenant, requirePermission('clinical_write')];

function audit(req, action, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId,
      userId: req.ctx.userId,
      action,
      resource: 'ClinicalAlert',
      resourceId,
      reason,
      ip: req.ip,
    },
  }).catch(() => {});
}

/**
 * Facility work that needs attention now.
 *
 * Most operational prompts are derived from current state. Critical observations
 * are different: they are durable safety episodes which require a named clinician
 * to acknowledge, record action and explicitly resolve them.
 */
router.get('/', auth, async (req, res, next) => {
  try {
    const facilityId = req.ctx.facilityId;
    const { role, subRole } = req.user || {};
    const isNurse = subRole === 'NURSE';
    const isDoctor = subRole === 'DOCTOR';
    const isClinical = isNurse || isDoctor;
    const seesAdmin = can(role, subRole, 'patient_demographics_write');
    const alerts = [];

    if (can(role, subRole, 'monitoring')) {
      const clinicalAlerts = await prisma.clinicalAlert.findMany({
        where: { facilityId, status: { in: ['OPEN', 'ACKNOWLEDGED', 'ACTED_ON'] } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const patientIds = [...new Set(clinicalAlerts.map((item) => item.patientId))];
      const patients = patientIds.length > 0
        ? await prisma.patient.findMany({
          where: { facilityId, id: { in: patientIds } },
          select: { id: true, firstName: true, lastName: true, mrn: true },
        })
        : [];
      const patientById = new Map(patients.map((patient) => [patient.id, patient]));

      for (const item of clinicalAlerts) {
        alerts.push({
          id: item.id,
          lifecycleId: item.id,
          persistent: true,
          severity: item.severity,
          category: item.category,
          status: item.status,
          title: item.title,
          detail: item.detail,
          latestValue: item.latestValue,
          latestUnit: item.latestUnit,
          normalizedAt: item.normalizedAt,
          assignedToId: item.assignedToId,
          acknowledgedAt: item.acknowledgedAt,
          actionAt: item.actionAt,
          actionNote: item.actionNote,
          patient: patientById.get(item.patientId) || null,
          at: item.createdAt,
          link: item.sourceType === 'MONITORING'
            ? `/dashboard/nursing/sheet/${item.sourceId}`
            : item.sourceType === 'LAB_REQUEST'
              ? '/dashboard/lab'
              : null,
        });
      }
    }

    if (can(role, subRole, 'orders')) {
      const orders = await prisma.order.findMany({
        where: { facilityId, status: 'ACTIVE', frequencyHours: { not: null } },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          executions: { where: { outcome: 'DONE' }, orderBy: { executedAt: 'desc' }, take: 1 },
        },
        take: 200,
      });

      for (const order of orders) {
        const from = order.executions[0]?.executedAt || order.startAt;
        const dueAt = new Date(new Date(from).getTime() + order.frequencyHours * 3600_000);
        const graceMs = order.frequencyHours * 3600_000 * 0.25;
        if (Date.now() <= dueAt.getTime() + graceMs) continue;
        const hoursLate = Math.round(((Date.now() - dueAt.getTime()) / 3600_000) * 10) / 10;
        alerts.push({
          id: `overdue:${order.id}`,
          severity: hoursLate > order.frequencyHours ? 'CRITICAL' : 'WARNING',
          category: 'ORDER',
          title: `${order.name} is overdue`,
          detail: `Due every ${order.frequencyHours}h - ${hoursLate}h late`,
          patient: order.patient,
          at: dueAt,
          link: '/dashboard/nursing/orders',
        });
      }
    }

    if (isNurse) {
      const reviews = await prisma.monitoringReview.findMany({
        where: { facilityId, resolvedAt: null, kind: { not: 'ACKNOWLEDGED' } },
        orderBy: { raisedAt: 'desc' },
        take: 50,
        include: {
          sheet: {
            select: {
              id: true,
              title: true,
              patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
            },
          },
        },
      });
      for (const review of reviews) {
        alerts.push({
          id: `review:${review.id}`,
          severity: 'WARNING',
          category: 'REVIEW',
          title: review.kind === 'CORRECTION_REQUESTED'
            ? 'A doctor has asked for a recheck'
            : 'A doctor has asked to change the plan',
          detail: review.comment,
          patient: review.sheet?.patient,
          at: review.raisedAt,
          link: `/dashboard/nursing/sheet/${review.sheet?.id}`,
        });
      }
    }

    if (isClinical || can(role, subRole, 'emergency')) {
      const running = await prisma.resuscitationEvent.findMany({
        where: { facilityId, endedAt: null },
        include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true } } },
      });
      for (const event of running) {
        alerts.push({
          id: `resus:${event.id}`,
          severity: 'CRITICAL',
          category: 'RESUSCITATION',
          title: `${event.type.replace(/_/g, ' ')} in progress`,
          detail: 'Open the board to log actions',
          patient: event.patient,
          at: event.startedAt,
          link: `/dashboard/emergency/resuscitation/${event.id}`,
        });
      }
    }

    if (seesAdmin) {
      const urgent = await prisma.patientInquiry.findMany({
        where: { facilityId, status: 'NEW', isUrgent: true },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const inquiry of urgent) {
        alerts.push({
          id: `inquiry:${inquiry.id}`,
          severity: 'WARNING',
          category: 'ENQUIRY',
          title: 'Possibly urgent enquiry unanswered',
          detail: inquiry.symptomsText?.slice(0, 120) || 'No detail given',
          patient: null,
          at: inquiry.createdAt,
          link: '/dashboard/inquiries',
        });
      }
    }

    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (new Date(a.at) - new Date(b.at)));
    res.json({
      alerts,
      counts: {
        total: alerts.length,
        critical: alerts.filter((item) => item.severity === 'CRITICAL').length,
        warning: alerts.filter((item) => item.severity === 'WARNING').length,
      },
    });
  } catch (e) { next(e); }
});

router.post('/:id/acknowledge', respondToAlert, async (req, res, next) => {
  try {
    const existing = await prisma.clinicalAlert.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Clinical alert not found' });
    if (existing.status !== 'OPEN') {
      return res.status(409).json({ error: `Alert is already ${existing.status.toLowerCase().replace('_', ' ')}` });
    }
    const changed = await prisma.clinicalAlert.updateMany({
      where: { id: existing.id, facilityId: req.ctx.facilityId, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedById: req.ctx.userId, acknowledgedAt: new Date() },
    });
    if (changed.count !== 1) return res.status(409).json({ error: 'This alert was updated by another clinician. Refresh to see its current state.' });
    const alert = await prisma.clinicalAlert.findUnique({ where: { id: existing.id } });
    audit(req, 'clinical_alert.acknowledge', alert.id, 'Clinician acknowledged critical alert');
    res.json(alert);
  } catch (e) { next(e); }
});

router.post('/:id/action', respondToAlert, async (req, res, next) => {
  try {
    const actionNote = String(req.body?.actionNote || '').trim();
    if (actionNote.length < 3) return res.status(400).json({ error: 'Describe the clinical action taken' });
    const existing = await prisma.clinicalAlert.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Clinical alert not found' });
    if (existing.status !== 'ACKNOWLEDGED') {
      return res.status(409).json({ error: 'A clinician must acknowledge this alert before recording action' });
    }
    const changed = await prisma.clinicalAlert.updateMany({
      where: { id: existing.id, facilityId: req.ctx.facilityId, status: 'ACKNOWLEDGED' },
      data: { status: 'ACTED_ON', actionById: req.ctx.userId, actionAt: new Date(), actionNote },
    });
    if (changed.count !== 1) return res.status(409).json({ error: 'This alert was updated by another clinician. Refresh to see its current state.' });
    const alert = await prisma.clinicalAlert.findUnique({ where: { id: existing.id } });
    audit(req, 'clinical_alert.action', alert.id, actionNote);
    res.json(alert);
  } catch (e) { next(e); }
});

router.post('/:id/resolve', respondToAlert, async (req, res, next) => {
  try {
    const resolution = String(req.body?.resolution || '').trim();
    if (resolution.length < 3) return res.status(400).json({ error: 'Describe the outcome before resolving the alert' });
    const existing = await prisma.clinicalAlert.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Clinical alert not found' });
    if (existing.status !== 'ACTED_ON') {
      return res.status(409).json({ error: 'Record the clinical action before resolving this alert' });
    }
    const changed = await prisma.clinicalAlert.updateMany({
      where: { id: existing.id, facilityId: req.ctx.facilityId, status: 'ACTED_ON' },
      data: { status: 'RESOLVED', resolvedById: req.ctx.userId, resolvedAt: new Date(), resolution },
    });
    if (changed.count !== 1) return res.status(409).json({ error: 'This alert was updated by another clinician. Refresh to see its current state.' });
    const alert = await prisma.clinicalAlert.findUnique({ where: { id: existing.id } });
    audit(req, 'clinical_alert.resolve', alert.id, resolution);
    res.json(alert);
  } catch (e) { next(e); }
});

module.exports = router;
