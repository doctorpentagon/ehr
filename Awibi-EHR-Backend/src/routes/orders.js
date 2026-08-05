const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantCase } = require('../utils/tenantRecords');
const { templateFor } = require('../utils/monitoringTemplates');

const read = [authenticate, tenant, requirePermission('orders')];
// Only a prescriber creates medication and nursing orders.
const prescribe = [authenticate, tenant, requirePermission('prescriptions_write')];
// Nurses execute them.
const execute = [authenticate, tenant, requirePermission('drug_admin_write')];
const catalogueWrite = [authenticate, tenant, requirePermission('settings')];

// Prisma orders enums by DECLARATION order, and NursingTaskPriority is declared
// ROUTINE, URGENT, STAT — so `priority: 'asc'` would sink a STAT task to the
// bottom of a nurse's worklist. Sort by explicit clinical rank instead.
const PRIORITY_RANK = { STAT: 0, URGENT: 1, ROUTINE: 2 };
function byClinicalPriority(a, b) {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  // Then soonest due, with undated tasks last.
  const at = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
  const bt = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
  return at - bt;
}

function audit(req, action, resource, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId, action,
      resource, resourceId, reason: reason || 'Order management', ip: req.ip,
    },
  }).catch(() => {});
}

// ── Drug catalogue ──────────────────────────────────────────────────────────
// Declared before any '/:id' route.
router.get('/drug-catalogue', read, async (req, res, next) => {
  try {
    const { search, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId, isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const drugs = await prisma.drugCatalogue.findMany({
      where, take: Math.min(Number(limit) || 20, 50), orderBy: { name: 'asc' },
    });
    res.json({ drugs, total: drugs.length });
  } catch (e) { next(e); }
});

router.post('/drug-catalogue', catalogueWrite, async (req, res, next) => {
  try {
    const { name, genericName, form, strength, defaultRoute, defaultDose, defaultFrequency, category, unitPrice, isControlled } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const drug = await prisma.drugCatalogue.create({
      data: {
        facilityId: req.ctx.facilityId, name,
        genericName: genericName || null, form: form || null, strength: strength || null,
        defaultRoute: defaultRoute || 'ORAL', defaultDose: defaultDose || null,
        defaultFrequency: defaultFrequency || null, category: category || null,
        unitPrice: unitPrice != null ? Number(unitPrice) : 0,
        isControlled: Boolean(isControlled),
      },
    });
    res.status(201).json(drug);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'That drug and strength already exists' });
    next(e);
  }
});

// ── Unified order view for a patient ────────────────────────────────────────
router.get('/patient/:patientId', read, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const scope = { patientId: req.params.patientId, facilityId: req.ctx.facilityId };

    const [medications, investigations, tasks] = await prisma.$transaction([
      prisma.prescription.findMany({
        where: { ...scope, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' },
        include: { administrations: { orderBy: { administeredAt: 'desc' }, take: 20 } },
      }),
      prisma.labRequest.findMany({
        where: { ...scope, status: { notIn: ['CANCELLED'] } }, orderBy: { createdAt: 'desc' }, take: 25,
      }),
      prisma.nursingTask.findMany({
        where: { ...scope, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({ medications, investigations, nursingTasks: tasks });
  } catch (e) { next(e); }
});

// ── Medication orders ───────────────────────────────────────────────────────
router.post('/medications', prescribe, async (req, res, next) => {
  try {
    const { patientId, caseId, medications } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    const list = Array.isArray(medications) && medications.length ? medications : [req.body];
    const created = [];
    for (const m of list) {
      if (!m.drugName) return res.status(400).json({ error: 'Each medication needs a drugName' });
      created.push(await prisma.prescription.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, caseId: caseId || null,
          prescribedById: req.ctx.userId,
          drugName: m.drugName,
          dosage: m.dosage || null,
          frequency: m.frequency || null,
          duration: m.duration || null,
          route: m.route || 'ORAL',
          instructions: m.instructions || null,
        },
      }));
    }

    audit(req, 'order.medication.create', 'Prescription', created[0]?.id, `${created.length} medication(s) prescribed`);
    res.status(201).json({ medications: created, count: created.length });
  } catch (e) { next(e); }
});

// ── Nursing tasks ───────────────────────────────────────────────────────────
router.get('/nursing-tasks', read, async (req, res, next) => {
  try {
    const { status, patientId, limit = 50 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    where.status = status && status !== 'ALL' ? status : { in: ['PENDING', 'IN_PROGRESS'] };

    const tasks = await prisma.nursingTask.findMany({
      where, take: Math.min(Number(limit) || 50, 100),
      orderBy: { createdAt: 'desc' },
      include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
    });

    const now = Date.now();
    res.json({
      tasks: tasks
        .map((t) => ({ ...t, isOverdue: Boolean(t.dueAt && new Date(t.dueAt).getTime() < now && t.status !== 'COMPLETED') }))
        .sort(byClinicalPriority),
      total: tasks.length,
    });
  } catch (e) { next(e); }
});

router.post('/nursing-tasks', prescribe, async (req, res, next) => {
  try {
    const { patientId, caseId, title, instructions, priority, frequencyHours, dueAt } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!title) return res.status(400).json({ error: 'title is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    const task = await prisma.nursingTask.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, caseId: caseId || null,
        orderedById: req.ctx.userId,
        title, instructions: instructions || null,
        priority: priority || 'ROUTINE',
        frequencyHours: frequencyHours != null ? Number(frequencyHours) : null,
        // An order with no explicit time is due now — nursing should see it.
        dueAt: dueAt ? new Date(dueAt) : new Date(),
      },
    });
    audit(req, 'order.nursing_task.create', 'NursingTask', task.id, title);
    res.status(201).json(task);
  } catch (e) { next(e); }
});

// Completing a task is a nursing action, not a prescribing one.
router.post('/nursing-tasks/:id/complete', execute, async (req, res, next) => {
  try {
    const existing = await prisma.nursingTask.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (existing.status === 'COMPLETED') return res.status(409).json({ error: 'Task is already completed' });

    const { note } = req.body || {};

    const task = await prisma.$transaction(async (tx) => {
      const done = await tx.nursingTask.update({
        where: { id: existing.id },
        data: {
          status: 'COMPLETED',
          completedById: req.ctx.userId,
          completedAt: new Date(),
          completionNote: note || null,
        },
      });

      // A recurring task regenerates itself so the ward never loses the rhythm.
      if (existing.frequencyHours) {
        await tx.nursingTask.create({
          data: {
            facilityId: existing.facilityId, patientId: existing.patientId, caseId: existing.caseId,
            orderedById: existing.orderedById,
            title: existing.title, instructions: existing.instructions,
            priority: existing.priority, frequencyHours: existing.frequencyHours,
            dueAt: new Date(Date.now() + existing.frequencyHours * 3600 * 1000),
          },
        });
      }
      return done;
    });

    audit(req, 'order.nursing_task.complete', 'NursingTask', task.id, note || 'Task completed');
    res.json(task);
  } catch (e) { next(e); }
});

router.patch('/nursing-tasks/:id', execute, async (req, res, next) => {
  try {
    const existing = await prisma.nursingTask.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (status === 'COMPLETED') return res.status(400).json({ error: 'Use the complete endpoint to finish a task' });

    const task = await prisma.nursingTask.update({ where: { id: existing.id }, data: { status } });
    res.json(task);
  } catch (e) { next(e); }
});

// ── Nurse execution worklist ────────────────────────────────────────────────
router.get('/worklist', [authenticate, tenant, requirePermission('drug_admin')], async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const [tasks, prescriptions, specimens] = await prisma.$transaction([
      prisma.nursingTask.findMany({
        where: { facilityId: fid, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' }, take: 50,
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
      }),
      prisma.prescription.findMany({
        where: { facilityId: fid, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }, take: 50,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } },
          administrations: { where: { administeredAt: { gte: startOfDay } }, orderBy: { administeredAt: 'desc' } },
        },
      }),
      // Specimens a nurse still needs to collect.
      prisma.labRequest.findMany({
        where: { facilityId: fid, status: { in: ['PENDING', 'ACCEPTED'] } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: 30,
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
      }),
    ]);

    const now = Date.now();
    res.json({
      tasks: tasks
        .map((t) => ({ ...t, isOverdue: Boolean(t.dueAt && new Date(t.dueAt).getTime() < now) }))
        .sort(byClinicalPriority),
      medications: prescriptions.map((p) => ({ ...p, givenToday: p.administrations.length })),
      specimensToCollect: specimens,
      counts: {
        tasks: tasks.length,
        overdueTasks: tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now).length,
        medications: prescriptions.length,
        specimens: specimens.length,
      },
    });
  } catch (e) { next(e); }
});

// ── Standing orders and their execution history ─────────────────────────────
//
// The nursing task list answers "what is due now". These answer "what was
// instructed, by whom, toward what goal, and has it actually been happening" —
// which is what a ward round and an audit both need, and what a single-completion
// task could never show.

const ORDER_TYPES = ['MEDICATION', 'NURSING', 'DIET', 'ACTIVITY', 'TREATMENT', 'LAB', 'IMAGING'];

/**
 * Guess which chart an order is asking for, from how the doctor wrote it.
 *
 * Doctors write instructions in words, not enum values. Recognising the common
 * phrasings means a nurse is prompted to open the right chart instead of the
 * order sitting there while somebody remembers to start one by hand. Order
 * matters — "catheter output" should match the catheter chart, not fluid balance.
 */
const MONITORING_HINTS = [
  [/\b(catheter|urethral|foley|urine output|urinary)\b/i, 'URINARY_CATHETER'],
  [/\b(ngt|nasogastric|tube feed|feeding tube)\b/i, 'NGT_FEEDING'],
  [/\b(drain|drainage|chest tube)\b/i, 'SURGICAL_DRAIN'],
  [/\b(transfus|blood unit|packed cell|whole blood)\b/i, 'BLOOD_TRANSFUSION'],
  [/\b(iv fluid|infusion|normal saline|dextrose|ringer|drip)\b/i, 'IV_FLUID'],
  [/\b(blood glucose|bgl|rbs|fbs|glucose|insulin|sliding scale)\b/i, 'BGL_INSULIN'],
  [/\b(neuro|gcs|glasgow|conscious level|pupil)\b/i, 'NEURO_OBSERVATION'],
  [/\b(seizure|convulsion|fit chart)\b/i, 'SEIZURE_WATCH'],
  [/\b(wound|dressing|ulcer|pressure sore)\b/i, 'WOUND_CARE'],
  [/\b(intake|input.?output|fluid balance|i&o|i\/o)\b/i, 'INTAKE_OUTPUT'],
  [/\b(vital|observation chart|obs chart|tpr|spo2|saturation)\b/i, 'VITALS'],
];

function inferMonitoringType(text) {
  const value = String(text || '');
  for (const [pattern, type] of MONITORING_HINTS) {
    if (pattern.test(value)) return type;
  }
  return null;
}
const ORDER_STATUSES = ['ACTIVE', 'COMPLETED', 'DISCONTINUED', 'HELD'];
const EXECUTION_OUTCOMES = ['DONE', 'SKIPPED', 'UNABLE'];

/**
 * When the next occurrence of a recurring order is due, and whether it is late.
 *
 * Overdue is judged from the last execution rather than from the order's start,
 * so an order carried out late once does not report every subsequent occurrence
 * as overdue for the rest of its life.
 */
function scheduleFor(order, lastExecutedAt) {
  if (!order.frequencyHours || order.status !== 'ACTIVE') {
    return { dueAt: null, isOverdue: false, hoursLate: 0 };
  }
  const from = lastExecutedAt ? new Date(lastExecutedAt) : new Date(order.startAt);
  const dueAt = new Date(from.getTime() + order.frequencyHours * 3600_000);
  // A quarter of the interval of grace: a Q2H turn is not "missed" at 2h 01m.
  const graceMs = order.frequencyHours * 3600_000 * 0.25;
  const lateBy = Date.now() - (dueAt.getTime() + graceMs);
  return {
    dueAt,
    isOverdue: lateBy > 0,
    hoursLate: lateBy > 0 ? Math.round((lateBy / 3600_000) * 10) / 10 : 0,
  };
}

function decorate(order) {
  const executions = order.executions || [];
  const done = executions.filter((e) => e.outcome === 'DONE');
  const last = executions[0] || null;
  return {
    ...order,
    executionCount: executions.length,
    completedCount: done.length,
    missedCount: executions.length - done.length,
    lastExecutedAt: last?.executedAt || null,
    lastOutcome: last?.outcome || null,
    ...scheduleFor(order, done[0]?.executedAt || null),
  };
}

router.get('/standing', read, async (req, res, next) => {
  try {
    const { patientId, status, type, overdueOnly } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) {
      await requireTenantPatient(req.ctx.facilityId, patientId);
      where.patientId = patientId;
    }
    // `ALL` means no filter — matching it against the enum returns nothing and
    // reads to staff as "the records are gone".
    if (status && status !== 'ALL') where.status = status;
    else if (!status) where.status = 'ACTIVE';
    if (type && type !== 'ALL') where.type = type;

    const orders = await prisma.order.findMany({
      where,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        executions: { orderBy: { executedAt: 'desc' }, take: 20 },
      },
      take: 200,
    });

    let decorated = orders.map(decorate).sort(byClinicalPriority);
    if (overdueOnly === 'true' || overdueOnly === '1') decorated = decorated.filter((o) => o.isOverdue);

    res.json({
      orders: decorated,
      counts: {
        total: decorated.length,
        overdue: decorated.filter((o) => o.isOverdue).length,
        held: decorated.filter((o) => o.status === 'HELD').length,
      },
    });
  } catch (e) { next(e); }
});

router.post('/standing', prescribe, async (req, res, next) => {
  try {
    const {
      patientId, caseId, admissionId, type, name, details, goal, instructions,
      frequencyHours, priority, startAt, stopAt, monitoringType,
    } = req.body || {};

    if (!patientId) return res.status(400).json({ error: 'patientId is required', field: 'patientId' });
    if (!ORDER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${ORDER_TYPES.join(', ')}`, field: 'type' });
    }
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: 'Give the order a name a nurse will recognise', field: 'name' });
    }
    if (frequencyHours != null && (!Number.isFinite(Number(frequencyHours)) || Number(frequencyHours) <= 0)) {
      return res.status(400).json({ error: 'frequencyHours must be a positive number', field: 'frequencyHours' });
    }

    // A doctor can name the chart the order expects, e.g. "catheter, hourly
    // output" carries MonitoringType URINARY_CATHETER. The nurse at the bedside
    // supplies the specifics — the size, the site, the bag actually hung.
    if (monitoringType && !templateFor(monitoringType) && monitoringType !== 'CUSTOM') {
      return res.status(400).json({
        error: `monitoringType must be a known chart type or CUSTOM`,
        field: 'monitoringType',
      });
    }

    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId);

    const order = await prisma.order.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId,
        caseId: caseId || null,
        admissionId: admissionId || null,
        type,
        // Persist what the order needs charted, inferring it from the doctor's
        // own words when they did not pick one. Inferring it only for the
        // response would leave the nurse's list empty — the prompt has to
        // survive past the moment the order was written.
        monitoringType: monitoringType || inferMonitoringType(name) || null,
        name: String(name).trim(),
        details: details && typeof details === 'object' ? details : {},
        goal: goal || null,
        instructions: instructions || null,
        frequencyHours: frequencyHours != null ? Number(frequencyHours) : null,
        priority: ['ROUTINE', 'URGENT', 'STAT'].includes(priority) ? priority : 'ROUTINE',
        orderedById: req.ctx.userId,
        startAt: startAt ? new Date(startAt) : new Date(),
        stopAt: stopAt ? new Date(stopAt) : null,
      },
    });
    audit(req, 'order.standing.create', 'Order', order.id, `${type}: ${order.name}`);

    // Offered, never created automatically: only the nurse hanging the bag or
    // passing the catheter knows the details that make a chart usable.
    const suggestion = order.monitoringType
      ? {
        sheetType: order.monitoringType,
        reason: monitoringType
          ? 'This order asks for a monitoring chart — a nurse opens it at the bedside'
          : `This looks like it needs a ${templateFor(order.monitoringType)?.label || order.monitoringType} chart`,
      }
      : null;

    res.status(201).json(suggestion ? { ...order, suggestedMonitoringSheet: suggestion } : order);
  } catch (e) { next(e); }
});

router.get('/standing/:id', read, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        executions: { orderBy: { executedAt: 'desc' } },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(decorate(order));
  } catch (e) { next(e); }
});

/**
 * Record that an order was carried out — or deliberately was not.
 *
 * A skipped dose with a reason is a clinical fact worth keeping. A skipped dose
 * that simply never appears is a hole in the record that nobody can explain
 * later, so the reason is required rather than optional.
 */
router.post('/standing/:id/execute', execute, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'DISCONTINUED') {
      return res.status(409).json({ error: 'This order has been discontinued' });
    }
    if (order.status === 'HELD') {
      return res.status(409).json({ error: 'This order is on hold — ask the doctor before carrying it out' });
    }

    const { outcome = 'DONE', result, reason, comment, executedAt } = req.body || {};
    if (!EXECUTION_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of: ${EXECUTION_OUTCOMES.join(', ')}`, field: 'outcome' });
    }
    if (outcome !== 'DONE' && String(reason || '').trim().length < 3) {
      return res.status(400).json({ error: 'Say why it was not carried out', field: 'reason' });
    }

    let when = new Date();
    if (executedAt) {
      const parsed = new Date(executedAt);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'executedAt is not a valid date' });
      // Charting something as already done in the future is never right.
      if (parsed.getTime() > Date.now() + 60_000) {
        return res.status(400).json({ error: 'executedAt cannot be in the future', field: 'executedAt' });
      }
      when = parsed;
    }

    const execution = await prisma.orderExecution.create({
      data: {
        facilityId: req.ctx.facilityId,
        orderId: order.id,
        executedAt: when,
        executedById: req.ctx.userId,
        outcome,
        result: result || null,
        reason: reason || null,
        comment: comment || null,
      },
    });

    // A one-off order is finished once it has been done. A recurring one stays
    // active until someone stops it.
    let updated = order;
    if (!order.frequencyHours && outcome === 'DONE') {
      updated = await prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    }
    audit(req, 'order.standing.execute', 'Order', order.id, `${outcome}: ${order.name}`);

    const done = await prisma.orderExecution.findFirst({
      where: { orderId: order.id, outcome: 'DONE' }, orderBy: { executedAt: 'desc' },
    });
    res.status(201).json({ execution, order: { ...updated, ...scheduleFor(updated, done?.executedAt) } });
  } catch (e) { next(e); }
});

/** Hold, resume, or stop an order. Stopping requires a reason. */
router.put('/standing/:id/status', prescribe, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { status, reason } = req.body || {};
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}`, field: 'status' });
    }
    // Stopping a treatment is a clinical decision; the record should say why.
    if (status === 'DISCONTINUED' && String(reason || '').trim().length < 3) {
      return res.status(400).json({ error: 'Say why this order is being stopped', field: 'reason' });
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status,
        ...(status === 'DISCONTINUED' ? {
          discontinuedAt: new Date(),
          discontinuedById: req.ctx.userId,
          discontinueReason: String(reason).trim(),
        } : {}),
      },
    });
    audit(req, 'order.standing.status', 'Order', order.id, `${status}${reason ? `: ${reason}` : ''}`);
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
