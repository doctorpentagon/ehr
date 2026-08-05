const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantCase } = require('../utils/tenantRecords');
const {
  MONITORING_TEMPLATES, templateFor,
  computeDeviations, slidingScaleFor, ivFluidStatus,
} = require('../utils/monitoringTemplates');
const { zScores, referenceDataAvailable } = require('../utils/growth');

// Read access: any role that can see ward documentation (incl. the facility owner).
const read = [authenticate, tenant, requirePermission('monitoring')];
// Write access: clinical roles only — the owner sees but does not author.
const writeMonitoring = [authenticate, tenant, requirePermission('monitoring_write')];
// Doctors hold this but not `monitoring_write`: they comment on the nursing
// record and ask for corrections, they do not author the observations.
const reviewMonitoring = [authenticate, tenant, requirePermission('monitoring_review')];
const writeDrug = [authenticate, tenant, requirePermission('drug_admin_write')];
const readDrug = [authenticate, tenant, requirePermission('drug_admin')];
const writeGrowth = [authenticate, tenant, requirePermission('growth_write')];
const readGrowth = [authenticate, tenant, requirePermission('growth')];
const writeHandover = [authenticate, tenant, requirePermission('handover_write')];
const readHandover = [authenticate, tenant, requirePermission('handover')];

function audit(req, action, resource, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId,
      action, resource, resourceId, reason: reason || 'Nursing documentation', ip: req.ip,
    },
  }).catch(() => {});
}

// ── Monitoring templates ────────────────────────────────────────────────────
// Built-in field definitions. A sheet copies these into its own `fields`, so
// editing a template later never rewrites history on existing sheets.
router.get('/monitoring-templates', read, (req, res) => {
  res.json({ templates: MONITORING_TEMPLATES });
});

// ── Ward summary for the nurse dashboard ────────────────────────────────────
router.get('/stats', read, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const [activeSheets, abnormalToday, dosesToday, unscheduledToday, unacknowledgedHandovers, transfusions] =
      await prisma.$transaction([
        prisma.monitoringSheet.count({ where: { facilityId: fid, status: 'ACTIVE' } }),
        prisma.monitoringEntry.count({ where: { facilityId: fid, isAbnormal: true, recordedAt: { gte: startOfDay } } }),
        prisma.drugAdministration.count({ where: { facilityId: fid, status: 'GIVEN', administeredAt: { gte: startOfDay } } }),
        prisma.drugAdministration.count({ where: { facilityId: fid, isUnscheduled: true, createdAt: { gte: startOfDay } } }),
        prisma.handoverNote.count({ where: { facilityId: fid, acknowledgedAt: null } }),
        prisma.monitoringSheet.count({ where: { facilityId: fid, status: 'ACTIVE', type: 'BLOOD_TRANSFUSION' } }),
      ]);

    res.json({
      activeSheets, abnormalToday, dosesToday, unscheduledToday,
      unacknowledgedHandovers, activeTransfusions: transfusions,
    });
  } catch (e) { next(e); }
});

// ── Monitoring sheets ───────────────────────────────────────────────────────
router.get('/monitoring-sheets', read, async (req, res, next) => {
  try {
    const { patientId, status, type, page = 1, limit = 20, withEntries } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    // `status=ALL` means "no filter" — without this, ALL was matched literally
    // against the enum and every query returned nothing.
    if (status && status !== 'ALL') where.status = status;
    if (type) where.type = type;
    const skip = (Number(page) - 1) * Number(limit);

    // The patient chart needs a preview of each sheet's observations and its
    // running balance. Asking for it here avoids a request per sheet, but it is
    // opt-in so the ward list stays light.
    const wantEntries = withEntries === 'true' || withEntries === '1' || Boolean(patientId);

    const [total, sheets] = await prisma.$transaction([
      prisma.monitoringSheet.count({ where }),
      prisma.monitoringSheet.findMany({
        where, skip, take: Number(limit), orderBy: { startedAt: 'desc' },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true } },
          _count: { select: { entries: true } },
          ...(wantEntries
            ? { entries: { orderBy: { recordedAt: 'desc' }, take: 50 } }
            : {}),
        },
      }),
    ]);

    const withTotals = wantEntries
      ? sheets.map((sheet) => {
        const totals = (sheet.entries || []).reduce((acc, e) => {
          acc.intakeMl += Number(e.intakeMl || 0);
          acc.outputMl += Number(e.outputMl || 0);
          return acc;
        }, { intakeMl: 0, outputMl: 0 });
        totals.balanceMl = Number((totals.intakeMl - totals.outputMl).toFixed(2));
        return { ...sheet, totals };
      })
      : sheets;

    res.json({ sheets: withTotals, total });
  } catch (e) { next(e); }
});

router.get('/monitoring-sheets/:id', read, async (req, res, next) => {
  try {
    const sheet = await prisma.monitoringSheet.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true, dateOfBirth: true } },
        entries: { orderBy: { recordedAt: 'desc' }, take: 200 },
      },
    });
    if (!sheet) return res.status(404).json({ error: 'Monitoring sheet not found' });

    // Running intake/output balance — the reason a structured sheet beats a free log.
    const totals = sheet.entries.reduce((acc, e) => {
      acc.intakeMl += e.intakeMl || 0;
      acc.outputMl += e.outputMl || 0;
      return acc;
    }, { intakeMl: 0, outputMl: 0 });
    totals.balanceMl = Number((totals.intakeMl - totals.outputMl).toFixed(2));

    res.json({ ...sheet, totals });
  } catch (e) { next(e); }
});

router.post('/monitoring-sheets', writeMonitoring, async (req, res, next) => {
  try {
    const {
      patientId, caseId, admissionId, type, customType, title, fields, metadata,
      targetValue, targetUnit, frequencyMins, instructions, orderId,
    } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!type) return res.status(400).json({ error: 'type is required' });

    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    if (type === 'CUSTOM' && !customType && !title) {
      return res.status(400).json({ error: 'A custom monitoring sheet needs customType or title' });
    }

    const template = templateFor(type);
    // Caller-supplied fields win, so a nurse can shape a CUSTOM sheet freely.
    const resolvedFields = Array.isArray(fields) && fields.length ? fields : (template?.fields || []);
    if (type === 'CUSTOM' && !resolvedFields.length) {
      return res.status(400).json({ error: 'A custom monitoring sheet needs at least one field' });
    }

    const sheet = await prisma.monitoringSheet.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId,
        caseId: caseId || null,
        admissionId: admissionId || null,
        createdById: req.ctx.userId,
        type,
        customType: type === 'CUSTOM' ? (customType || title) : null,
        title: title || template?.label || customType || 'Monitoring',
        fields: resolvedFields,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        orderId: orderId || null,
        targetValue: targetValue != null ? Number(targetValue) : null,
        targetUnit: targetUnit || template?.targetUnit || null,
        frequencyMins: frequencyMins != null ? Number(frequencyMins) : (template?.frequencyMins ?? null),
        instructions: instructions || null,
      },
    });

    // Link the order back to the chart so the instruction and the record of it
    // being carried out are reachable from each other.
    if (orderId) {
      await prisma.order.updateMany({
        where: { id: orderId, facilityId: req.ctx.facilityId },
        data: { monitoringSheetId: sheet.id },
      });
    }

    audit(req, 'monitoring.sheet.create', 'MonitoringSheet', sheet.id);
    res.status(201).json(sheet);
  } catch (e) { next(e); }
});

/**
 * Charts a doctor has asked for that nobody has opened yet.
 *
 * A doctor writing "catheter, hourly output" has said what needs watching. The
 * nurse at the bedside is the one who knows the catheter size, which side the
 * drain is on, or which bag was actually hung — so the order names the chart and
 * the nurse supplies the detail. This is the list of orders still waiting for
 * that to happen.
 */
router.get('/monitoring-requests', read, async (req, res, next) => {
  try {
    const { patientId } = req.query;
    const where = {
      facilityId: req.ctx.facilityId,
      status: 'ACTIVE',
      monitoringType: { not: null },
      monitoringSheetId: null,
    };
    if (patientId) {
      await requireTenantPatient(req.ctx.facilityId, patientId);
      where.patientId = patientId;
    }

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true } } },
    });

    res.json({
      requests: orders.map((order) => {
        const template = templateFor(order.monitoringType);
        return {
          orderId: order.id,
          patient: order.patient,
          orderName: order.name,
          goal: order.goal,
          instructions: order.instructions,
          priority: order.priority,
          orderedAt: order.startAt,
          monitoringType: order.monitoringType,
          // Everything the initiation form needs, so the nurse sees what will be
          // recorded before committing to it.
          suggested: {
            title: template?.label || order.name,
            fields: template?.fields || [],
            frequencyMins: order.frequencyHours ? Math.round(order.frequencyHours * 60) : (template?.frequencyMins ?? null),
            targetUnit: template?.targetUnit || null,
          },
        };
      }),
      total: orders.length,
    });
  } catch (e) { next(e); }
});

/**
 * Open the chart a doctor ordered.
 *
 * What the nurse enters here *is* the sheet: the fields they confirm become the
 * columns that get recorded from then on, the frequency becomes what the chart
 * is checked against, and the specifics they add — catheter size, bag volume,
 * drain site — are stored as the chart's own settings rather than as free text
 * somebody has to read and interpret later.
 */
router.post('/monitoring-requests/:orderId/initiate', writeMonitoring, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.orderId, facilityId: req.ctx.facilityId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'ACTIVE') {
      return res.status(409).json({ error: `This order is ${order.status.toLowerCase()}` });
    }
    if (order.monitoringSheetId) {
      return res.status(409).json({
        error: 'A chart is already open for this order',
        sheetId: order.monitoringSheetId,
      });
    }

    const {
      type, title, fields, metadata, frequencyMins, targetValue, targetUnit, instructions, admissionId,
    } = req.body || {};

    const resolvedType = type || order.monitoringType;
    if (!resolvedType) {
      return res.status(400).json({ error: 'This order does not name a chart type — choose one', field: 'type' });
    }
    const template = templateFor(resolvedType);
    const resolvedFields = Array.isArray(fields) && fields.length ? fields : (template?.fields || []);
    if (!resolvedFields.length) {
      return res.status(400).json({ error: 'A chart needs at least one thing to record', field: 'fields' });
    }

    const sheet = await prisma.$transaction(async (tx) => {
      const created = await tx.monitoringSheet.create({
        data: {
          facilityId: req.ctx.facilityId,
          patientId: order.patientId,
          caseId: order.caseId || null,
          admissionId: admissionId || order.admissionId || null,
          createdById: req.ctx.userId,
          orderId: order.id,
          type: resolvedType,
          customType: resolvedType === 'CUSTOM' ? (title || order.name) : null,
          title: title || template?.label || order.name,
          fields: resolvedFields,
          metadata: metadata && typeof metadata === 'object' ? metadata : {},
          // The doctor's interval is the default; the nurse can tighten it.
          frequencyMins: frequencyMins != null
            ? Number(frequencyMins)
            : (order.frequencyHours ? Math.round(order.frequencyHours * 60) : (template?.frequencyMins ?? null)),
          targetValue: targetValue != null ? Number(targetValue) : null,
          targetUnit: targetUnit || template?.targetUnit || null,
          // Keep the instruction visible on the chart itself, so whoever records
          // an observation at 3am can see what was asked for without leaving it.
          instructions: instructions || order.instructions || order.goal || null,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { monitoringSheetId: created.id },
      });

      // Opening the chart is itself carrying out the instruction.
      await tx.orderExecution.create({
        data: {
          facilityId: req.ctx.facilityId,
          orderId: order.id,
          executedById: req.ctx.userId,
          outcome: 'DONE',
          result: `Monitoring chart opened: ${created.title}`,
        },
      });

      return created;
    });

    audit(req, 'monitoring.sheet.initiate', 'MonitoringSheet', sheet.id);
    res.status(201).json({ sheet, order: { id: order.id, name: order.name } });
  } catch (e) { next(e); }
});

router.patch('/monitoring-sheets/:id', writeMonitoring, async (req, res, next) => {
  try {
    const existing = await prisma.monitoringSheet.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Monitoring sheet not found' });

    const { status, instructions, targetValue, targetUnit, frequencyMins } = req.body || {};
    const data = {};
    if (status) {
      data.status = status;
      if (status === 'COMPLETED' || status === 'CANCELLED') data.endedAt = new Date();
    }
    if (instructions !== undefined) data.instructions = instructions;
    if (targetValue !== undefined) data.targetValue = targetValue == null ? null : Number(targetValue);
    if (targetUnit !== undefined) data.targetUnit = targetUnit;
    if (frequencyMins !== undefined) data.frequencyMins = frequencyMins == null ? null : Number(frequencyMins);

    const sheet = await prisma.monitoringSheet.update({ where: { id: existing.id }, data });
    audit(req, 'monitoring.sheet.update', 'MonitoringSheet', sheet.id);
    res.json(sheet);
  } catch (e) { next(e); }
});

// ── Monitoring entries ──────────────────────────────────────────────────────
router.post('/monitoring-sheets/:id/entries', writeMonitoring, async (req, res, next) => {
  try {
    const sheet = await prisma.monitoringSheet.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!sheet) return res.status(404).json({ error: 'Monitoring sheet not found' });
    if (sheet.status !== 'ACTIVE') {
      return res.status(409).json({ error: `Cannot add entries to a ${sheet.status.toLowerCase()} sheet` });
    }

    const { values, intakeMl, outputMl, attachmentUrl, notes, recordedAt, isAbnormal } = req.body || {};

    // Observations are a clinical record of what happened — never the future.
    let when = new Date();
    if (recordedAt) {
      const parsed = new Date(recordedAt);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'recordedAt is not a valid date' });
      if (parsed.getTime() > Date.now() + 60_000) {
        return res.status(400).json({ error: 'recordedAt cannot be in the future' });
      }
      when = parsed;
    }

    const safeValues = values && typeof values === 'object' ? values : {};

    // Whether a reading is abnormal is decided here, against the sheet's own goal
    // bands — not taken from the client. A browser that computes it differently,
    // or omits it, must not be able to make a critical value look ordinary.
    const assessment = computeDeviations(sheet.fields, safeValues);

    // Fields flagged `mapsTo` in the template feed the fluid balance directly, so
    // a nurse records a urine volume once instead of typing it twice.
    const mapped = { intakeMl: null, outputMl: null };
    for (const field of Array.isArray(sheet.fields) ? sheet.fields : []) {
      if (!field.mapsTo || safeValues[field.key] == null) continue;
      const n = Number(safeValues[field.key]);
      if (Number.isFinite(n)) mapped[field.mapsTo] = (mapped[field.mapsTo] || 0) + n;
    }

    const entry = await prisma.monitoringEntry.create({
      data: {
        sheetId: sheet.id,
        facilityId: req.ctx.facilityId,
        recordedById: req.ctx.userId,
        recordedAt: when,
        values: safeValues,
        deviations: assessment.deviations,
        intakeMl: intakeMl != null ? Number(intakeMl) : mapped.intakeMl,
        outputMl: outputMl != null ? Number(outputMl) : mapped.outputMl,
        attachmentUrl: attachmentUrl || null,
        // The client may raise the flag, but never lower one the bands raised.
        isAbnormal: assessment.isAbnormal || Boolean(isAbnormal),
        notes: notes || null,
      },
    });
    audit(req, 'monitoring.entry.create', 'MonitoringEntry', entry.id);

    const response = { ...entry, isCritical: assessment.isCritical };

    // A critical reading is worth naming in the response so the ward gets an
    // immediate, specific prompt rather than a red cell they might scroll past.
    if (assessment.isCritical) {
      response.alert = {
        severity: 'CRITICAL',
        message: `Critical: ${assessment.criticalKeys.join(', ')} — inform the doctor now`,
        fields: assessment.criticalKeys,
      };
    }

    // Blood glucose gets a sliding-scale suggestion alongside the reading, so the
    // nurse is not doing arithmetic from memory at 3am. Suggestion only.
    if (sheet.type === 'BGL_INSULIN' && safeValues.bgl != null) {
      response.slidingScale = slidingScaleFor(safeValues.bgl);
    }

    // IV bags: remaining volume is derived from what has actually gone in, and
    // the rate is checked against what was ordered.
    if (sheet.type === 'IV_FLUID') {
      const totals = await prisma.monitoringEntry.aggregate({
        where: { sheetId: sheet.id }, _sum: { intakeMl: true },
      });
      response.ivStatus = ivFluidStatus({
        bagSizeMl: sheet.metadata?.bagSizeMl,
        totalInfusedMl: totals._sum.intakeMl || 0,
        rateOrdered: sheet.metadata?.rateOrdered ?? safeValues.rateOrdered,
        rateActual: safeValues.rateMlHr ?? safeValues.rateActual,
      });
    }

    res.status(201).json(response);
  } catch (e) { next(e); }
});

/**
 * Everything the nursing team has done for one patient, in one call.
 *
 * A doctor on a ward round has a minute per patient. Before this, seeing whether
 * the nursing plan was actually carried out meant opening the monitoring module,
 * then the task list, then each sheet in turn — so in practice it was not
 * checked. This assembles the same picture in a single request: what is being
 * monitored, which readings are out of range, which orders are being carried out
 * and which are being missed.
 *
 * Read-only by design. Doctors do not author observations; they raise a review.
 */
router.get('/patient-overview/:patientId', read, async (req, res, next) => {
  try {
    const { patientId } = req.params;
    await requireTenantPatient(req.ctx.facilityId, patientId);

    const since = new Date(Date.now() - Number(req.query.hours || 48) * 3600_000);

    const [sheets, orders, openReviews] = await Promise.all([
      prisma.monitoringSheet.findMany({
        where: { facilityId: req.ctx.facilityId, patientId, status: 'ACTIVE' },
        include: { entries: { where: { recordedAt: { gte: since } }, orderBy: { recordedAt: 'asc' } } },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.order.findMany({
        where: { facilityId: req.ctx.facilityId, patientId, status: { in: ['ACTIVE', 'HELD'] } },
        include: { executions: { orderBy: { executedAt: 'desc' }, take: 30 } },
      }),
      prisma.monitoringReview.findMany({
        where: { facilityId: req.ctx.facilityId, resolvedAt: null, sheet: { patientId } },
        orderBy: { raisedAt: 'desc' },
      }),
    ]);

    // One series per numeric field, ready to plot: the points, the band that
    // counts as normal, and where each point sits relative to it.
    const charts = [];
    for (const sheet of sheets) {
      for (const field of Array.isArray(sheet.fields) ? sheet.fields : []) {
        if (field.kind !== 'number') continue;
        const points = sheet.entries
          .filter((e) => e.values?.[field.key] != null && Number.isFinite(Number(e.values[field.key])))
          .map((e) => ({
            at: e.recordedAt,
            value: Number(e.values[field.key]),
            severity: e.deviations?.[field.key]?.severity || 'NORMAL',
            deviation: e.deviations?.[field.key]?.deviation ?? 0,
          }));
        if (points.length === 0) continue;

        const values = points.map((p) => p.value);
        charts.push({
          sheetId: sheet.id, sheetTitle: sheet.title, sheetType: sheet.type,
          key: field.key, label: field.label, unit: field.unit || null,
          goalMin: field.goalMin ?? null, goalMax: field.goalMax ?? null,
          criticalLow: field.criticalLow ?? null, criticalHigh: field.criticalHigh ?? null,
          points,
          latest: points[points.length - 1],
          min: Math.min(...values), max: Math.max(...values),
          // Direction of travel matters more than any single reading: a
          // saturation of 93% falling is a different patient from 93% rising.
          trend: points.length < 2 ? 'FLAT'
            : points[points.length - 1].value > points[points.length - 2].value ? 'RISING'
              : points[points.length - 1].value < points[points.length - 2].value ? 'FALLING' : 'FLAT',
          abnormalCount: points.filter((p) => p.severity !== 'NORMAL').length,
          criticalCount: points.filter((p) => p.severity.startsWith('CRITICAL')).length,
        });
      }
    }

    // Adherence, stated plainly. "3 of 12 doses given" is the number that tells a
    // doctor whether the plan is real or only written down.
    const orderSummary = orders.map((order) => {
      const done = order.executions.filter((e) => e.outcome === 'DONE');
      const lastDone = done[0]?.executedAt || null;
      let expected = null;
      if (order.frequencyHours && order.status === 'ACTIVE') {
        const elapsedHours = (Date.now() - new Date(order.startAt).getTime()) / 3600_000;
        expected = Math.max(0, Math.floor(elapsedHours / order.frequencyHours));
      }
      const dueAt = order.frequencyHours
        ? new Date(new Date(lastDone || order.startAt).getTime() + order.frequencyHours * 3600_000)
        : null;
      return {
        id: order.id, type: order.type, name: order.name, goal: order.goal,
        status: order.status, priority: order.priority,
        frequencyHours: order.frequencyHours,
        carriedOut: done.length,
        missed: order.executions.length - done.length,
        expected,
        adherencePercent: expected ? Math.min(100, Math.round((done.length / expected) * 100)) : null,
        lastExecutedAt: lastDone,
        dueAt,
        isOverdue: Boolean(dueAt && Date.now() > dueAt.getTime() + (order.frequencyHours * 3600_000 * 0.25)),
        recentExecutions: order.executions.slice(0, 5),
      };
    });

    const criticalCharts = charts.filter((c) => c.criticalCount > 0);
    res.json({
      windowHours: Number(req.query.hours || 48),
      charts,
      orders: orderSummary,
      openReviews,
      // What a doctor should look at first, if they look at nothing else.
      attention: {
        criticalReadings: criticalCharts.map((c) => ({
          label: c.label, latest: c.latest.value, unit: c.unit, trend: c.trend, sheetId: c.sheetId,
        })),
        overdueOrders: orderSummary.filter((o) => o.isOverdue).map((o) => ({ id: o.id, name: o.name, dueAt: o.dueAt })),
        poorAdherence: orderSummary.filter((o) => o.adherencePercent !== null && o.adherencePercent < 70)
          .map((o) => ({ id: o.id, name: o.name, adherencePercent: o.adherencePercent, carriedOut: o.carriedOut, expected: o.expected })),
        unresolvedReviews: openReviews.length,
      },
      counts: {
        activeSheets: sheets.length,
        chartedSeries: charts.length,
        activeOrders: orderSummary.length,
      },
    });
  } catch (e) { next(e); }
});

// ── Doctor review of the nursing record ─────────────────────────────────────
// Doctors read monitoring sheets but do not author observations: an observation
// says a named person was at the bedside and saw something, and blurring that
// helps nobody in an incident review. What a doctor needs is a way to say "this
// looks wrong, recheck it" or "make this hourly" and have the nurse see it.
router.post('/monitoring-sheets/:id/reviews', reviewMonitoring, async (req, res, next) => {
  try {
    const sheet = await prisma.monitoringSheet.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!sheet) return res.status(404).json({ error: 'Monitoring sheet not found' });

    const { entryId, kind = 'ACKNOWLEDGED', comment } = req.body || {};
    const KINDS = ['ACKNOWLEDGED', 'CORRECTION_REQUESTED', 'ADJUSTMENT_REQUESTED'];
    if (!KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${KINDS.join(', ')}` });
    }
    // Asking for a change without saying what to change is not actionable.
    if (kind !== 'ACKNOWLEDGED' && String(comment || '').trim().length < 5) {
      return res.status(400).json({ error: 'Say what should be corrected or adjusted', field: 'comment' });
    }

    if (entryId) {
      const entry = await prisma.monitoringEntry.findFirst({ where: { id: entryId, sheetId: sheet.id } });
      if (!entry) return res.status(404).json({ error: 'Entry not found on this sheet' });
    }

    const review = await prisma.monitoringReview.create({
      data: {
        facilityId: req.ctx.facilityId,
        sheetId: sheet.id,
        entryId: entryId || null,
        kind,
        comment: String(comment || '').trim() || 'Reviewed',
        raisedById: req.ctx.userId,
      },
    });
    audit(req, 'monitoring.review.create', 'MonitoringReview', review.id);
    res.status(201).json(review);
  } catch (e) { next(e); }
});

/** Open review requests — what the nurse still has to act on. */
router.get('/monitoring-reviews', read, async (req, res, next) => {
  try {
    const { patientId, includeResolved } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (includeResolved !== 'true' && includeResolved !== '1') where.resolvedAt = null;
    if (patientId) {
      await requireTenantPatient(req.ctx.facilityId, patientId);
      where.sheet = { patientId };
    }

    const reviews = await prisma.monitoringReview.findMany({
      where,
      orderBy: { raisedAt: 'desc' },
      take: 100,
      include: {
        sheet: { select: { id: true, title: true, type: true, patientId: true } },
        entry: { select: { id: true, recordedAt: true, values: true } },
      },
    });
    res.json({ reviews, openCount: reviews.filter((r) => !r.resolvedAt).length });
  } catch (e) { next(e); }
});

/** The nurse closes the loop, saying what was done about it. */
router.put('/monitoring-reviews/:id/resolve', writeMonitoring, async (req, res, next) => {
  try {
    const review = await prisma.monitoringReview.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.resolvedAt) return res.status(409).json({ error: 'This review is already resolved' });

    const resolution = String(req.body?.resolution || '').trim();
    if (resolution.length < 3) {
      return res.status(400).json({ error: 'Say what was done about it', field: 'resolution' });
    }

    const updated = await prisma.monitoringReview.update({
      where: { id: review.id },
      data: { resolvedAt: new Date(), resolvedById: req.ctx.userId, resolution },
    });
    audit(req, 'monitoring.review.resolve', 'MonitoringReview', updated.id);
    res.json(updated);
  } catch (e) { next(e); }
});

// ── Medication administration record ────────────────────────────────────────
// Due doses are derived from active prescriptions so missed doses are visible.
router.get('/drug-administrations', readDrug, async (req, res, next) => {
  try {
    const { patientId, status, from, to, page = 1, limit = 50 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;
    if (from || to) {
      where.scheduledAt = {};
      if (from) where.scheduledAt.gte = new Date(from);
      if (to) where.scheduledAt.lte = new Date(to);
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, records] = await prisma.$transaction([
      prisma.drugAdministration.count({ where }),
      prisma.drugAdministration.findMany({
        where, skip, take: Number(limit), orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } },
          prescription: { select: { id: true, drugName: true, dosage: true, frequency: true, route: true, status: true } },
        },
      }),
    ]);
    res.json({ records, total });
  } catch (e) { next(e); }
});

// Active prescriptions for a patient, each with its administration history —
// this is what the ward drug chart renders.
router.get('/drug-chart/:patientId', readDrug, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const prescriptions = await prisma.prescription.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: { administrations: { orderBy: { administeredAt: 'desc' }, take: 50 } },
    });
    const unscheduled = await prisma.drugAdministration.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId, isUnscheduled: true },
      orderBy: { administeredAt: 'desc' }, take: 50,
    });
    res.json({ prescriptions, unscheduled });
  } catch (e) { next(e); }
});

router.post('/drug-administrations', writeDrug, async (req, res, next) => {
  try {
    const {
      patientId, prescriptionId, caseId, drugName, dose, route,
      scheduledAt, administeredAt, status, balanceRemaining, notes, reason,
    } = req.body || {};

    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    let prescription = null;
    if (prescriptionId) {
      prescription = await prisma.prescription.findFirst({
        where: { id: prescriptionId, facilityId: req.ctx.facilityId, patientId },
      });
      if (!prescription) return res.status(404).json({ error: 'Prescription not found for this patient' });
    }

    const isUnscheduled = !prescription;
    const resolvedName = drugName || prescription?.drugName;
    if (!resolvedName) return res.status(400).json({ error: 'drugName is required when there is no prescription' });

    // Any deviation from "gave the prescribed dose" needs a clinical justification.
    // Check the explicit status first so the message names the real problem.
    const finalStatus = status || 'GIVEN';
    if (!reason) {
      if (finalStatus !== 'GIVEN') {
        return res.status(400).json({ error: `A ${finalStatus.toLowerCase()} dose requires a reason` });
      }
      if (isUnscheduled) {
        return res.status(400).json({ error: 'An unscheduled administration requires a reason' });
      }
    }

    let givenAt = null;
    if (finalStatus === 'GIVEN') {
      givenAt = administeredAt ? new Date(administeredAt) : new Date();
      if (Number.isNaN(givenAt.getTime())) return res.status(400).json({ error: 'administeredAt is not a valid date' });
      if (givenAt.getTime() > Date.now() + 60_000) {
        return res.status(400).json({ error: 'administeredAt cannot be in the future' });
      }
    }

    const record = await prisma.drugAdministration.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId,
        prescriptionId: prescription?.id || null,
        caseId: caseId || null,
        administeredById: req.ctx.userId,
        drugName: resolvedName,
        dose: dose || prescription?.dosage || null,
        route: route || prescription?.route || 'ORAL',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        administeredAt: givenAt,
        status: finalStatus,
        balanceRemaining: balanceRemaining != null ? Number(balanceRemaining) : null,
        isUnscheduled,
        reason: reason || null,
        notes: notes || null,
      },
    });
    audit(req, 'drug.administration.record', 'DrugAdministration', record.id, reason || 'Medication administration');
    res.status(201).json(record);
  } catch (e) { next(e); }
});

// ── Paediatric growth ───────────────────────────────────────────────────────
router.get('/growth/:patientId', readGrowth, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const measurements = await prisma.growthMeasurement.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId },
      orderBy: { recordedAt: 'asc' },
    });
    res.json({ measurements, referenceDataAvailable: referenceDataAvailable() });
  } catch (e) { next(e); }
});

router.post('/growth', writeGrowth, async (req, res, next) => {
  try {
    const { patientId, weightKg, heightCm, headCircumferenceCm, muacCm, recordedAt, notes } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    const patient = await requireTenantPatient(req.ctx.facilityId, patientId);

    let when = recordedAt ? new Date(recordedAt) : new Date();
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'recordedAt is not a valid date' });
    if (when.getTime() > Date.now() + 60_000) return res.status(400).json({ error: 'recordedAt cannot be in the future' });

    let ageMonths = null;
    if (patient.dateOfBirth) {
      ageMonths = Math.max(0, Math.floor((when - new Date(patient.dateOfBirth)) / (1000 * 60 * 60 * 24 * 30.4375)));
    }

    const z = zScores({
      sex: patient.gender, ageMonths,
      weightKg: weightKg != null ? Number(weightKg) : null,
      heightCm: heightCm != null ? Number(heightCm) : null,
    });

    const measurement = await prisma.growthMeasurement.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId,
        recordedById: req.ctx.userId,
        recordedAt: when,
        ageMonths,
        weightKg: weightKg != null ? Number(weightKg) : null,
        heightCm: heightCm != null ? Number(heightCm) : null,
        headCircumferenceCm: headCircumferenceCm != null ? Number(headCircumferenceCm) : null,
        muacCm: muacCm != null ? Number(muacCm) : null,
        weightForAgeZ: z.weightForAgeZ,
        heightForAgeZ: z.heightForAgeZ,
        weightForHeightZ: z.weightForHeightZ,
        notes: notes || null,
      },
    });
    audit(req, 'growth.measurement.create', 'GrowthMeasurement', measurement.id);
    res.status(201).json({ ...measurement, referenceDataAvailable: referenceDataAvailable() });
  } catch (e) { next(e); }
});

// ── Shift handover (SBAR) ───────────────────────────────────────────────────
router.get('/handover', readHandover, async (req, res, next) => {
  try {
    const { patientId, shift, date, page = 1, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    if (shift) where.shift = shift;
    if (date) where.shiftDate = new Date(date);
    const skip = (Number(page) - 1) * Number(limit);
    const [total, notes] = await prisma.$transaction([
      prisma.handoverNote.count({ where }),
      prisma.handoverNote.findMany({
        where, skip, take: Number(limit), orderBy: [{ shiftDate: 'desc' }, { createdAt: 'desc' }],
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
      }),
    ]);
    res.json({ notes, total });
  } catch (e) { next(e); }
});

router.post('/handover', writeHandover, async (req, res, next) => {
  try {
    const { patientId, departmentId, shift, shiftDate, situation, background, assessment, recommendation, outstandingTasks } = req.body || {};
    if (!shift) return res.status(400).json({ error: 'shift is required' });
    if (patientId) await requireTenantPatient(req.ctx.facilityId, patientId);

    const note = await prisma.handoverNote.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId: patientId || null,
        departmentId: departmentId || null,
        authorId: req.ctx.userId,
        shift,
        shiftDate: shiftDate ? new Date(shiftDate) : new Date(),
        situation: situation || null,
        background: background || null,
        assessment: assessment || null,
        recommendation: recommendation || null,
        outstandingTasks: Array.isArray(outstandingTasks) ? outstandingTasks : [],
      },
    });
    audit(req, 'handover.create', 'HandoverNote', note.id);
    res.status(201).json(note);
  } catch (e) { next(e); }
});

router.post('/handover/:id/acknowledge', writeHandover, async (req, res, next) => {
  try {
    const existing = await prisma.handoverNote.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Handover note not found' });
    if (existing.acknowledgedAt) return res.status(409).json({ error: 'Already acknowledged' });

    const note = await prisma.handoverNote.update({
      where: { id: existing.id },
      data: { acknowledgedById: req.ctx.userId, acknowledgedAt: new Date() },
    });
    audit(req, 'handover.acknowledge', 'HandoverNote', note.id);
    res.json(note);
  } catch (e) { next(e); }
});

module.exports = router;
