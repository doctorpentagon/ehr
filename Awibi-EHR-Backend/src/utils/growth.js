// Paediatric growth Z-scores using the WHO LMS method.
//
// IMPORTANT — CLINICAL SAFETY
// The LMS maths below is the standard WHO formula and is correct. The reference
// TABLE it needs (L, M, S per sex per age) is deliberately NOT bundled: inventing
// or approximating WHO growth-standard values would produce plausible-looking but
// clinically wrong Z-scores, which is worse than none at all.
//
// Until real reference data is loaded, zScores() returns nulls and
// referenceDataAvailable() returns false, so the UI can render raw measurements
// and plainly say Z-scores are unavailable.
//
// To enable: download the official WHO Child Growth Standards "expanded tables"
// (https://www.who.int/tools/child-growth-standards/standards) and write
// src/data/who-growth-reference.json in this shape:
//
//   {
//     "weightForAge":    { "MALE": { "0": {"l":..,"m":..,"s":..}, "1": {...} }, "FEMALE": {...} },
//     "heightForAge":    { "MALE": { ... }, "FEMALE": { ... } },
//     "weightForHeight": { "MALE": { "45.0": {...} }, "FEMALE": { ... } }
//   }
//
// Keys are age in whole months (or length/height in cm for weight-for-height).

let reference = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  reference = require('../data/who-growth-reference.json');
} catch {
  reference = null;
}

function referenceDataAvailable() {
  return Boolean(reference && Object.keys(reference).length);
}

// WHO LMS: Z = ((X/M)^L - 1) / (L * S), with the L→0 limit handled separately.
function lmsZ(value, { l, m, s }) {
  if (value == null || !m || !s) return null;
  if (l === 0) return Number((Math.log(value / m) / s).toFixed(2));
  return Number((((value / m) ** l - 1) / (l * s)).toFixed(2));
}

function lookup(indicator, sex, key) {
  if (!referenceDataAvailable()) return null;
  const table = reference[indicator];
  if (!table) return null;
  const bySex = table[sex] || table[sex === 'FEMALE' ? 'F' : 'M'];
  if (!bySex) return null;
  return bySex[String(key)] || null;
}

function zScores({ sex, ageMonths, weightKg, heightCm }) {
  const empty = { weightForAgeZ: null, heightForAgeZ: null, weightForHeightZ: null };
  if (!referenceDataAvailable()) return empty;

  const normalisedSex = sex === 'FEMALE' ? 'FEMALE' : 'MALE';
  const out = { ...empty };

  if (ageMonths != null && weightKg != null) {
    const p = lookup('weightForAge', normalisedSex, ageMonths);
    if (p) out.weightForAgeZ = lmsZ(weightKg, p);
  }
  if (ageMonths != null && heightCm != null) {
    const p = lookup('heightForAge', normalisedSex, ageMonths);
    if (p) out.heightForAgeZ = lmsZ(heightCm, p);
  }
  if (heightCm != null && weightKg != null) {
    // Weight-for-height is keyed by height rounded to the nearest 0.5 cm.
    const key = (Math.round(heightCm * 2) / 2).toFixed(1);
    const p = lookup('weightForHeight', normalisedSex, key);
    if (p) out.weightForHeightZ = lmsZ(weightKg, p);
  }
  return out;
}

module.exports = { zScores, referenceDataAvailable, lmsZ };
