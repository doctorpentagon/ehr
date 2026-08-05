// Built-in monitoring templates.
//
// A sheet COPIES the field definitions it needs at creation time, so editing a
// template here never rewrites the shape of sheets already in progress. Anything
// not covered here is created as type CUSTOM with caller-supplied fields, so a
// ward can document something we never anticipated without a migration.
//
// kind: 'number' | 'text' | 'select' | 'boolean'
//
// Numeric fields may also carry a goal band and a critical band:
//   goalMin / goalMax          inside this is normal
//   criticalLow / criticalHigh outside this needs a doctor now, not at the next round
// Categorical fields may carry `normalOptions` — the values that are not a concern.
//
// The two bands exist because "abnormal" is not one thing. A blood glucose of 190
// is worth noting at the next check; 60 is worth waking someone for. Colour coding
// and alerting both read these, so ward and dashboard never disagree.

const MONITORING_TEMPLATES = [
  {
    type: 'URINARY_CATHETER',
    label: 'Urinary catheter output',
    targetUnit: 'ml',
    frequencyMins: 240,
    tracksOutput: true,
    fields: [
      { key: 'volumeMl', label: 'Urine volume', unit: 'ml', kind: 'number', required: true, mapsTo: 'outputMl' },
      { key: 'colour', label: 'Colour', kind: 'select', options: ['Clear', 'Straw', 'Amber', 'Dark', 'Blood-stained'] },
      { key: 'catheterSize', label: 'Catheter size (Fr)', kind: 'text' },
      { key: 'siteClean', label: 'Site clean and intact', kind: 'boolean' },
    ],
  },
  {
    type: 'NGT_FEEDING',
    label: 'NGT feeding',
    targetUnit: 'ml',
    frequencyMins: 240,
    tracksIntake: true,
    fields: [
      { key: 'feedType', label: 'Feed type', kind: 'text' },
      { key: 'volumeMl', label: 'Volume given', unit: 'ml', kind: 'number', required: true, mapsTo: 'intakeMl' },
      { key: 'aspirateMl', label: 'Aspirate', unit: 'ml', kind: 'number' },
      { key: 'tubePositionChecked', label: 'Tube position checked', kind: 'boolean', required: true },
      { key: 'tolerated', label: 'Tolerated', kind: 'select', options: ['Yes', 'Vomiting', 'Distension', 'Refused'] },
    ],
  },
  {
    type: 'SURGICAL_DRAIN',
    label: 'Surgical drain',
    targetUnit: 'ml',
    frequencyMins: 480,
    tracksOutput: true,
    fields: [
      { key: 'drainSite', label: 'Drain site', kind: 'text', required: true },
      { key: 'volumeMl', label: 'Drainage volume', unit: 'ml', kind: 'number', required: true, mapsTo: 'outputMl' },
      { key: 'character', label: 'Character', kind: 'select', options: ['Serous', 'Serosanguinous', 'Sanguinous', 'Purulent', 'Bilious'] },
      { key: 'siteCondition', label: 'Site condition', kind: 'text' },
    ],
  },
  {
    type: 'IV_FLUID',
    label: 'IV fluid / infusion',
    targetUnit: 'ml',
    frequencyMins: 60,
    tracksIntake: true,
    fields: [
      { key: 'fluidType', label: 'Fluid', kind: 'select', required: true,
        options: ['0.9% Normal Saline', '5% Dextrose', 'Dextrose Saline', "Ringer's Lactate", 'Darrow’s', 'Other'] },
      { key: 'volumeMl', label: 'Volume infused', unit: 'ml', kind: 'number', required: true, mapsTo: 'intakeMl' },
      { key: 'rateMlHr', label: 'Rate', unit: 'ml/hr', kind: 'number' },
      { key: 'cannulaSite', label: 'Cannula site', kind: 'text' },
      { key: 'siteReaction', label: 'Site reaction', kind: 'select', options: ['None', 'Redness', 'Swelling', 'Phlebitis', 'Extravasation'] },
    ],
  },
  {
    type: 'BLOOD_TRANSFUSION',
    label: 'Blood transfusion',
    targetUnit: 'ml',
    // 15-minute observations are the safety-critical part of transfusion care.
    frequencyMins: 15,
    tracksIntake: true,
    fields: [
      { key: 'unitNumber', label: 'Blood unit number', kind: 'text', required: true },
      { key: 'bloodGroup', label: 'Blood group', kind: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      { key: 'component', label: 'Component', kind: 'select', options: ['Whole blood', 'Packed cells', 'Platelets', 'FFP', 'Cryoprecipitate'] },
      { key: 'volumeMl', label: 'Volume transfused', unit: 'ml', kind: 'number', mapsTo: 'intakeMl' },
      // A rising temperature or pulse during transfusion is the first sign of a
      // reaction, which is why these are observed every 15 minutes.
      { key: 'temperature', label: 'Temperature', unit: '°C', kind: 'number', required: true,
        goalMin: 36.1, goalMax: 37.5, criticalHigh: 38.5 },
      { key: 'pulse', label: 'Pulse', unit: 'bpm', kind: 'number', required: true,
        goalMin: 60, goalMax: 100, criticalLow: 40, criticalHigh: 130 },
      { key: 'bloodPressure', label: 'Blood pressure', unit: 'mmHg', kind: 'text', required: true },
      { key: 'reaction', label: 'Transfusion reaction', kind: 'select', required: true,
        options: ['None', 'Fever', 'Rigors', 'Rash', 'Dyspnoea', 'Hypotension', 'STOPPED - reaction'],
        normalOptions: ['None'] },
    ],
  },
  {
    type: 'WOUND_CARE',
    label: 'Wound care',
    frequencyMins: 1440,
    fields: [
      { key: 'site', label: 'Wound site', kind: 'text', required: true },
      { key: 'appearance', label: 'Appearance', kind: 'select', options: ['Healthy/granulating', 'Sloughy', 'Necrotic', 'Infected', 'Epithelialising'] },
      { key: 'exudate', label: 'Exudate', kind: 'select', options: ['None', 'Scant', 'Moderate', 'Heavy'] },
      { key: 'dressingUsed', label: 'Dressing used', kind: 'text' },
      { key: 'painScore', label: 'Pain score (0-10)', kind: 'number' },
    ],
  },
  {
    type: 'NEURO_OBSERVATION',
    label: 'Neurological observation',
    frequencyMins: 60,
    fields: [
      { key: 'eyeOpening', label: 'Eye opening (1-4)', kind: 'number', required: true },
      { key: 'verbalResponse', label: 'Verbal response (1-5)', kind: 'number', required: true },
      { key: 'motorResponse', label: 'Motor response (1-6)', kind: 'number', required: true },
      // 8 or below is the threshold at which the airway is at risk.
      { key: 'gcsTotal', label: 'GCS total', kind: 'number', goalMin: 15, goalMax: 15, criticalLow: 8 },
      { key: 'pupilLeft', label: 'Pupil L', kind: 'text' },
      { key: 'pupilRight', label: 'Pupil R', kind: 'text' },
    ],
  },
  {
    type: 'SEIZURE_WATCH',
    label: 'Seizure watch',
    frequencyMins: 60,
    fields: [
      { key: 'seizureOccurred', label: 'Seizure occurred', kind: 'boolean', required: true },
      { key: 'durationSec', label: 'Duration', unit: 'seconds', kind: 'number' },
      { key: 'seizureType', label: 'Type', kind: 'select', options: ['Generalised tonic-clonic', 'Focal', 'Absence', 'Myoclonic', 'Other'] },
      { key: 'postIctalState', label: 'Post-ictal state', kind: 'text' },
    ],
  },
  {
    type: 'BGL_INSULIN',
    label: 'Blood glucose & insulin',
    targetUnit: 'mg/dL',
    // Before each meal and at bedtime.
    frequencyMins: 360,
    fields: [
      // Below 70 is hypoglycaemia and needs treating before anything else;
      // above 250 risks ketoacidosis. Both mean "find someone now".
      { key: 'bgl', label: 'Blood glucose', unit: 'mg/dL', kind: 'number', required: true,
        goalMin: 80, goalMax: 180, criticalLow: 70, criticalHigh: 250,
        notes: 'Check before meals and at bedtime' },
      { key: 'insulinGiven', label: 'Insulin given', unit: 'units', kind: 'number' },
      { key: 'insulinRoute', label: 'Route', kind: 'select', options: ['SC', 'IV', 'IM'] },
      { key: 'hypoTreatment', label: 'Hypoglycaemia treatment', kind: 'text',
        notes: 'e.g. 15 g oral glucose, or 25 mL 50% dextrose IV' },
      { key: 'urineKetones', label: 'Urine ketones', kind: 'select',
        options: ['Negative', 'Trace', '+', '++', '+++'], normalOptions: ['Negative', 'Trace'] },
    ],
  },
  {
    type: 'VITALS',
    label: 'Vital signs chart',
    frequencyMins: 240,
    fields: [
      { key: 'systolic', label: 'BP systolic', unit: 'mmHg', kind: 'number', required: true,
        goalMin: 90, goalMax: 140, criticalLow: 80, criticalHigh: 180 },
      { key: 'diastolic', label: 'BP diastolic', unit: 'mmHg', kind: 'number', required: true,
        goalMin: 60, goalMax: 90, criticalLow: 50, criticalHigh: 110 },
      { key: 'pulse', label: 'Pulse', unit: 'bpm', kind: 'number', required: true,
        goalMin: 60, goalMax: 100, criticalLow: 40, criticalHigh: 130 },
      { key: 'respiratoryRate', label: 'Respiratory rate', unit: '/min', kind: 'number',
        goalMin: 12, goalMax: 20, criticalLow: 8, criticalHigh: 30 },
      { key: 'temperature', label: 'Temperature', unit: '°C', kind: 'number',
        goalMin: 36.1, goalMax: 37.5, criticalLow: 35, criticalHigh: 39.5 },
      // Saturation only has a floor worth alarming on. 90% and below is hypoxia.
      { key: 'spo2', label: 'SpO2', unit: '%', kind: 'number', required: true,
        goalMin: 95, goalMax: 100, criticalLow: 90,
        notes: 'Record on room air unless oxygen is running — note FiO2 in the comment' },
      { key: 'oxygenSupport', label: 'Oxygen support', kind: 'select',
        options: ['Room air', 'Nasal prongs', 'Face mask', 'Non-rebreather', 'CPAP', 'Ventilated'],
        normalOptions: ['Room air'] },
      { key: 'painScore', label: 'Pain score (0-10)', kind: 'number', goalMin: 0, goalMax: 3, criticalHigh: 8 },
    ],
  },
  {
    type: 'INTAKE_OUTPUT',
    label: 'Intake & output',
    targetUnit: 'ml',
    frequencyMins: 60,
    tracksIntake: true,
    tracksOutput: true,
    fields: [
      { key: 'oralIntakeMl', label: 'Oral intake', unit: 'ml', kind: 'number', mapsTo: 'intakeMl' },
      { key: 'ivIntakeMl', label: 'IV intake', unit: 'ml', kind: 'number' },
      { key: 'urineOutputMl', label: 'Urine output', unit: 'ml', kind: 'number', mapsTo: 'outputMl' },
      { key: 'otherOutputMl', label: 'Other output (vomit, drain, stool)', unit: 'ml', kind: 'number' },
      { key: 'otherOutputSource', label: 'Other output source', kind: 'text' },
    ],
  },
];

function templateFor(type) {
  return MONITORING_TEMPLATES.find((t) => t.type === type) || null;
}

/**
 * Severity of a reading relative to its bands.
 *
 * Two levels of abnormal, not one: "note this" and "act on this now". Collapsing
 * them means either the ward is alarmed constantly and stops looking, or a
 * genuine emergency is styled the same as a mildly raised value.
 */
const SEVERITY = {
  NORMAL: 'NORMAL',
  LOW: 'LOW',
  HIGH: 'HIGH',
  CRITICAL_LOW: 'CRITICAL_LOW',
  CRITICAL_HIGH: 'CRITICAL_HIGH',
};

function round(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * How far one value sits outside its goal band, and how much that matters.
 * Returns null when the field carries no bands — most free text has no notion
 * of deviation, and inventing one would colour the chart meaninglessly.
 */
function deviationFor(field, rawValue) {
  if (!field) return null;
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;

  // Categorical fields: "normal" is membership of a named set, not a distance.
  if (Array.isArray(field.normalOptions) && field.normalOptions.length > 0) {
    const isNormal = field.normalOptions.includes(String(rawValue));
    return { deviation: 0, severity: isNormal ? SEVERITY.NORMAL : SEVERITY.HIGH, isCritical: false };
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;

  const { goalMin, goalMax, criticalLow, criticalHigh } = field;
  if ([goalMin, goalMax, criticalLow, criticalHigh].every((b) => b === undefined)) return null;

  // Critical bands are tested first. If the two bands were ever configured
  // inconsistently, the safe reading of an ambiguous value is the alarming one.
  if (criticalLow !== undefined && value <= criticalLow) {
    return { deviation: round((goalMin ?? criticalLow) - value), severity: SEVERITY.CRITICAL_LOW, isCritical: true };
  }
  if (criticalHigh !== undefined && value >= criticalHigh) {
    return { deviation: round(value - (goalMax ?? criticalHigh)), severity: SEVERITY.CRITICAL_HIGH, isCritical: true };
  }
  if (goalMin !== undefined && value < goalMin) {
    return { deviation: round(goalMin - value), severity: SEVERITY.LOW, isCritical: false };
  }
  if (goalMax !== undefined && value > goalMax) {
    return { deviation: round(value - goalMax), severity: SEVERITY.HIGH, isCritical: false };
  }
  return { deviation: 0, severity: SEVERITY.NORMAL, isCritical: false };
}

/**
 * Deviations for every value in one entry, computed once on the server so the
 * grid colour, the chart band and the alert all cite the same number.
 */
function computeDeviations(fields, values) {
  const byKey = new Map((Array.isArray(fields) ? fields : []).map((f) => [f.key, f]));
  const deviations = {};
  let isAbnormal = false;
  let isCritical = false;
  const criticalKeys = [];

  for (const [key, raw] of Object.entries(values || {})) {
    const result = deviationFor(byKey.get(key), raw);
    if (!result) continue;
    deviations[key] = result;
    if (result.severity !== SEVERITY.NORMAL) isAbnormal = true;
    if (result.isCritical) { isCritical = true; criticalKeys.push(byKey.get(key)?.label || key); }
  }
  return { deviations, isAbnormal, isCritical, criticalKeys };
}

/**
 * Insulin sliding scale.
 *
 * Produces a suggestion shown to a clinician — never an order, never an
 * administration. It exists so a nurse at 3am is not doing arithmetic from
 * memory, and it is deliberately conservative. A facility that uses a different
 * scale should override this rather than work around it.
 */
const SLIDING_SCALE = [
  { min: -Infinity, max: 69, units: 0, advice: 'HYPOGLYCAEMIA — treat immediately. Do not give insulin.' },
  { min: 70, max: 180, units: 0, advice: 'Within target — no correction dose.' },
  { min: 181, max: 220, units: 2, advice: 'Consider 2 units regular insulin SC.' },
  { min: 221, max: 260, units: 4, advice: 'Consider 4 units regular insulin SC.' },
  { min: 261, max: 300, units: 6, advice: 'Consider 6 units regular insulin SC.' },
  { min: 301, max: 350, units: 8, advice: 'Consider 8 units regular insulin SC.' },
  { min: 351, max: 400, units: 10, advice: 'Consider 10 units regular insulin SC.' },
  { min: 401, max: Infinity, units: 12, advice: 'Consider 12 units regular insulin SC and inform the doctor.' },
];

function slidingScaleFor(bgl) {
  const value = Number(bgl);
  if (!Number.isFinite(value)) return null;
  const band = SLIDING_SCALE.find((b) => value >= b.min && value <= b.max);
  if (!band) return null;
  return {
    bgl: value,
    suggestedUnits: band.units,
    advice: band.advice,
    route: 'SC',
    // Said plainly because a suggestion that looks like an instruction will
    // eventually be followed as one.
    isSuggestionOnly: true,
    disclaimer: 'Suggestion only — confirm against the patient’s prescribed scale before giving.',
  };
}

/**
 * IV bag arithmetic.
 *
 * Remaining volume is derived, not typed: a nurse who has just recorded what
 * went in should not also have to subtract, and a slip in that subtraction is
 * how a bag runs dry unnoticed.
 */
function ivFluidStatus({ bagSizeMl, totalInfusedMl, rateOrdered, rateActual }) {
  const warnings = [];
  const bag = Number(bagSizeMl);
  const infused = Number(totalInfusedMl) || 0;
  const volumeRemaining = Number.isFinite(bag) ? round(Math.max(0, bag - infused)) : null;

  if (volumeRemaining !== null && volumeRemaining < 50) {
    warnings.push({
      code: 'BAG_CHANGE_DUE',
      severity: 'WARNING',
      message: `Only ${volumeRemaining} ml remaining — prepare the next bag`,
    });
  }

  const ordered = Number(rateOrdered);
  const actual = Number(rateActual);
  if (Number.isFinite(ordered) && Number.isFinite(actual) && ordered > 0) {
    const driftPercent = round((Math.abs(actual - ordered) / ordered) * 100);
    if (driftPercent > 25) {
      warnings.push({
        code: 'RATE_DEVIATION_CRITICAL', severity: 'CRITICAL',
        message: `Running at ${actual} ml/hr against an ordered ${ordered} ml/hr — ${driftPercent}% off`,
      });
    } else if (driftPercent > 10) {
      warnings.push({
        code: 'RATE_DEVIATION', severity: 'WARNING',
        message: `Running at ${actual} ml/hr against an ordered ${ordered} ml/hr — ${driftPercent}% off`,
      });
    }
  }
  return { volumeRemaining, warnings };
}

module.exports = {
  MONITORING_TEMPLATES, templateFor,
  SEVERITY, SLIDING_SCALE,
  deviationFor, computeDeviations, slidingScaleFor, ivFluidStatus,
};
