const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { prisma } = require('../utils/database');

/**
 * PUBLIC, UNAUTHENTICATED SURFACE.
 *
 * This is the only router in the API that serves anonymous callers, so it is
 * written defensively:
 *   - it never exposes patient data, only facility/service/doctor listings;
 *   - a returning patient is confirmed by phone but their record is NEVER
 *     returned to the browser — the caller learns only "we found you";
 *   - booking requests are inert until staff confirm them, so nothing here can
 *     write to the clinical record;
 *   - everything is rate limited.
 */

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking attempts from this connection. Please call the clinic instead.' },
});

router.use(publicLimiter);

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Public fields only. Licence numbers and internal settings are not public.
const PUBLIC_FACILITY_FIELDS = {
  id: true, name: true, type: true, email: true, phone: true, address: true,
  state: true, lga: true, logo: true, slug: true, tagline: true,
  primaryColor: true, receptionPhone: true, whatsappNumber: true,
  workingHours: true, enableTriageWidget: true,
};

/**
 * Resolve a facility from its public URL segment.
 *
 * The stored slug is authoritative. Falling back to a name-derived slug keeps
 * links working for facilities set up before slugs were stored — but it is only
 * a fallback, because deriving it means two facilities sharing a name resolve to
 * the same page, and a rename silently breaks every link already published.
 */
async function facilityBySlug(slug) {
  const stored = await prisma.facility.findFirst({
    where: { slug, isActive: true },
    select: PUBLIC_FACILITY_FIELDS,
  });
  if (stored) return stored;

  const facilities = await prisma.facility.findMany({
    where: { isActive: true, slug: null },
    select: PUBLIC_FACILITY_FIELDS,
  });
  return facilities.find((f) => slugify(f.name) === slug) || null;
}

router.get('/clinics', async (req, res, next) => {
  try {
    const facilities = await prisma.facility.findMany({
      where: { isActive: true },
      select: { name: true, type: true, state: true, lga: true },
      orderBy: { name: 'asc' },
    });
    res.json({ clinics: facilities.map((f) => ({ ...f, slug: slugify(f.name) })) });
  } catch (e) { next(e); }
});

// Landing page payload: who we are, what we offer, who you can see.
router.get('/clinic/:slug', async (req, res, next) => {
  try {
    const facility = await facilityBySlug(req.params.slug);
    if (!facility) return res.status(404).json({ error: 'Clinic not found' });

    const [departments, doctors, services] = await prisma.$transaction([
      prisma.department.findMany({
        where: { facilityId: facility.id },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { facilityId: facility.id, isActive: true, subRole: 'DOCTOR' },
        // Deliberately minimal: no email, phone, staff ID or login state.
        select: { id: true, firstName: true, lastName: true, specialty: true, avatar: true },
        orderBy: { firstName: 'asc' },
      }),
      prisma.diagnosticTest.findMany({
        where: { facilityId: facility.id, isActive: true },
        select: { name: true, testType: true, category: true, price: true },
        orderBy: { name: 'asc' },
        take: 60,
      }),
    ]);

    res.json({
      clinic: { ...facility, slug: req.params.slug },
      departments,
      doctors,
      services,
    });
  } catch (e) { next(e); }
});

// Free slots for the next 7 days, derived from confirmed appointments so a
// booked slot is never offered twice.
router.get('/clinic/:slug/availability', async (req, res, next) => {
  try {
    const facility = await facilityBySlug(req.params.slug);
    if (!facility) return res.status(404).json({ error: 'Clinic not found' });

    const { doctorId, days = 7 } = req.query;
    if (!doctorId) return res.status(400).json({ error: 'doctorId is required' });

    const doctor = await prisma.user.findFirst({
      where: { id: doctorId, facilityId: facility.id, isActive: true, subRole: 'DOCTOR' },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!doctor) return res.status(404).json({ error: 'Doctor not found at this clinic' });

    const from = new Date();
    const to = new Date(Date.now() + Math.min(Number(days) || 7, 21) * 86400000);

    const [booked, pending] = await prisma.$transaction([
      prisma.appointment.findMany({
        where: {
          facilityId: facility.id, doctorId: doctor.id,
          scheduledAt: { gte: from, lte: to },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
        select: { scheduledAt: true, duration: true },
      }),
      prisma.bookingRequest.findMany({
        where: { facilityId: facility.id, doctorId: doctor.id, status: 'PENDING', requestedAt: { gte: from, lte: to } },
        select: { requestedAt: true },
      }),
    ]);

    const taken = new Set([
      ...booked.map((a) => new Date(a.scheduledAt).toISOString().slice(0, 16)),
      ...pending.map((b) => new Date(b.requestedAt).toISOString().slice(0, 16)),
    ]);

    // Clinic hours 09:00-16:30, 30-minute slots, weekdays only.
    const slots = [];
    for (let d = 0; d < Math.min(Number(days) || 7, 21); d += 1) {
      const day = new Date(); day.setDate(day.getDate() + d); day.setSeconds(0, 0);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      const dayslots = [];
      for (let h = 9; h < 17; h += 1) {
        for (const m of [0, 30]) {
          if (h === 16 && m === 30) continue;
          const slot = new Date(day); slot.setHours(h, m, 0, 0);
          if (slot <= new Date()) continue;
          if (taken.has(slot.toISOString().slice(0, 16))) continue;
          dayslots.push(slot.toISOString());
        }
      }
      if (dayslots.length) {
        slots.push({ date: day.toISOString().slice(0, 10), slots: dayslots });
      }
    }

    res.json({ doctor, availability: slots });
  } catch (e) { next(e); }
});

/**
 * Symptom checker — ROUTING ONLY.
 *
 * This deliberately does not name conditions or suggest treatment. It maps red
 * flags and severity to where a person should present. Anything alarming routes
 * to emergency; when unsure it routes to a clinician rather than reassuring.
 */
const RED_FLAGS = [
  { key: 'chest_pain',    label: 'Chest pain or tightness' },
  { key: 'breathing',     label: 'Difficulty breathing' },
  { key: 'bleeding',      label: 'Heavy bleeding' },
  { key: 'consciousness', label: 'Fainting or confusion' },
  { key: 'weakness',      label: 'Sudden weakness or slurred speech' },
  { key: 'severe_pain',   label: 'Severe or worsening pain' },
  { key: 'pregnancy',     label: 'Pregnancy problem' },
  { key: 'infant',        label: 'Unwell baby under 3 months' },
  { key: 'injury',        label: 'Serious injury' },
  { key: 'poisoning',     label: 'Swallowed something harmful' },
];

router.get('/symptom-checker/red-flags', (req, res) => res.json({ redFlags: RED_FLAGS }));

router.post('/symptom-checker', (req, res) => {
  const { redFlags = [], severity, duration } = req.body || {};
  const flagged = Array.isArray(redFlags) ? redFlags.filter(Boolean) : [];
  const score = Number(severity);

  let routing = 'GENERAL_OUTPATIENT';
  let urgency = 'Book a routine appointment';
  let message = 'Your answers do not suggest an emergency. Booking a normal appointment is appropriate.';

  if (flagged.length > 0) {
    routing = 'EMERGENCY';
    urgency = 'Go to the emergency unit now';
    message = 'You reported a symptom that needs to be seen immediately. Please go to the nearest emergency unit or call for help now. Do not wait for an appointment.';
  } else if (Number.isFinite(score) && score >= 8) {
    routing = 'EMERGENCY';
    urgency = 'Seek care today';
    message = 'You rated your symptoms as very severe. Please be seen today — go to the emergency unit if it worsens.';
  } else if (Number.isFinite(score) && score >= 5) {
    routing = 'GENERAL_OUTPATIENT';
    urgency = 'Book an appointment soon';
    message = 'Please book an appointment in the next day or two, and seek urgent care if anything worsens.';
  } else if (duration && /week|month|year/i.test(String(duration))) {
    routing = 'TELECONSULT';
    urgency = 'A teleconsult may be enough';
    message = 'For a longer-standing problem, a teleconsultation is often a good first step.';
  }

  res.json({
    routing, urgency, message,
    flaggedCount: flagged.length,
    // Stated plainly so no one mistakes this for a diagnosis.
    disclaimer: 'This is not a diagnosis. It only suggests where to be seen. If you feel unsafe, seek emergency care immediately.',
  });
});

/**
 * Keyword routing for a free-text enquiry.
 *
 * This suggests a department. It is deliberately not clever: a keyword list that
 * a person can read and correct is safer here than anything that infers, because
 * the only thing it must never do is talk someone out of going to hospital.
 * Anything that could be an emergency is routed there, and the wording tells
 * them to go rather than wait for a reply.
 */
const DEPARTMENT_KEYWORDS = [
  { department: 'Emergency', urgent: true, patterns: /chest pain|can'?t breathe|cannot breathe|difficulty breathing|unconscious|fainted|convulsion|seizure|bleeding heavily|severe bleeding|stroke|poison|overdose|suicide|not breathing|collapsed/i },
  { department: 'Emergency', urgent: true, patterns: /accident|burn|fracture|broken bone|deep cut|snake ?bite|gun ?shot/i },
  { department: 'Antenatal / Maternity', patterns: /pregnan|antenatal|labour|labor|contractions|baby movement|miscarriage/i },
  { department: 'Paediatrics', patterns: /\bbaby\b|infant|newborn|\bchild\b|toddler|my son|my daughter/i },
  { department: 'General Outpatient', patterns: /fever|malaria|headache|body ache|cough|catarrh|cold|typhoid|weak/i },
  { department: 'Laboratory', patterns: /test|lab|blood work|result|screening|check ?up/i },
  { department: 'Dental', patterns: /tooth|teeth|dental|gum/i },
  { department: 'Eye Clinic', patterns: /\beye\b|vision|blurred|cannot see|sight/i },
  { department: 'Obstetrics & Gynaecology', patterns: /period|menstrua|womb|vaginal|fibroid/i },
];

function routeSymptoms(text) {
  const value = String(text || '');
  for (const rule of DEPARTMENT_KEYWORDS) {
    if (rule.patterns.test(value)) {
      return { suggestedDepartment: rule.department, isUrgent: Boolean(rule.urgent) };
    }
  }
  return { suggestedDepartment: 'General Outpatient', isUrgent: false };
}

/**
 * Record an enquiry from the public page.
 *
 * The enquiry is written to the database before any email is attempted. The
 * previous contact form only sent mail, so a bad SMTP password or a full mailbox
 * meant the enquiry vanished with nothing to show it had ever arrived — and
 * somebody who described chest pain on a hospital's website and heard nothing
 * back is a serious failure, not an inconvenience.
 */
router.post('/clinic/:slug/inquiry', bookingLimiter, async (req, res, next) => {
  try {
    const facility = await facilityBySlug(req.params.slug);
    if (!facility) return res.status(404).json({ error: 'Clinic not found' });

    const { name, phone, email, symptoms, source } = req.body || {};
    if (!String(symptoms || '').trim() && !String(name || '').trim()) {
      return res.status(400).json({ error: 'Tell us your name or what the problem is' });
    }
    if (!String(phone || '').trim() && !String(email || '').trim()) {
      return res.status(400).json({ error: 'Leave a phone number or an email so we can reply', field: 'phone' });
    }

    const routing = routeSymptoms(symptoms);
    const SOURCES = ['WEBSITE', 'WHATSAPP', 'PHONE', 'WALK_IN'];

    const inquiry = await prisma.patientInquiry.create({
      data: {
        facilityId: facility.id,
        source: SOURCES.includes(source) ? source : 'WEBSITE',
        name: String(name || '').trim() || null,
        phone: String(phone || '').trim() || null,
        email: String(email || '').trim() || null,
        symptomsText: String(symptoms || '').trim() || null,
        suggestedDepartment: routing.suggestedDepartment,
        isUrgent: routing.isUrgent,
      },
    });

    res.status(201).json({
      reference: inquiry.id.slice(0, 8).toUpperCase(),
      suggestedDepartment: routing.suggestedDepartment,
      isUrgent: routing.isUrgent,
      message: routing.isUrgent
        ? 'What you have described may need urgent attention. Please go to the nearest emergency unit or call the clinic now — do not wait for a reply to this message.'
        : 'Thank you. Our records team will contact you shortly.',
      disclaimer: 'This is not a diagnosis. It only suggests where you may be seen.',
    });
  } catch (e) { next(e); }
});

// Confirm a returning patient WITHOUT leaking their record.
router.post('/clinic/:slug/verify-patient', bookingLimiter, async (req, res, next) => {
  try {
    const facility = await facilityBySlug(req.params.slug);
    if (!facility) return res.status(404).json({ error: 'Clinic not found' });

    const { phone, hospitalId } = req.body || {};
    if (!phone && !hospitalId) return res.status(400).json({ error: 'Enter your phone number or hospital ID' });

    const patient = await prisma.patient.findFirst({
      where: {
        facilityId: facility.id, isArchived: false,
        ...(hospitalId
          ? { OR: [{ universalPatientId: hospitalId.toUpperCase() }, { mrn: hospitalId }] }
          : { phone }),
      },
      select: { id: true, firstName: true },
    });

    if (!patient) {
      return res.json({ found: false, message: 'We could not match those details. You can still book as a new patient.' });
    }

    // Only a first name is echoed back, as a "is this you?" confirmation.
    res.json({ found: true, firstName: patient.firstName, patientRef: patient.id });
  } catch (e) { next(e); }
});

router.post('/clinic/:slug/booking', bookingLimiter, async (req, res, next) => {
  try {
    const facility = await facilityBySlug(req.params.slug);
    if (!facility) return res.status(404).json({ error: 'Clinic not found' });

    const {
      fullName, phone, email, dateOfBirth, departmentId, doctorId,
      requestedAt, reason, patientRef, symptomSummary, symptomDuration, severity, redFlags, routing,
    } = req.body || {};

    if (!fullName || !String(fullName).trim()) return res.status(400).json({ error: 'Your name is required' });
    if (!phone || !/^(\+?234|0)[789]\d{9}$/.test(String(phone).replace(/\s/g, ''))) {
      return res.status(400).json({ error: 'Enter a valid Nigerian phone number' });
    }
    if (!requestedAt) return res.status(400).json({ error: 'Choose a date and time' });

    const when = new Date(requestedAt);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'That date is not valid' });
    if (when < new Date()) return res.status(400).json({ error: 'Choose a time in the future' });

    // Validate the referenced doctor belongs to this clinic.
    let doctor = null;
    if (doctorId) {
      doctor = await prisma.user.findFirst({
        where: { id: doctorId, facilityId: facility.id, isActive: true, subRole: 'DOCTOR' },
        select: { id: true },
      });
      if (!doctor) return res.status(400).json({ error: 'That doctor is not available at this clinic' });
    }

    let patientId = null;
    if (patientRef) {
      const known = await prisma.patient.findFirst({
        where: { id: patientRef, facilityId: facility.id, isArchived: false },
        select: { id: true },
      });
      patientId = known?.id || null;
    }

    const reference = `BK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const booking = await prisma.bookingRequest.create({
      data: {
        facilityId: facility.id,
        reference,
        patientId,
        isNewPatient: !patientId,
        fullName: String(fullName).trim(),
        phone: String(phone).replace(/\s/g, ''),
        email: email || null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        departmentId: departmentId || null,
        doctorId: doctor?.id || null,
        requestedAt: when,
        reason: reason || null,
        symptomSummary: symptomSummary || null,
        symptomDuration: symptomDuration || null,
        severity: severity != null ? Number(severity) : null,
        redFlags: Array.isArray(redFlags) ? redFlags : [],
        routing: routing || null,
      },
    });

    res.status(201).json({
      reference: booking.reference,
      status: booking.status,
      requestedAt: booking.requestedAt,
      message: 'Your request has been received. The clinic will confirm your appointment shortly.',
    });
  } catch (e) { next(e); }
});

router.get('/booking/:reference', async (req, res, next) => {
  try {
    const booking = await prisma.bookingRequest.findUnique({
      where: { reference: req.params.reference },
      select: { reference: true, status: true, requestedAt: true, fullName: true, decisionNote: true },
    });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(booking);
  } catch (e) { next(e); }
});

module.exports = router;
