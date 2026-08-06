const test = require('node:test');
const assert = require('node:assert/strict');
const { can, getPermissions } = require('../src/utils/permissions');
const { generateUPID, generateStaffId } = require('../src/utils/upid');
const { escapeHtml, safeSubject } = require('../src/utils/mailer');
const { normalizeVitals } = require('../src/utils/vitals');
const { generateTemporaryPassword, isStrongPassword } = require('../src/utils/passwords');
const { normalisePhone, validateDateOfBirth, ageInYears } = require('../src/utils/patientValidation');
const { deviationFor, computeDeviations, slidingScaleFor, ivFluidStatus } = require('../src/utils/monitoringTemplates');
const { loadScout } = require('./helpers/scout');
const { scoutIndex, scoutEntries, scoutSearch, scoutCalculate } = loadScout();


test('UPIDs use the unambiguous AWB format', () => {
  for (let i = 0; i < 100; i += 1) {
    assert.match(generateUPID(), /^AWB-[A-HJ-NP-Z2-9]{8}$/);
  }
});

test('staff IDs include the facility code and six digits', () => {
  assert.match(generateStaffId('UCH'), /^UCH-STF-\d{6}$/);
});

test('role permissions separate administration and clinical access', () => {
  assert.equal(can('ADMIN', null, 'staff'), true);
  // The facility owner sees every record in their facility, including encounters.
  assert.equal(can('ADMIN', null, 'cases'), true);
  assert.equal(can('ADMIN', null, 'orders'), true);
  // ...but never authors signed clinical content.
  assert.equal(can('ADMIN', null, 'clinical_write'), false);
  assert.equal(can('ADMIN', null, 'prescriptions_write'), false);
  assert.equal(can('CLINICIAN', 'DOCTOR', 'cases'), true);
  assert.equal(can('CLINICIAN', 'DOCTOR', 'billing'), false);
  assert.equal(can('CLINICIAN', 'LAB', 'lab'), true);
  assert.equal(can('CLINICIAN', 'LAB', 'patients'), false);
  assert.equal(can('RECORDS', null, 'patients'), true);
  assert.equal(can('RECORDS', null, 'lab'), false);
  assert.equal(can('RECORDS', null, 'patient_demographics_write'), true);
  assert.equal(can('RECORDS', null, 'clinical_write'), false);
  assert.equal(can('ADMIN', null, 'vitals_write'), false);
  assert.equal(can('CLINICIAN', 'DOCTOR', 'clinical_write'), true);
  assert.equal(can('CLINICIAN', 'DOCTOR', 'prescriptions_write'), true);
  assert.equal(can('CLINICIAN', 'NURSE', 'vitals_write'), true);
  assert.equal(can('CLINICIAN', 'NURSE', 'prescriptions_write'), false);
});

test('permission snapshots contain sub-role additions', () => {
  const nurse = getPermissions('CLINICIAN', 'NURSE');
  assert.equal(nurse.admissions, 1);
  assert.equal(nurse.vitals, 1);
  assert.equal(nurse.vitals_write, 1);
  assert.equal(nurse.clinical_write, undefined);
  assert.equal(nurse.staff, undefined);
});

test('mail HTML escaping blocks markup and attribute injection', () => {
  assert.equal(escapeHtml(`<img src=x onerror='bad'>&`), '&lt;img src=x onerror=&#x27;bad&#x27;&gt;&amp;');
});

test('mail subjects cannot inject additional headers', () => {
  assert.equal(safeSubject('Hello\r\nBcc: attacker@example.test'), 'Hello Bcc: attacker@example.test');
});

test('vital normalization calculates BMI and preserves valid clinical values', () => {
  const values = normalizeVitals({
    bloodPressureSystolic: '120', bloodPressureDiastolic: '80', heartRate: '72',
    temperature: '36.8', oxygenSaturation: '98', height: '180', weight: '81',
  });
  assert.equal(values.heartRate, 72);
  assert.equal(values.bmi, 25);
});

test('vital normalization rejects impossible ranges and inverted blood pressure', () => {
  assert.throws(() => normalizeVitals({ temperature: 900 }), /temperature/);
  assert.throws(() => normalizeVitals({ heartRate: -1 }), /heart rate/);
  assert.throws(() => normalizeVitals({ bloodPressureSystolic: 80, bloodPressureDiastolic: 120 }), /diastolic/);
});

test('temporary staff passwords are strong and non-repeating', () => {
  const passwords = new Set(Array.from({ length: 100 }, generateTemporaryPassword));
  assert.equal(passwords.size, 100);
  for (const password of passwords) assert.equal(isStrongPassword(password), true);
  assert.equal(isStrongPassword('Awibi@1234'), false);
});

test('phone validation accepts the Nigerian formats staff actually type', () => {
  // All three of these are the same number and must normalise to one shape,
  // otherwise duplicate detection and search silently miss each other.
  for (const input of ['08031234567', '+2348031234567', '2348031234567', '0803 123 4567', '0803-123-4567']) {
    const result = normalisePhone(input);
    assert.equal(result.ok, true, `${input} should be accepted`);
    assert.equal(result.value, '08031234567');
  }
  assert.equal(normalisePhone('09099887711').value, '09099887711');
  assert.equal(normalisePhone('07011122233').value, '07011122233');
});

test('phone validation rejects numbers that cannot reach a patient', () => {
  // A number that does not work is worse than a blank one: staff stop trying.
  for (const input of ['12345', '0603123456', '08031234567890', '080312345', 'not a phone']) {
    assert.equal(normalisePhone(input).ok, false, `${input} should be rejected`);
  }
  // Blank is legitimate — plenty of patients have no phone.
  assert.deepEqual(normalisePhone(''), { ok: true, value: null });
  assert.deepEqual(normalisePhone(null), { ok: true, value: null });
});

test('date of birth rejects values that would poison age calculations', () => {
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  assert.equal(validateDateOfBirth(nextYear.toISOString()).ok, false);
  assert.equal(validateDateOfBirth('1850-01-01').ok, false);
  assert.equal(validateDateOfBirth('not-a-date').ok, false);
  assert.equal(validateDateOfBirth('1990-05-12').ok, true);
  assert.equal(validateDateOfBirth(null).ok, true);
});

test('age is floored to whole years so the guardian prompt fires correctly', () => {
  const almost18 = new Date();
  almost18.setFullYear(almost18.getFullYear() - 18);
  almost18.setDate(almost18.getDate() + 1);   // birthday is tomorrow
  assert.equal(ageInYears(almost18), 17);

  const justTurned18 = new Date();
  justTurned18.setFullYear(justTurned18.getFullYear() - 18);
  justTurned18.setDate(justTurned18.getDate() - 1);
  assert.equal(ageInYears(justTurned18), 18);

  assert.equal(ageInYears(null), null);
});

test('deviation grades a reading against its goal and critical bands', () => {
  const bgl = { key: 'bgl', goalMin: 80, goalMax: 180, criticalLow: 70, criticalHigh: 250 };
  // Two levels of abnormal, because "note this" and "act now" are different jobs.
  assert.equal(deviationFor(bgl, 120).severity, 'NORMAL');
  assert.equal(deviationFor(bgl, 200).severity, 'HIGH');
  assert.equal(deviationFor(bgl, 200).deviation, 20);
  assert.equal(deviationFor(bgl, 300).severity, 'CRITICAL_HIGH');
  assert.equal(deviationFor(bgl, 60).severity, 'CRITICAL_LOW');
  // The boundary belongs to the more alarming side.
  assert.equal(deviationFor(bgl, 250).severity, 'CRITICAL_HIGH');
  assert.equal(deviationFor(bgl, 70).severity, 'CRITICAL_LOW');
  // No bands, no invented colour.
  assert.equal(deviationFor({ key: 'note' }, 'anything'), null);
  assert.equal(deviationFor(bgl, ''), null);
});

test('SpO2 alarms on its floor and never on its ceiling', () => {
  const spo2 = { key: 'spo2', goalMin: 95, goalMax: 100, criticalLow: 90 };
  assert.equal(deviationFor(spo2, 98).severity, 'NORMAL');
  assert.equal(deviationFor(spo2, 93).severity, 'LOW');
  assert.equal(deviationFor(spo2, 88).severity, 'CRITICAL_LOW');
  // A saturation of 100% is not a problem to be flagged.
  assert.equal(deviationFor(spo2, 100).severity, 'NORMAL');
});

test('categorical observations are judged by membership, not distance', () => {
  const site = { key: 'siteReaction', normalOptions: ['None'] };
  assert.equal(deviationFor(site, 'None').severity, 'NORMAL');
  assert.equal(deviationFor(site, 'Phlebitis').severity, 'HIGH');
  assert.equal(deviationFor(site, 'Phlebitis').deviation, 0);
});

test('an entry is abnormal if any single value is', () => {
  const fields = [
    { key: 'spo2', goalMin: 95, goalMax: 100, criticalLow: 90 },
    { key: 'pulse', goalMin: 60, goalMax: 100, criticalLow: 40, criticalHigh: 130 },
  ];
  const fine = computeDeviations(fields, { spo2: 98, pulse: 72 });
  assert.equal(fine.isAbnormal, false);
  assert.equal(fine.isCritical, false);

  const bad = computeDeviations(fields, { spo2: 88, pulse: 72 });
  assert.equal(bad.isAbnormal, true);
  assert.equal(bad.isCritical, true);
  assert.deepEqual(bad.criticalKeys, ['spo2']);
});

test('the insulin sliding scale suggests, and says so', () => {
  const low = slidingScaleFor(55);
  assert.equal(low.suggestedUnits, 0);
  assert.match(low.advice, /HYPOGLYCAEMIA/);
  assert.equal(slidingScaleFor(150).suggestedUnits, 0);
  assert.equal(slidingScaleFor(280).suggestedUnits, 6);
  // A suggestion that reads like an instruction will be followed as one.
  assert.equal(slidingScaleFor(280).isSuggestionOnly, true);
  assert.equal(slidingScaleFor('not a number'), null);
});

test('IV bag volume is derived and warns before it runs dry', () => {
  const nearlyEmpty = ivFluidStatus({ bagSizeMl: 1000, totalInfusedMl: 960 });
  assert.equal(nearlyEmpty.volumeRemaining, 40);
  assert.equal(nearlyEmpty.warnings[0].code, 'BAG_CHANGE_DUE');

  const fresh = ivFluidStatus({ bagSizeMl: 1000, totalInfusedMl: 250 });
  assert.equal(fresh.volumeRemaining, 750);
  assert.equal(fresh.warnings.length, 0);

  // A pump running fast is a different problem from a pump running slightly off.
  const drifting = ivFluidStatus({ bagSizeMl: 1000, totalInfusedMl: 0, rateOrdered: 125, rateActual: 150 });
  assert.equal(drifting.warnings[0].code, 'RATE_DEVIATION');
  const wayOff = ivFluidStatus({ bagSizeMl: 1000, totalInfusedMl: 0, rateOrdered: 125, rateActual: 200 });
  assert.equal(wayOff.warnings[0].code, 'RATE_DEVIATION_CRITICAL');
  // Never subtract past zero.
  assert.equal(ivFluidStatus({ bagSizeMl: 1000, totalInfusedMl: 1200 }).volumeRemaining, 0);
});

// ── Awibi Scout ─────────────────────────────────────────────────────────────

test('scout search finds an entry by its exact name', () => {
  assert.equal(scoutIndex.entries.length > 100, true);
  const { results, state } = scoutSearch(scoutIndex, 'bmi');
  assert.equal(state, 'EXACT');
  assert.match(results[0].entry.t, /Body Mass Index/);
});

test('scout search resolves a part-word', () => {
  // "ketoacid" is inside "ketoacidosis" — whole-token matching returns nothing.
  const { results } = scoutSearch(scoutIndex, 'ketoacid');
  assert.equal(results.length > 0, true);
  assert.match(results[0].entry.t, /DKA|ketoacid/i);
});

test('scout search survives a misspelling', () => {
  for (const typo of ['diabetis', 'pnemonia', 'hemorrage']) {
    const { results } = scoutSearch(scoutIndex, typo);
    assert.equal(results.length > 0, true, `${typo} found nothing`);
  }
});

test('scout search understands how people actually speak', () => {
  // A nurse asks "how many drops", not "infusion rate conversion".
  const { state, results } = scoutSearch(scoutIndex, 'how many drops');
  assert.equal(state, 'BRIDGE');
  assert.match(results[0].entry.t, /Drip Rate/i);
});

test('scout search folds British and American spellings together', () => {
  const british = scoutSearch(scoutIndex, 'anaemia').results;
  const american = scoutSearch(scoutIndex, 'anemia').results;
  assert.equal(british.length > 0 && american.length > 0, true);
  assert.equal(british[0].entry.g, american[0].entry.g);
});

test('scout search tells you when it is guessing', () => {
  // A fuzzy or partial match must not be presented as an exact answer —
  // somebody is about to dose against it.
  const exact = scoutSearch(scoutIndex, 'bmi');
  assert.equal(exact.note, null);
  const vague = scoutSearch(scoutIndex, 'zzzqqq');
  assert.equal(vague.state, 'GAP');
  assert.equal(vague.results.length, 0);
});

test('scout calculators compute correctly', () => {
  const bmi = scoutEntries.body_mass_index_bmi;
  const { ok, results } = scoutCalculate(bmi, { weight: 70, height: 1.75 });
  assert.equal(ok, true);
  assert.equal(results[0].value, 22.9);
  assert.equal(results[0].band, 'Normal range');
});

test('scout calculators refuse rather than produce a wrong number', () => {
  const bmi = scoutEntries.body_mass_index_bmi;
  // A number on screen is taken as correct, so nothing appears unless it is.
  assert.equal(scoutCalculate(bmi, { weight: 70 }).ok, false);
  assert.equal(scoutCalculate(bmi, { weight: 900, height: 1.75 }).ok, false);
  assert.equal(scoutCalculate(bmi, { weight: 'seventy', height: 1.75 }).ok, false);
  assert.equal(scoutCalculate(bmi, { weight: 70, height: 0 }).ok, false);
});

test('every scout calculator in the corpus produces a number', () => {
  const computable = Object.values(scoutEntries).filter((e) => e.logic && e.logic.op);
  assert.equal(computable.length > 0, true);
  for (const entry of computable) {
    const values = {};
    for (const input of entry.inputs || []) {
      if (input.type === 'boolean' || input.type === 'checkbox') values[input.key] = true;
      else if (input.min != null && input.max != null) values[input.key] = (input.min + input.max) / 2;
      else values[input.key] = input.default ?? 1;
    }
    assert.equal(scoutCalculate(entry, values).ok, true, `${entry.title} failed to compute`);
  }
});

test('entries that only describe their formula are not offered as calculators', () => {
  // Six entries carry the formula as prose because it branches in ways the
  // expression format does not cover. Offering a Calculate button that can
  // never produce an answer would be worse than showing the formula.
  const noted = Object.values(scoutEntries).filter((e) => e.logic && !e.logic.op && e.logic.note);
  assert.equal(noted.length > 0, true);
  for (const entry of noted) {
    const outcome = scoutCalculate(entry, {});
    assert.equal(outcome.ok, false);
    assert.equal(outcome.notComputable, true);
    assert.equal(typeof outcome.formula, 'string');
  }
});

test('scout search stays inside the keystroke budget', () => {
  const queries = ['bmi', 'tetan', 'ketoacid', 'diabetis', 'drip rate', 'sepsis'];
  const started = Date.now();
  for (let i = 0; i < 300; i += 1) scoutSearch(scoutIndex, queries[i % queries.length]);
  const average = (Date.now() - started) / 300;
  // The spec allows 60ms per keystroke; anything near that would feel laggy.
  assert.equal(average < 20, true, `average query took ${average}ms`);
});

/**
 * The frontend keeps its own copy of the permission map to render the sidebar.
 * When the two drift, the UI either hides a screen the user is allowed to open
 * or offers a button the API refuses — both look like bugs to the user and
 * neither shows up in any other test. This compares them directly.
 */
test('the frontend and backend permission maps agree', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const file = path.join(__dirname, '..', '..', 'Awibi-EHR-Frontend', 'src', 'lib', 'permissions.js');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^export\s+/gm, '')
    .replace(/^import[^\n]*$/gm, '');
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = { can, PERMISSIONS, NAV_ITEMS };`, context);
  const frontend = context.module.exports;

  const roles = [
    ['SUPER_ADMIN', null], ['ADMIN', null], ['RECORDS', null],
    ['CLINICIAN', 'DOCTOR'], ['CLINICIAN', 'NURSE'], ['CLINICIAN', 'LAB'],
  ];
  // Every module the sidebar gates on, plus the write permissions that decide
  // whether a screen shows an action button.
  const modules = [...new Set([
    ...frontend.NAV_ITEMS.map((i) => i.key).filter(Boolean),
    'admissions', 'beds', 'monitoring_write', 'monitoring_review', 'clinical_write',
    'prescriptions_write', 'drug_admin_write', 'emergency_write', 'handover_write',
    'vitals_write', 'patient_demographics_write', 'growth_write',
  ])];

  // Some keys gate a page that never calls the API — Help & Support is static
  // content. The backend has no opinion on those, so comparing them would only
  // produce noise that trains people to ignore this test.
  const frontendOnly = new Set(['support']);

  const drift = [];
  for (const [role, subRole] of roles) {
    for (const module of modules) {
      if (frontendOnly.has(module)) continue;
      const back = can(role, subRole, module);
      const front = frontend.can(role, subRole, module);
      if (back !== front) drift.push(`${subRole || role}/${module}: backend ${back}, frontend ${front}`);
    }
  }
  assert.deepEqual(drift, [], `permission maps disagree:\n  ${drift.join('\n  ')}`);
});

test('every sidebar item points at a module the backend knows', () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const file = path.join(__dirname, '..', '..', 'Awibi-EHR-Frontend', 'src', 'lib', 'permissions.js');
  const source = fs.readFileSync(file, 'utf8').replace(/^export\s+/gm, '').replace(/^import[^\n]*$/gm, '');
  const context = { module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(`${source}\nmodule.exports = { NAV_ITEMS };`, context);

  // A nav key nobody grants is a permanently locked menu item.
  const frontendOnly = new Set(['support']);
  // Spread into a host array. The nav list comes from a vm context, so arrays
  // derived from it carry that realm's Array prototype — and deepStrictEqual
  // compares prototypes, so two empty arrays from different realms are not
  // equal. Comparing them directly fails with a blank diff that says nothing.
  const orphans = [...context.module.exports.NAV_ITEMS
    .filter((item) => item.key && !frontendOnly.has(item.key))
    .filter((item) => ![
      ['SUPER_ADMIN', null], ['ADMIN', null], ['RECORDS', null],
      ['CLINICIAN', 'DOCTOR'], ['CLINICIAN', 'NURSE'], ['CLINICIAN', 'LAB'],
    ].some(([r, s]) => can(r, s, item.key)))
    .map((item) => `${item.label} (${item.key})`)];

  assert.deepEqual(orphans, [], `sidebar items no role can reach: ${orphans.join(', ')}`);
});
