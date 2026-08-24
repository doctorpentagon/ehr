import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bmiFromCentimetres,
  calculatePediatricBmi,
  classifyWhoBmi,
  percentileFromZ,
  whoLmsZScore,
} from '../src/lib/pediatricBmi.js';

test('adult BMI accepts centimetres', () => {
  assert.equal(Number(bmiFromCentimetres(70, 175).toFixed(1)), 22.9);
  assert.equal(bmiFromCentimetres(70, 0), null);
});

test('WHO LMS median returns a zero z-score', () => {
  const femaleBirthRow = [0, -0.0631, 13.3363, 0.09272];
  assert.ok(Math.abs(whoLmsZScore(13.3363, femaleBirthRow)) < 1e-10);
});

test('WHO 2007 worked BMI example is reproduced', () => {
  const result = calculatePediatricBmi({
    weightKg: 67.5,
    heightCm: 150,
    sex: 'male',
    birthDate: '2015-08-24',
    measurementDate: '2026-08-24',
  });
  assert.equal(result.ok, true);
  assert.equal(result.bmi, 30);
  assert.ok(Math.abs(result.zScore - 3.35) <= 0.02, `expected WHO example z≈3.35, got ${result.zScore}`);
  assert.equal(result.classification.label, 'Obesity');
  assert.match(result.percentile, /99\.86/);
});

test('WHO 2006 daily infant reference is used at birth', () => {
  const result = calculatePediatricBmi({
    weightKg: 3.334075,
    heightCm: 50,
    sex: 'female',
    birthDate: '2026-08-24',
    measurementDate: '2026-08-24',
  });
  assert.equal(result.ok, true);
  assert.equal(result.referenceGroup, 'WHO_2006_0_5');
  assert.equal(result.zScore, 0);
  assert.equal(result.classification.label, 'Expected BMI-for-age range');
});

test('WHO length/height conversion is applied when measurement method differs', () => {
  const result = calculatePediatricBmi({
    weightKg: 15,
    heightCm: 100,
    sex: 'male',
    birthDate: '2023-08-24',
    measurementDate: '2026-08-24',
    measurementMethod: 'lying',
  });
  assert.equal(result.ok, true);
  assert.equal(result.heightUsedCm, 99.3);
  assert.match(result.heightAdjustment, /Subtracted 0\.7 cm/);
});

test('paediatric validation refuses impossible chronology and out-of-range age', () => {
  const base = { weightKg: 50, heightCm: 160, sex: 'female' };
  assert.equal(calculatePediatricBmi({ ...base, birthDate: '2027-01-01', measurementDate: '2026-08-24' }).ok, false);
  assert.equal(calculatePediatricBmi({ ...base, birthDate: '2000-01-01', measurementDate: '2026-08-24' }).ok, false);
});

test('WHO interpretation cut-offs and percentile conversion are stable', () => {
  assert.equal(classifyWhoBmi(1.1, 'WHO_2006_0_5').label, 'At risk of overweight');
  assert.equal(classifyWhoBmi(1.1, 'WHO_2007_5_19').label, 'Overweight');
  assert.equal(classifyWhoBmi(-3.1, 'WHO_2007_5_19').label, 'Severe thinness');
  assert.ok(Math.abs(percentileFromZ(0) - 50) < 1e-6);
});
