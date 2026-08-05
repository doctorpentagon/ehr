const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');
const { ensureUniqueUPID } = require('../utils/upid');
const { PROTOCOLS, protocolsForType, dueRepeats } = require('../utils/resuscitationProtocols');

// Emergency intake has its own permission on purpose. It was previously tied to
// patient_demographics_write, which meant a nurse or doctor at the bedside could
// NOT open an emergency encounter — only a records officer could. In a real
// emergency unit the nurse receives the collapsing patient, often at 2am with no
// clerk present, so that arrangement blocked care. `emergency_write` is held by
// reception, administration, nursing and doctors; the clinical content recorded
// afterwards still obeys the normal clinical permissions.
const read = [authenticate, tenant, requirePermission('emergency')];
const write = [authenticate, tenant, requirePermission('emergency_write')];

// Presentations that change immediate management if present. Kept short and
// unambiguous so they can be ticked in seconds at the bedside.
const RED_FLAGS = [
  { key: 'airway',        label: 'Airway compromise / stridor' },
  { key: 'breathing',     label: 'Difficulty breathing' },
  { key: 'chest_pain',    label: 'Chest pain' },
  { key: 'bleeding',      label: 'Severe bleeding' },
  { key: 'consciousness', label: 'Altered consciousness' },
  { key: 'seizure',       label: 'Active seizure' },
  { key: 'shock',         label: 'Signs of shock' },
  { key: 'drooling',      label: 'Drooling / cannot swallow' },
  { key: 'severe_pain',   label: 'Severe pain' },
  { key: 'trauma',        label: 'Major trauma' },
  { key: 'poisoning',     label: 'Poisoning / overdose' },
  { key: 'pregnancy',     label: 'Pregnancy complication' },
];

function audit(req, action, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId, action,
      resource: 'EmergencyEncounter', resourceId, reason: reason || 'Emergency care', ip: req.ip,
    },
  }).catch(() => {});
}

router.get('/red-flags', read, (req, res) => res.json({ redFlags: RED_FLAGS }));

// Active board, most urgent first.
const TRIAGE_ORDER = ['RESUSCITATION', 'EMERGENCY', 'URGENT', 'SEMI_URGENT', 'NON_URGENT'];

router.get('/', read, async (req, res, next) => {
  try {
    const { status = 'ACTIVE', limit = 50 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (status && status !== 'ALL') where.status = status;

    const encounters = await prisma.emergencyEncounter.findMany({
      where, take: Math.min(Number(limit) || 50, 100), orderBy: { createdAt: 'desc' },
      include: {
        patient: {
          select: {
            id: true, firstName: true, lastName: true, universalPatientId: true,
            mrn: true, phone: true, dateOfBirth: true, isEmergencyTemp: true,
          },
        },
      },
    });

    encounters.sort((a, b) => {
      const t = TRIAGE_ORDER.indexOf(a.triage) - TRIAGE_ORDER.indexOf(b.triage);
      return t !== 0 ? t : new Date(a.createdAt) - new Date(b.createdAt);
    });

    res.json({ encounters, total: encounters.length });
  } catch (e) { next(e); }
});

router.get('/stats', read, async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const [active, resus, unidentified] = await prisma.$transaction([
      prisma.emergencyEncounter.count({ where: { facilityId: fid, status: 'ACTIVE' } }),
      prisma.emergencyEncounter.count({ where: { facilityId: fid, status: 'ACTIVE', triage: { in: ['RESUSCITATION', 'EMERGENCY'] } } }),
      prisma.emergencyEncounter.count({ where: { facilityId: fid, status: 'ACTIVE', patient: { isEmergencyTemp: true } } }),
    ]);
    res.json({ active, criticalTriage: resus, awaitingIdentification: unidentified });
  } catch (e) { next(e); }
});

// ── Resuscitation ───────────────────────────────────────────────────────────
//
// The account of an arrest is written by people whose hands are busy. Every
// endpoint here is built so a single tap records a complete, timestamped fact:
// the offset from the call is derived from the clock, never typed.

const RESUS_TYPES = ['CODE_BLUE', 'RAPID_RESPONSE', 'SEPSIS_ALERT', 'OTHER'];
const RESUS_OUTCOMES = ['ROSC', 'DECEASED', 'TRANSFERRED_ICU', 'TRANSFERRED_THEATRE', 'STABILISED', 'OTHER'];

/** The protocol checklists, so the board can render without hardcoding them. */
router.get('/resuscitation/protocols', read, (req, res) => {
  const { type } = req.query;
  res.json({ protocols: type ? protocolsForType(type) : PROTOCOLS });
});

router.post('/resuscitation', write, async (req, res, next) => {
  try {
    const { patientId, caseId, emergencyEncounterId, type = 'CODE_BLUE', protocols, teamMembers, startedAt } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required', field: 'patientId' });
    if (!RESUS_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${RESUS_TYPES.join(', ')}`, field: 'type' });
    }
    await requireTenantPatient(req.ctx.facilityId, patientId);

    // An arrest already running must not be duplicated by a second person
    // opening the board — two half-records are worse than one.
    const running = await prisma.resuscitationEvent.findFirst({
      where: { facilityId: req.ctx.facilityId, patientId, endedAt: null },
    });
    if (running) {
      return res.status(409).json({
        error: 'A resuscitation is already running for this patient',
        eventId: running.id,
        startedAt: running.startedAt,
      });
    }

    const event = await prisma.resuscitationEvent.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId,
        caseId: caseId || null,
        emergencyEncounterId: emergencyEncounterId || null,
        type,
        startedAt: startedAt ? new Date(startedAt) : new Date(),
        protocols: Array.isArray(protocols) ? protocols : [],
        teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
        startedById: req.ctx.userId,
      },
    });
    audit(req, 'resuscitation.start', event.id, `${type} started`);
    res.status(201).json({ ...event, availableProtocols: protocolsForType(type) });
  } catch (e) { next(e); }
});

router.get('/resuscitation/:id', read, async (req, res, next) => {
  try {
    const event = await prisma.resuscitationEvent.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        entries: { orderBy: { timeOffsetSeconds: 'asc' } },
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true, isEmergencyTemp: true } },
      },
    });
    if (!event) return res.status(404).json({ error: 'Resuscitation record not found' });

    const elapsedSeconds = Math.floor(
      ((event.endedAt ? new Date(event.endedAt) : new Date()) - new Date(event.startedAt)) / 1000,
    );

    // Repeats are judged against the furthest point on the timeline, not the
    // wall clock alone. Someone writing up the first two minutes after the fact
    // is normal, and in that moment the timeline is the account the team is
    // working from — measuring against the clock would report nothing as due.
    const furthest = event.entries.reduce((max, e) => Math.max(max, e.timeOffsetSeconds), 0);
    const timelineNow = Math.max(elapsedSeconds, furthest);

    res.json({
      ...event,
      elapsedSeconds,
      availableProtocols: protocolsForType(event.type),
      // What is due again — the thing a team cannot track reliably mid-arrest.
      dueRepeats: event.endedAt ? [] : dueRepeats(event.protocols, event.entries, timelineNow),
    });
  } catch (e) { next(e); }
});

/** Anything currently running, for the ward banner. */
router.get('/resuscitation', read, async (req, res, next) => {
  try {
    const { patientId, active } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    if (active === 'true' || active === '1') where.endedAt = null;

    const events = await prisma.resuscitationEvent.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        entries: { orderBy: { timeOffsetSeconds: 'asc' } },
      },
    });
    res.json({
      events: events.map((e) => ({
        ...e,
        elapsedSeconds: Math.floor(((e.endedAt ? new Date(e.endedAt) : new Date()) - new Date(e.startedAt)) / 1000),
        actionCount: e.entries.length,
      })),
      activeCount: events.filter((e) => !e.endedAt).length,
    });
  } catch (e) { next(e); }
});

/**
 * Log one action.
 *
 * The offset is computed here rather than sent by the client, so a slow network
 * or a phone with the wrong clock cannot corrupt the sequence of events — which
 * in an arrest is the part that matters most.
 */
router.post('/resuscitation/:id/entries', write, async (req, res, next) => {
  try {
    const event = await prisma.resuscitationEvent.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!event) return res.status(404).json({ error: 'Resuscitation record not found' });
    if (event.endedAt) return res.status(409).json({ error: 'This resuscitation has already been closed' });

    const { action, detail, meta, timeOffsetSeconds } = req.body || {};
    if (!String(action || '').trim()) {
      return res.status(400).json({ error: 'Say what was done', field: 'action' });
    }

    // Retrospective entries are allowed — someone writing up the first two
    // minutes afterwards is normal — but they cannot precede the call.
    let offset = Math.floor((Date.now() - new Date(event.startedAt).getTime()) / 1000);
    if (timeOffsetSeconds != null) {
      const supplied = Number(timeOffsetSeconds);
      if (!Number.isFinite(supplied) || supplied < 0) {
        return res.status(400).json({ error: 'timeOffsetSeconds must be zero or more', field: 'timeOffsetSeconds' });
      }
      offset = Math.floor(supplied);
    }

    const entry = await prisma.resuscitationTimelineEntry.create({
      data: {
        eventId: event.id,
        facilityId: req.ctx.facilityId,
        timeOffsetSeconds: offset,
        action: String(action).trim(),
        detail: detail || null,
        meta: meta && typeof meta === 'object' ? meta : {},
        performedById: req.ctx.userId,
      },
    });
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

router.put('/resuscitation/:id/end', write, async (req, res, next) => {
  try {
    const event = await prisma.resuscitationEvent.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!event) return res.status(404).json({ error: 'Resuscitation record not found' });
    if (event.endedAt) return res.status(409).json({ error: 'This resuscitation has already been closed' });

    const { outcome, outcomeNote, teamMembers } = req.body || {};
    if (!RESUS_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of: ${RESUS_OUTCOMES.join(', ')}`, field: 'outcome' });
    }

    const updated = await prisma.resuscitationEvent.update({
      where: { id: event.id },
      data: {
        endedAt: new Date(),
        endedById: req.ctx.userId,
        outcome,
        outcomeNote: outcomeNote || null,
        ...(Array.isArray(teamMembers) ? { teamMembers } : {}),
      },
      include: { entries: { orderBy: { timeOffsetSeconds: 'asc' } } },
    });
    audit(req, 'resuscitation.end', event.id, `Outcome: ${outcome}`);
    res.json({
      ...updated,
      elapsedSeconds: Math.floor((new Date(updated.endedAt) - new Date(updated.startedAt)) / 1000),
    });
  } catch (e) { next(e); }
});

router.get('/:id', read, async (req, res, next) => {
  try {
    const encounter = await prisma.emergencyEncounter.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { patient: true },
    });
    if (!encounter) return res.status(404).json({ error: 'Emergency encounter not found' });

    const [vitals, labRequests, documents] = await prisma.$transaction([
      prisma.vitals.findMany({ where: { patientId: encounter.patientId }, orderBy: { recordedAt: 'desc' }, take: 20 }),
      prisma.labRequest.findMany({ where: { patientId: encounter.patientId, facilityId: req.ctx.facilityId }, orderBy: { createdAt: 'desc' } }),
      prisma.patientDocument.findMany({ where: { patientId: encounter.patientId, facilityId: req.ctx.facilityId }, orderBy: { createdAt: 'desc' } }),
    ]);

    res.json({ ...encounter, vitals, labRequests, documents, redFlagCatalogue: RED_FLAGS });
  } catch (e) { next(e); }
});

// Suggest existing patients matching the name/phone given on arrival, so staff
// can attach to a known record instead of creating a duplicate.
router.get('/match/suggest', read, async (req, res, next) => {
  try {
    const { name, phone } = req.query;
    const or = [];
    if (phone && phone.length >= 4) or.push({ phone: { contains: phone } });
    if (name && name.length >= 2) {
      for (const part of String(name).split(/\s+/).filter((p) => p.length >= 2)) {
        or.push({ firstName: { contains: part, mode: 'insensitive' } });
        or.push({ lastName: { contains: part, mode: 'insensitive' } });
      }
    }
    if (!or.length) return res.json({ matches: [] });

    const matches = await prisma.patient.findMany({
      where: { facilityId: req.ctx.facilityId, isArchived: false, isEmergencyTemp: false, OR: or },
      take: 6,
      select: {
        id: true, firstName: true, lastName: true, universalPatientId: true,
        mrn: true, phone: true, dateOfBirth: true, gender: true,
      },
    });
    res.json({ matches });
  } catch (e) { next(e); }
});

// Start an emergency. Either attach to a known patient, or create a temporary
// record from a name alone — care must never wait on paperwork.
router.post('/', write, async (req, res, next) => {
  try {
    const {
      patientId, presentingName, presentingPhone, approximateAge,
      triage, chiefComplaint, arrivalMode, redFlags,
    } = req.body || {};

    if (!patientId && !presentingName) {
      return res.status(400).json({ error: 'A name is required when no patient is selected' });
    }

    // Resolved outside the transaction: the uniqueness check reads committed rows.
    const newUpid = patientId ? null : await ensureUniqueUPID();

    const result = await prisma.$transaction(async (tx) => {
      let patient;

      if (patientId) {
        patient = await tx.patient.findFirst({ where: { id: patientId, facilityId: req.ctx.facilityId } });
        if (!patient) throw Object.assign(new Error('Patient not found in this facility'), { statusCode: 404 });
      } else {
        // Split the given name conservatively — "Unknown" is a legitimate surname
        // here, and staff correct it during reconciliation.
        const parts = String(presentingName).trim().split(/\s+/);
        const firstName = parts[0];
        const lastName = parts.slice(1).join(' ') || 'Unknown';

        let dateOfBirth = null;
        if (approximateAge != null && Number.isFinite(Number(approximateAge))) {
          const d = new Date();
          d.setFullYear(d.getFullYear() - Number(approximateAge));
          dateOfBirth = d;
        }

        patient = await tx.patient.create({
          data: {
            facilityId: req.ctx.facilityId,
            universalPatientId: newUpid,
            firstName, lastName,
            phone: presentingPhone || null,
            dateOfBirth,
            status: 'OUT_PATIENT',
            entryMode: 'EMERGENCY',
            isEmergencyTemp: true,
            notes: 'Created at emergency intake — identity not yet confirmed.',
          },
        });
      }

      const encounter = await tx.emergencyEncounter.create({
        data: {
          facilityId: req.ctx.facilityId,
          patientId: patient.id,
          presentingName: presentingName || `${patient.firstName} ${patient.lastName}`,
          presentingPhone: presentingPhone || patient.phone || null,
          approximateAge: approximateAge != null ? Number(approximateAge) : null,
          arrivalMode: arrivalMode || null,
          triage: triage || 'URGENT',
          chiefComplaint: chiefComplaint || null,
          redFlags: Array.isArray(redFlags) ? redFlags : [],
          openedById: req.ctx.userId,
        },
      });

      return { encounter, patient };
    });

    audit(req, 'emergency.open', result.encounter.id, `Triage ${result.encounter.triage}`);
    res.status(201).json({ ...result.encounter, patient: result.patient });
  } catch (e) { next(e); }
});

router.put('/:id', write, async (req, res, next) => {
  try {
    const existing = await prisma.emergencyEncounter.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Emergency encounter not found' });
    if (existing.status === 'MERGED') {
      return res.status(409).json({ error: 'This encounter was merged and can no longer be edited' });
    }

    const { id, facilityId, patientId, createdAt, updatedAt, mergedIntoPatientId, mergedAt, ...data } = req.body;
    if (data.status && ['DISCHARGED', 'ADMITTED', 'TRANSFERRED', 'DECEASED'].includes(data.status)) {
      data.closedAt = new Date();
    }

    const encounter = await prisma.emergencyEncounter.update({ where: { id: existing.id }, data });
    audit(req, 'emergency.update', encounter.id);
    res.json(encounter);
  } catch (e) { next(e); }
});

/**
 * Attach an emergency record to an existing patient.
 *
 * Everything clinical recorded against the temporary record is re-pointed at the
 * real patient — nothing is deleted, because a merge that loses a lab result or
 * a vital sign is a patient-safety incident. The temporary shell is archived
 * rather than destroyed so the trail survives.
 */
router.post('/:id/link', write, async (req, res, next) => {
  try {
    const { targetPatientId } = req.body || {};
    if (!targetPatientId) return res.status(400).json({ error: 'targetPatientId is required' });

    const encounter = await prisma.emergencyEncounter.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { patient: true },
    });
    if (!encounter) return res.status(404).json({ error: 'Emergency encounter not found' });
    if (encounter.status === 'MERGED') return res.status(409).json({ error: 'Already merged' });

    const target = await requireTenantPatient(req.ctx.facilityId, targetPatientId);
    const tempId = encounter.patientId;
    if (tempId === target.id) return res.status(409).json({ error: 'The encounter is already on that patient' });
    if (!encounter.patient.isEmergencyTemp) {
      return res.status(409).json({ error: 'This encounter is already attached to a permanent record' });
    }

    const moved = await prisma.$transaction(async (tx) => {
      const scope = { patientId: tempId };
      const to = { patientId: target.id };

      const [vitals, labs, docs, cases, prescriptions, monitoring, drugs, growth, handovers, invoices, appointments,
        orders, resuscitations] =
        await Promise.all([
          tx.vitals.updateMany({ where: scope, data: to }),
          tx.labRequest.updateMany({ where: scope, data: to }),
          tx.patientDocument.updateMany({ where: scope, data: to }),
          tx.case.updateMany({ where: scope, data: to }),
          tx.prescription.updateMany({ where: scope, data: to }),
          tx.monitoringSheet.updateMany({ where: scope, data: to }),
          tx.drugAdministration.updateMany({ where: scope, data: to }),
          tx.growthMeasurement.updateMany({ where: scope, data: to }),
          tx.handoverNote.updateMany({ where: scope, data: to }),
          tx.invoice.updateMany({ where: scope, data: to }),
          tx.appointment.updateMany({ where: scope, data: to }),
          tx.order.updateMany({ where: scope, data: to }),
          // The account of a resuscitation is often the most consequential
          // record the patient has. It must follow them to their real chart,
          // not stay behind on the archived intake shell.
          tx.resuscitationEvent.updateMany({ where: scope, data: to }),
        ]);

      await tx.emergencyEncounter.update({
        where: { id: encounter.id },
        data: {
          patientId: target.id,
          status: 'MERGED',
          mergedIntoPatientId: target.id,
          mergedAt: new Date(),
          mergedById: req.ctx.userId,
        },
      });

      // Keep the shell, archived, so the original intake remains auditable.
      await tx.patient.update({
        where: { id: tempId },
        data: {
          isArchived: true,
          archivedAt: new Date(),
          archivedById: req.ctx.userId,
          notes: `Emergency intake shell merged into ${target.universalPatientId} on ${new Date().toISOString()}.`,
        },
      });

      return {
        vitals: vitals.count, labRequests: labs.count, documents: docs.count, cases: cases.count,
        prescriptions: prescriptions.count, monitoringSheets: monitoring.count,
        drugAdministrations: drugs.count, growthMeasurements: growth.count,
        handoverNotes: handovers.count, invoices: invoices.count, appointments: appointments.count,
        orders: orders.count, resuscitationEvents: resuscitations.count,
      };
    });

    audit(req, 'emergency.merge', encounter.id,
      `Merged temporary record into ${target.universalPatientId}`);

    res.json({
      message: 'Emergency record linked to the existing patient',
      targetPatient: { id: target.id, universalPatientId: target.universalPatientId, firstName: target.firstName, lastName: target.lastName },
      moved,
    });
  } catch (e) { next(e); }
});

// Promote the temporary record to a full registration, keeping the same row so
// every clinical reference stays valid.
router.post('/:id/register', write, async (req, res, next) => {
  try {
    const encounter = await prisma.emergencyEncounter.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { patient: true },
    });
    if (!encounter) return res.status(404).json({ error: 'Emergency encounter not found' });
    if (!encounter.patient.isEmergencyTemp) {
      return res.status(409).json({ error: 'This encounter already has a permanent patient record' });
    }

    const { firstName, lastName, dateOfBirth, gender, phone, address, state, mrn, email } = req.body || {};
    if (!firstName || !lastName) return res.status(400).json({ error: 'firstName and lastName are required' });
    if (dateOfBirth && new Date(dateOfBirth) > new Date()) {
      return res.status(400).json({ error: 'Date of birth cannot be in the future' });
    }

    const patient = await prisma.patient.update({
      where: { id: encounter.patientId },
      data: {
        firstName, lastName,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : encounter.patient.dateOfBirth,
        gender: gender || encounter.patient.gender,
        phone: phone ?? encounter.patient.phone,
        email: email ?? encounter.patient.email,
        address: address ?? encounter.patient.address,
        state: state ?? encounter.patient.state,
        mrn: mrn ?? encounter.patient.mrn,
        isEmergencyTemp: false,
        notes: null,
      },
    });

    audit(req, 'emergency.register', encounter.id, `Temporary record promoted to ${patient.universalPatientId}`);
    res.json({ message: 'Patient registered', patient });
  } catch (e) { next(e); }
});

module.exports = router;
