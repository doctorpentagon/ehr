/**
 * Registration validation and safe MRN allocation.
 *
 * These rules exist because the front desk is the point where bad data enters
 * the record and becomes permanent. Everything here is deliberately strict about
 * identity and lenient about everything else.
 */

/**
 * Nigerian mobile numbers.
 *
 * Accepts the three forms staff actually type:
 *   0803 123 4567     (local)
 *   +234 803 123 4567 (international)
 *   234 803 123 4567  (international, no plus)
 *
 * The national significant number is 10 digits beginning 7, 8 or 9. Spaces and
 * dashes are tolerated on input and stripped before storage, because a receptionist
 * typing a number off a scrap of paper should not be fought by the form.
 */
const NIGERIAN_MOBILE = /^(?:\+?234|0)([789]\d{9})$/;

function normalisePhone(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: null };
  const cleaned = String(raw).replace(/[\s()-]/g, '');
  const match = NIGERIAN_MOBILE.exec(cleaned);
  if (!match) {
    return {
      ok: false,
      error: 'Enter a valid Nigerian phone number, for example 08031234567 or +2348031234567',
    };
  }
  // Store one canonical shape so search and duplicate detection actually work.
  return { ok: true, value: `0${match[1]}` };
}

/**
 * A date of birth in the future is always a typo, and it silently poisons
 * everything downstream: age becomes negative, the paediatric guardian block
 * never appears, and growth Z-scores are computed against a nonsense age.
 */
function validateDateOfBirth(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: null };
  const dob = new Date(raw);
  if (Number.isNaN(dob.getTime())) return { ok: false, error: 'Date of birth is not a valid date' };

  const now = new Date();
  if (dob > now) return { ok: false, error: 'Date of birth cannot be in the future' };

  const oldest = new Date();
  oldest.setFullYear(oldest.getFullYear() - 120);
  if (dob < oldest) return { ok: false, error: 'Date of birth is more than 120 years ago — please check it' };

  return { ok: true, value: dob };
}

/** Whole years, floored. Null when the date of birth is unknown. */
function ageInYears(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

/**
 * The hospital number format for a facility.
 *
 * Every hospital has a house style — LUTH-26-001234, UCH/001234, GHO-1000 — and
 * a number that does not look like the one on the paper folder will not be
 * trusted or quoted. Defaults reproduce the original PAT-001 shape so existing
 * facilities see no change until somebody deliberately configures one.
 */
const HOSP_NO_DEFAULTS = {
  prefix: 'PAT',
  includeYear: false,
  padding: 3,
  start: 1,
  separator: '-',
};

function hospNoConfig(facility = {}) {
  return {
    prefix: (facility.hospNoPrefix || HOSP_NO_DEFAULTS.prefix).toUpperCase(),
    includeYear: facility.hospNoIncludeYear ?? HOSP_NO_DEFAULTS.includeYear,
    padding: facility.hospNoPadding ?? HOSP_NO_DEFAULTS.padding,
    start: facility.hospNoStart ?? HOSP_NO_DEFAULTS.start,
    separator: facility.hospNoSeparator ?? HOSP_NO_DEFAULTS.separator,
  };
}

/** Two-digit year, as hospitals write it on a folder: 26, not 2026. */
function yearSegment(date = new Date()) {
  return String(date.getFullYear()).slice(-2);
}

/** The fixed part that every number for this facility and year begins with. */
function hospNoStem(config, date = new Date()) {
  const { prefix, includeYear, separator } = config;
  return includeYear ? `${prefix}${separator}${yearSegment(date)}${separator}` : `${prefix}${separator}`;
}

function formatHospNo(config, sequence, date = new Date()) {
  return `${hospNoStem(config, date)}${String(sequence).padStart(config.padding, '0')}`;
}

/**
 * Allocate the next MRN for a facility.
 *
 * The previous implementation used `count + 1`, which produced duplicate MRNs in
 * two ordinary situations: two receptionists registering at the same moment both
 * read the same count, and any deletion made the count fall so the next
 * registration reused a number already on a chart. A duplicate MRN means two
 * different people share the identifier staff use to pull a record.
 *
 * This reads the highest number actually issued rather than counting rows, so a
 * deletion can never cause reuse, and the caller retries on the unique
 * constraint to close the concurrent-insert race.
 */
async function nextMrn(prisma, facilityId, configOrPrefix) {
  // Accept a facility record, a config object, or a bare prefix string, so
  // existing callers keep working while new ones can pass the facility's format.
  const config = typeof configOrPrefix === 'string'
    ? hospNoConfig({ hospNoPrefix: configOrPrefix })
    : hospNoConfig(configOrPrefix || {});

  const stem = hospNoStem(config);

  const latest = await prisma.patient.findMany({
    where: { facilityId, mrn: { startsWith: stem } },
    select: { mrn: true },
    orderBy: { mrn: 'desc' },
    take: 50,
  });

  // The sequence restarts each year when the year is part of the number —
  // that is the point of putting it there, and matching on the full stem
  // (prefix + year) gives that for free.
  let highest = config.start - 1;
  for (const { mrn } of latest) {
    const n = Number.parseInt(String(mrn).slice(stem.length), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return formatHospNo(config, highest + 1);
}

/**
 * Create a patient with the next MRN.
 *
 * Allocation is serialised per facility with a Postgres advisory lock rather
 * than allocating optimistically and retrying on collision. Retrying looks
 * like it works but degrades exactly when it matters: every concurrent
 * registration reads the same highest number, only one wins each round, so a
 * rush at the front desk needs as many rounds as there are receptionists and
 * the ones at the back are turned away. Serialising costs a few milliseconds
 * and always succeeds.
 *
 * The lock is transaction-scoped, so it is released on commit or rollback and
 * cannot be leaked by a crash. The key is derived from the facility, so two
 * hospitals never wait on each other. `@@unique([facilityId, mrn])` remains as
 * the last line of defence.
 */
async function createPatientWithMrn(prisma, facilityId, data, configOrPrefix) {
  return prisma.$transaction(async (tx) => {
    // Read the facility's own number format unless the caller supplied one.
    const config = configOrPrefix || await tx.facility.findUnique({
      where: { id: facilityId },
      select: {
        hospNoPrefix: true, hospNoIncludeYear: true,
        hospNoPadding: true, hospNoStart: true, hospNoSeparator: true,
      },
    });
    const mrn = await allocateMrn(tx, facilityId, config);
    return tx.patient.create({ data: { ...data, facilityId, mrn } });
  }, { timeout: 15000 });
}

/**
 * Allocate an MRN inside a transaction the caller already owns.
 *
 * Some patients are created as part of a larger piece of work — confirming an
 * online booking, for instance — and those are still real patients who will walk
 * into the clinic. They were previously created without an MRN, so reception
 * could not pull their chart by the number the patient was quoting. Any path
 * that creates a permanent patient should use this.
 */
async function allocateMrn(tx, facilityId, configOrPrefix) {
  const config = configOrPrefix || await tx.facility.findUnique({
    where: { id: facilityId },
    select: {
      hospNoPrefix: true, hospNoIncludeYear: true,
      hospNoPadding: true, hospNoStart: true, hospNoSeparator: true,
    },
  });
  // Lock on the facility alone, not on the format: changing the prefix must not
  // let two registrations allocate at the same moment under different keys.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mrn:${facilityId}`}))`;
  return nextMrn(tx, facilityId, config);
}

module.exports = {
  NIGERIAN_MOBILE,
  normalisePhone,
  validateDateOfBirth,
  ageInYears,
  nextMrn,
  allocateMrn,
  createPatientWithMrn,
  hospNoConfig,
  formatHospNo,
  hospNoStem,
  HOSP_NO_DEFAULTS,
};
