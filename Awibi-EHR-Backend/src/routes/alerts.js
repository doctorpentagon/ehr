const express = require('express');

const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { can } = require('../utils/permissions');

/**
 * The things in this facility that somebody should look at now.
 *
 * Derived on read rather than stored as notification rows. A stored alert has to
 * be created, delivered, de-duplicated and expired, and it goes stale the moment
 * the underlying fact changes — a critical potassium that has since been treated
 * still sits in the queue looking urgent. Deriving from current state means an
 * alert disappears exactly when the thing it describes is dealt with, which is
 * the behaviour a ward actually wants.
 *
 * Filtered by role: a nurse is shown the bag that needs changing, a doctor the
 * reading that needs a decision. Nobody is shown work they cannot act on.
 */
const auth = [authenticate, tenant];

/** How far back a reading still counts as "current". */
const LOOKBACK_HOURS = 12;

router.get('/', auth, async (req, res, next) => {
  try {
    const facilityId = req.ctx.facilityId;
    const { role, subRole } = req.user || {};
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000);

    const isNurse = subRole === 'NURSE';
    const isDoctor = subRole === 'DOCTOR';
    const isClinical = isNurse || isDoctor;
    const seesAdmin = can(role, subRole, 'patient_demographics_write');

    const alerts = [];

    // ── Critical observations ────────────────────────────────────────────────
    if (can(role, subRole, 'monitoring')) {
      const entries = await prisma.monitoringEntry.findMany({
        where: { facilityId, isAbnormal: true, recordedAt: { gte: since } },
        orderBy: { recordedAt: 'desc' },
        take: 200,
        include: {
          sheet: {
            select: {
              id: true, title: true, type: true, status: true, fields: true,
              patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
            },
          },
        },
      });

      // Only the latest critical reading per patient and measurement. Ten
      // consecutive low saturations are one problem, not ten alerts — and a
      // list that scrolls is a list nobody reads.
      const seen = new Set();
      for (const entry of entries) {
        if (entry.sheet?.status !== 'ACTIVE') continue;
        for (const [key, dev] of Object.entries(entry.deviations || {})) {
          if (!dev?.isCritical) continue;
          const dedupe = `${entry.sheet.patient?.id}:${key}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);

          // Show the label the nurse charted against, not the storage key —
          // "SpO2 is critical" rather than "spo2 is critical".
          const field = (Array.isArray(entry.sheet.fields) ? entry.sheet.fields : []).find((f) => f.key === key);
          const label = field?.label || key;
          const unit = field?.unit ? ` ${field.unit}` : '';

          alerts.push({
            id: `critical:${entry.id}:${key}`,
            severity: 'CRITICAL',
            category: 'OBSERVATION',
            title: `${label} is critical`,
            detail: `${entry.values?.[key]}${unit} recorded on ${entry.sheet.title}`,
            patient: entry.sheet.patient,
            at: entry.recordedAt,
            link: `/dashboard/nursing/sheet/${entry.sheet.id}`,
          });
        }
      }
    }

    // ── Overdue standing orders ──────────────────────────────────────────────
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
          // An order an hour late is a prompt; a whole cycle late is a problem.
          severity: hoursLate > order.frequencyHours ? 'CRITICAL' : 'WARNING',
          category: 'ORDER',
          title: `${order.name} is overdue`,
          detail: `Due every ${order.frequencyHours}h · ${hoursLate}h late`,
          patient: order.patient,
          at: dueAt,
          link: '/dashboard/nursing/orders',
        });
      }
    }

    // ── Requests waiting on a nurse ──────────────────────────────────────────
    if (isNurse) {
      const reviews = await prisma.monitoringReview.findMany({
        where: { facilityId, resolvedAt: null, kind: { not: 'ACKNOWLEDGED' } },
        orderBy: { raisedAt: 'desc' },
        take: 50,
        include: {
          sheet: {
            select: {
              id: true, title: true,
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
          title: review.kind === 'CORRECTION_REQUESTED' ? 'A doctor has asked for a recheck' : 'A doctor has asked to change the plan',
          detail: review.comment,
          patient: review.sheet?.patient,
          at: review.raisedAt,
          link: `/dashboard/nursing/sheet/${review.sheet?.id}`,
        });
      }
    }

    // ── Resuscitation in progress ────────────────────────────────────────────
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

    // ── Urgent public enquiries ──────────────────────────────────────────────
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

    // Critical first, then oldest — something ignored for six hours matters more
    // than the same thing raised a minute ago.
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (new Date(a.at) - new Date(b.at)));

    res.json({
      alerts,
      counts: {
        total: alerts.length,
        critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
        warning: alerts.filter((a) => a.severity === 'WARNING').length,
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
