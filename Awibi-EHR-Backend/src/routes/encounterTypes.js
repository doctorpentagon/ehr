const express = require('express');

const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

/**
 * Encounter classification and the clinic timetable.
 *
 * Reading is open to any clinical role — a doctor has to pick a type when they
 * start an encounter, and a nurse needs to know which clinics are running.
 * Configuring belongs to the administrator: these are the categories every
 * report and price list is built on, so they should not drift because someone
 * renamed one mid-shift.
 */
const read = [authenticate, tenant, requirePermission('cases')];
const configure = [authenticate, tenant, requirePermission('settings'), (req, res, next) => {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only a facility administrator can configure encounter types' });
  }
  next();
}];

/**
 * The types every facility starts with.
 *
 * Seeded on first read rather than by migration, so a facility created later
 * gets them too without anybody remembering to run something.
 */
const SYSTEM_TYPES = [
  { name: 'Emergency', description: 'Unscheduled attendance needing immediate assessment', defaultDurationMins: 30, sortOrder: 0 },
  { name: 'OPD Clinic', description: 'Scheduled outpatient consultation', defaultDurationMins: 20, sortOrder: 1 },
  { name: 'Inpatient Ward Round', description: 'Review of an admitted patient', defaultDurationMins: 10, sortOrder: 2 },
  { name: 'Inpatient Admission', description: 'Clerking a patient onto the ward', defaultDurationMins: 45, sortOrder: 3 },
  { name: 'Surgery', description: 'Operative procedure', defaultDurationMins: 90, sortOrder: 4 },
  { name: 'Teleconsult', description: 'Consultation by phone or video', defaultDurationMins: 15, sortOrder: 5 },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function ensureSystemTypes(facilityId) {
  const existing = await prisma.encounterTypeConfig.count({ where: { facilityId } });
  if (existing > 0) return;
  await prisma.encounterTypeConfig.createMany({
    data: SYSTEM_TYPES.map((t) => ({ ...t, facilityId, isSystem: true })),
    skipDuplicates: true,
  });
}

/** "08:00" ⇄ minutes from midnight. Stored as numbers so slot arithmetic is arithmetic. */
function toMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

function toClock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// ── Encounter types ─────────────────────────────────────────────────────────

router.get('/', read, async (req, res, next) => {
  try {
    await ensureSystemTypes(req.ctx.facilityId);
    const { includeInactive } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (includeInactive !== 'true' && includeInactive !== '1') where.isActive = true;

    const types = await prisma.encounterTypeConfig.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { cases: true, schedules: true } } },
    });
    res.json({ types, total: types.length });
  } catch (e) { next(e); }
});

router.post('/', configure, async (req, res, next) => {
  try {
    const { name, description, defaultDurationMins, sortOrder } = req.body || {};
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: 'Give the encounter type a name', field: 'name' });
    }
    if (defaultDurationMins != null && (!Number.isFinite(Number(defaultDurationMins)) || defaultDurationMins <= 0)) {
      return res.status(400).json({ error: 'Duration must be a positive number of minutes', field: 'defaultDurationMins' });
    }

    await ensureSystemTypes(req.ctx.facilityId);
    const clash = await prisma.encounterTypeConfig.findFirst({
      where: { facilityId: req.ctx.facilityId, name: String(name).trim() },
    });
    if (clash) return res.status(409).json({ error: `"${clash.name}" already exists` });

    const created = await prisma.encounterTypeConfig.create({
      data: {
        facilityId: req.ctx.facilityId,
        name: String(name).trim(),
        description: description || null,
        defaultDurationMins: defaultDurationMins != null ? Number(defaultDurationMins) : null,
        sortOrder: sortOrder != null ? Number(sortOrder) : 100,
      },
    });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.put('/:id', configure, async (req, res, next) => {
  try {
    const type = await prisma.encounterTypeConfig.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!type) return res.status(404).json({ error: 'Encounter type not found' });

    const { name, description, defaultDurationMins, isActive, sortOrder } = req.body || {};
    // A seeded type can be deactivated or described differently, but renaming
    // it would silently change what every existing report is counting.
    if (type.isSystem && name && name !== type.name) {
      return res.status(400).json({ error: 'Built-in types cannot be renamed — add a new type instead', field: 'name' });
    }

    const updated = await prisma.encounterTypeConfig.update({
      where: { id: type.id },
      data: {
        ...(name ? { name: String(name).trim() } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(defaultDurationMins !== undefined ? { defaultDurationMins: defaultDurationMins == null ? null : Number(defaultDurationMins) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(sortOrder !== undefined ? { sortOrder: Number(sortOrder) } : {}),
      },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/:id', configure, async (req, res, next) => {
  try {
    const type = await prisma.encounterTypeConfig.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: { _count: { select: { cases: true, schedules: true } } },
    });
    if (!type) return res.status(404).json({ error: 'Encounter type not found' });
    if (type.isSystem) {
      return res.status(400).json({ error: 'Built-in types cannot be deleted — deactivate it instead' });
    }
    // Deleting a type that encounters point at would strand those records and
    // break any report grouped by it. Deactivate so it stops being offered.
    if (type._count.cases > 0) {
      const deactivated = await prisma.encounterTypeConfig.update({
        where: { id: type.id }, data: { isActive: false },
      });
      return res.json({
        ...deactivated,
        note: `${type._count.cases} encounter(s) use this type, so it was deactivated rather than deleted.`,
      });
    }
    await prisma.encounterTypeConfig.delete({ where: { id: type.id } });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

// ── Clinic schedules ────────────────────────────────────────────────────────

router.get('/schedules', read, async (req, res, next) => {
  try {
    const { dayOfWeek, doctorId, today } = req.query;
    const where = { facilityId: req.ctx.facilityId, isActive: true };

    if (today === 'true' || today === '1') where.dayOfWeek = new Date().getDay();
    else if (dayOfWeek !== undefined && dayOfWeek !== 'ALL') where.dayOfWeek = Number(dayOfWeek);
    if (doctorId) where.doctors = { some: { userId: doctorId } };

    const schedules = await prisma.clinicSchedule.findMany({
      where,
      orderBy: [{ dayOfWeek: 'asc' }, { startMinutes: 'asc' }],
      include: {
        encounterType: { select: { id: true, name: true, defaultDurationMins: true } },
        department: { select: { id: true, name: true } },
        doctors: {
          include: { doctor: { select: { id: true, firstName: true, lastName: true, specialty: true } } },
        },
      },
    });

    res.json({
      schedules: schedules.map((s) => ({
        ...s,
        dayName: DAY_NAMES[s.dayOfWeek],
        startTime: toClock(s.startMinutes),
        endTime: toClock(s.endMinutes),
        doctors: s.doctors.map((d) => d.doctor),
      })),
      total: schedules.length,
    });
  } catch (e) { next(e); }
});

router.post('/schedules', configure, async (req, res, next) => {
  try {
    const {
      encounterTypeId, departmentId, dayOfWeek, startTime, endTime,
      location, maxPatients, doctorIds,
    } = req.body || {};

    const type = await prisma.encounterTypeConfig.findFirst({
      where: { id: encounterTypeId, facilityId: req.ctx.facilityId },
    });
    if (!type) return res.status(400).json({ error: 'Choose an encounter type for this clinic', field: 'encounterTypeId' });

    const day = Number(dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return res.status(400).json({ error: 'Choose a day of the week', field: 'dayOfWeek' });
    }

    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    if (start == null || end == null) {
      return res.status(400).json({ error: 'Give start and end times as HH:MM', field: 'startTime' });
    }
    // A clinic that ends before it starts produces negative slot arithmetic and
    // an empty booking page nobody can explain.
    if (end <= start) {
      return res.status(400).json({ error: 'The clinic must end after it starts', field: 'endTime' });
    }

    // Every named doctor has to actually work here.
    const ids = Array.isArray(doctorIds) ? doctorIds.filter(Boolean) : [];
    if (ids.length) {
      const valid = await prisma.user.count({
        where: { id: { in: ids }, facilityId: req.ctx.facilityId, isActive: true },
      });
      if (valid !== ids.length) {
        return res.status(400).json({ error: 'One of those clinicians is not in this facility', field: 'doctorIds' });
      }
    }

    const schedule = await prisma.clinicSchedule.create({
      data: {
        facilityId: req.ctx.facilityId,
        encounterTypeId,
        departmentId: departmentId || null,
        dayOfWeek: day,
        startMinutes: start,
        endMinutes: end,
        location: location || null,
        maxPatients: maxPatients != null ? Number(maxPatients) : null,
        doctors: ids.length ? { create: ids.map((userId) => ({ userId })) } : undefined,
      },
      include: {
        encounterType: { select: { id: true, name: true } },
        doctors: { include: { doctor: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    res.status(201).json({
      ...schedule,
      dayName: DAY_NAMES[schedule.dayOfWeek],
      startTime: toClock(schedule.startMinutes),
      endTime: toClock(schedule.endMinutes),
    });
  } catch (e) { next(e); }
});

router.put('/schedules/:id', configure, async (req, res, next) => {
  try {
    const schedule = await prisma.clinicSchedule.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!schedule) return res.status(404).json({ error: 'Clinic not found' });

    const { dayOfWeek, startTime, endTime, location, maxPatients, isActive, doctorIds, departmentId } = req.body || {};

    const start = startTime !== undefined ? toMinutes(startTime) : schedule.startMinutes;
    const end = endTime !== undefined ? toMinutes(endTime) : schedule.endMinutes;
    if (start == null || end == null) return res.status(400).json({ error: 'Times must be HH:MM', field: 'startTime' });
    if (end <= start) return res.status(400).json({ error: 'The clinic must end after it starts', field: 'endTime' });

    if (Array.isArray(doctorIds)) {
      await prisma.clinicScheduleDoctor.deleteMany({ where: { scheduleId: schedule.id } });
      if (doctorIds.length) {
        await prisma.clinicScheduleDoctor.createMany({
          data: doctorIds.filter(Boolean).map((userId) => ({ scheduleId: schedule.id, userId })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await prisma.clinicSchedule.update({
      where: { id: schedule.id },
      data: {
        ...(dayOfWeek !== undefined ? { dayOfWeek: Number(dayOfWeek) } : {}),
        startMinutes: start,
        endMinutes: end,
        ...(location !== undefined ? { location: location || null } : {}),
        ...(maxPatients !== undefined ? { maxPatients: maxPatients == null ? null : Number(maxPatients) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(departmentId !== undefined ? { departmentId: departmentId || null } : {}),
      },
      include: {
        encounterType: { select: { id: true, name: true } },
        doctors: { include: { doctor: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    res.json({
      ...updated,
      dayName: DAY_NAMES[updated.dayOfWeek],
      startTime: toClock(updated.startMinutes),
      endTime: toClock(updated.endMinutes),
    });
  } catch (e) { next(e); }
});

router.delete('/schedules/:id', configure, async (req, res, next) => {
  try {
    const schedule = await prisma.clinicSchedule.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!schedule) return res.status(404).json({ error: 'Clinic not found' });
    await prisma.clinicSchedule.delete({ where: { id: schedule.id } });
    res.json({ deleted: true });
  } catch (e) { next(e); }
});

/**
 * The clinics running today, for the ward board.
 *
 * A doctor arriving on shift should be able to see what they are running
 * without opening a settings page and working out which day it is.
 */
router.get('/schedules/today', read, async (req, res, next) => {
  try {
    const day = new Date().getDay();
    const schedules = await prisma.clinicSchedule.findMany({
      where: { facilityId: req.ctx.facilityId, isActive: true, dayOfWeek: day },
      orderBy: { startMinutes: 'asc' },
      include: {
        encounterType: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        doctors: { include: { doctor: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    res.json({
      day: DAY_NAMES[day],
      clinics: schedules.map((s) => ({
        id: s.id,
        name: s.encounterType.name,
        encounterTypeId: s.encounterTypeId,
        department: s.department?.name || null,
        location: s.location,
        startTime: toClock(s.startMinutes),
        endTime: toClock(s.endMinutes),
        maxPatients: s.maxPatients,
        doctors: s.doctors.map((d) => d.doctor),
        // So the board can put the clinic actually running now at the top.
        isRunningNow: nowMinutes >= s.startMinutes && nowMinutes < s.endMinutes,
        hasFinished: nowMinutes >= s.endMinutes,
      })),
    });
  } catch (e) { next(e); }
});

module.exports = { router, toMinutes, toClock, DAY_NAMES };
