import whoBmiReference from '../data/whoBmiReference.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WHO_MONTH_DAYS = 30.4375;
const UNDER_FIVE_LAST_DAY = 1856;

function asFiniteNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function bmiFromCentimetres(weightKg, heightCm) {
  const weight = asFiniteNumber(weightKg);
  const height = asFiniteNumber(heightCm);
  if (weight == null || height == null || weight <= 0 || height <= 0) return null;
  return weight / ((height / 100) ** 2);
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return utc;
}

function valueAtZ([, l, m, s], z) {
  if (l === 0) return m * Math.exp(s * z);
  return m * ((1 + (l * s * z)) ** (1 / l));
}

/** WHO LMS calculation with the official linear tail adjustment beyond ±3 SD. */
export function whoLmsZScore(value, row) {
  if (!Array.isArray(row) || row.length < 4 || !Number.isFinite(value) || value <= 0) return null;
  const [, l, m, s] = row;
  if (![l, m, s].every(Number.isFinite) || m <= 0 || s <= 0) return null;

  const raw = l === 0
    ? Math.log(value / m) / s
    : (((value / m) ** l) - 1) / (l * s);

  if (raw > 3) {
    const sd2 = valueAtZ(row, 2);
    const sd3 = valueAtZ(row, 3);
    return 3 + ((value - sd3) / (sd3 - sd2));
  }
  if (raw < -3) {
    const sdNeg2 = valueAtZ(row, -2);
    const sdNeg3 = valueAtZ(row, -3);
    return -3 + ((value - sdNeg3) / (sdNeg2 - sdNeg3));
  }
  return raw;
}

function erf(value) {
  // Abramowitz and Stegun 7.1.26; maximum error is about 1.5 × 10⁻⁷.
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + (0.3275911 * x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x ** 2));
  return sign * y;
}

export function percentileFromZ(zScore) {
  if (!Number.isFinite(zScore)) return null;
  return 50 * (1 + erf(zScore / Math.SQRT2));
}

export function formatWhoPercentile(zScore) {
  if (!Number.isFinite(zScore)) return null;
  // WHO does not derive centiles beyond ±3 SD; show the corresponding bound.
  if (zScore <= -3) return 'Below the 0.14th percentile';
  if (zScore >= 3) return 'Above the 99.86th percentile';
  const percentile = percentileFromZ(zScore);
  const decimals = percentile < 1 || percentile > 99 ? 2 : 1;
  return `${percentile.toFixed(decimals)}th percentile`;
}

export function classifyWhoBmi(zScore, referenceGroup) {
  if (!Number.isFinite(zScore)) return null;

  if (referenceGroup === 'WHO_2006_0_5') {
    if (zScore < -3) return { label: 'Very low BMI-for-age', tone: 'danger' };
    if (zScore < -2) return { label: 'Low BMI-for-age', tone: 'warning' };
    if (zScore <= 1) return { label: 'Expected BMI-for-age range', tone: 'normal' };
    if (zScore <= 2) return { label: 'At risk of overweight', tone: 'warning' };
    if (zScore <= 3) return { label: 'Overweight', tone: 'danger' };
    return { label: 'Obesity', tone: 'danger' };
  }

  if (zScore < -3) return { label: 'Severe thinness', tone: 'danger' };
  if (zScore < -2) return { label: 'Thinness', tone: 'warning' };
  if (zScore <= 1) return { label: 'Expected BMI-for-age range', tone: 'normal' };
  if (zScore <= 2) return { label: 'Overweight', tone: 'warning' };
  return { label: 'Obesity', tone: 'danger' };
}

function referenceRow(sex, ageDays) {
  const key = sex === 'female' ? 'female' : sex === 'male' ? 'male' : null;
  if (!key) return null;

  if (ageDays <= UNDER_FIVE_LAST_DAY) {
    return {
      row: whoBmiReference.underFive[key][ageDays],
      referenceGroup: 'WHO_2006_0_5',
      ageKey: ageDays,
      ageUnit: 'day',
    };
  }

  const ageMonths = Math.floor(ageDays / WHO_MONTH_DAYS);
  if (ageMonths < 61 || ageMonths > 228) return null;
  return {
    row: whoBmiReference.fiveToNineteen[key][ageMonths - 61],
    referenceGroup: 'WHO_2007_5_19',
    ageKey: ageMonths,
    ageUnit: 'month',
  };
}

function adjustedHeight(heightCm, ageDays, measurementMethod) {
  if (ageDays > UNDER_FIVE_LAST_DAY || measurementMethod === 'age_appropriate' || !measurementMethod) {
    return { heightCm, adjustmentCm: 0, note: null };
  }
  if (ageDays < 730 && measurementMethod === 'standing') {
    return {
      heightCm: heightCm + 0.7,
      adjustmentCm: 0.7,
      note: 'Added 0.7 cm because WHO uses recumbent length below age 2.',
    };
  }
  if (ageDays >= 730 && measurementMethod === 'lying') {
    return {
      heightCm: heightCm - 0.7,
      adjustmentCm: -0.7,
      note: 'Subtracted 0.7 cm because WHO uses standing height from age 2.',
    };
  }
  return { heightCm, adjustmentCm: 0, note: null };
}

export function calculatePediatricBmi({
  weightKg,
  heightCm,
  sex,
  birthDate,
  measurementDate,
  measurementMethod = 'age_appropriate',
}) {
  const weight = asFiniteNumber(weightKg);
  const height = asFiniteNumber(heightCm);
  const born = parseIsoDate(birthDate);
  const measured = parseIsoDate(measurementDate);
  const problems = [];

  if (weight == null || weight < 1 || weight > 300) problems.push('Enter a weight from 1 to 300 kg.');
  if (height == null || height < 30 || height > 250) problems.push('Enter height or length from 30 to 250 cm.');
  if (!['female', 'male'].includes(sex)) problems.push('Choose the WHO female or male reference.');
  if (born == null) problems.push('Enter a valid date of birth.');
  if (measured == null) problems.push('Enter a valid measurement date.');
  if (born != null && measured != null && measured < born) problems.push('Measurement date cannot be before date of birth.');
  if (problems.length) return { ok: false, problems };

  const ageDays = Math.floor((measured - born) / DAY_MS);
  const reference = referenceRow(sex, ageDays);
  if (!reference) {
    return { ok: false, problems: ['WHO paediatric BMI-for-age reference covers birth through 19 years. Use the adult calculator after this range.'] };
  }

  const usedHeight = adjustedHeight(height, ageDays, measurementMethod);
  const bmi = bmiFromCentimetres(weight, usedHeight.heightCm);
  const zScore = whoLmsZScore(bmi, reference.row);
  if (!Number.isFinite(zScore)) return { ok: false, problems: ['The BMI-for-age result could not be calculated from these values. Recheck the measurements.'] };

  return {
    ok: true,
    bmi: Number(bmi.toFixed(1)),
    zScore: Number(zScore.toFixed(2)),
    percentile: formatWhoPercentile(zScore),
    classification: classifyWhoBmi(zScore, reference.referenceGroup),
    referenceGroup: reference.referenceGroup,
    ageDays,
    ageMonths: Math.floor(ageDays / WHO_MONTH_DAYS),
    referenceAge: `${reference.ageKey} ${reference.ageUnit}${reference.ageKey === 1 ? '' : 's'}`,
    heightUsedCm: Number(usedHeight.heightCm.toFixed(1)),
    heightAdjustment: usedHeight.note,
  };
}

export const WHO_BMI_REFERENCE_METADATA = whoBmiReference.metadata;
