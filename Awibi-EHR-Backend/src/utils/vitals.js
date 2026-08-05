const RULES = {
  bloodPressureSystolic: [50, 300, 'systolic blood pressure'],
  bloodPressureDiastolic: [30, 200, 'diastolic blood pressure'],
  heartRate: [20, 250, 'heart rate'],
  respiratoryRate: [5, 80, 'respiratory rate'],
  temperature: [25, 45, 'temperature'],
  oxygenSaturation: [50, 100, 'oxygen saturation'],
  height: [30, 250, 'height'],
  weight: [0.5, 500, 'weight'],
  bloodGlucose: [10, 1000, 'blood glucose'],
};

function normalizeVitals(input) {
  const values = {};
  for (const [field, [min, max, label]] of Object.entries(RULES)) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === '') {
      values[field] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw Object.assign(new Error(`${label} must be between ${min} and ${max}`), { status: 400 });
    }
    values[field] = value;
  }

  if (values.bloodPressureSystolic !== null && values.bloodPressureDiastolic !== null
    && values.bloodPressureDiastolic >= values.bloodPressureSystolic) {
    throw Object.assign(new Error('diastolic blood pressure must be lower than systolic blood pressure'), { status: 400 });
  }

  values.bmi = values.height !== null && values.weight !== null
    ? Number((values.weight / ((values.height / 100) ** 2)).toFixed(1))
    : null;
  return values;
}

module.exports = { normalizeVitals };
