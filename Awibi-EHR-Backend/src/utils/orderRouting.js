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

module.exports = { inferMonitoringType };
