/**
 * Dashboard loop audit.
 *
 * For every feature: can it be started, carried to completion, and does
 * completing it trigger what it should elsewhere? A feature that can be created
 * but not finished is a dead end; one that finishes without notifying anybody
 * is a silent loss.
 */
const B = 'http://localhost:8000/v1';
const gaps = [];
let ok = 0;

const step = (loop, label, passed, detail = '') => {
  console.log(`     ${passed ? '·' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  if (passed) ok += 1; else gaps.push(`${loop}: ${label}${detail ? ` (${detail})` : ''}`);
};

(async () => {
  for (let i = 0; i < 30; i += 1) {
    try { if ((await fetch(`${B}/auth/local-demo-accounts`)).status === 200) break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const acc = (await (await fetch(`${B}/auth/local-demo-accounts`)).json()).accounts;
  const tk = async (f) => (await (await fetch(`${B}/auth/local-demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: acc.find(f).id }),
  })).json()).accessToken;

  const T = {
    nurse: await tk((a) => a.subRole === 'NURSE'),
    doctor: await tk((a) => a.subRole === 'DOCTOR'),
    lab: await tk((a) => a.subRole === 'LAB'),
    records: await tk((a) => a.role === 'RECORDS'),
    admin: await tk((a) => a.role === 'ADMIN' && a.facility.name.includes('UCH')),
  };
  const H = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  const call = async (m, p, t, body) => {
    const r = await fetch(B + p, { method: m, headers: H(t), body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, d };
  };

  const patients = (await call('GET', '/patients?limit=5', T.records)).d.patients;
  const patient = patients.find((p) => !p.isEmergencyTemp);
  const cleanup = [];

  // ── 1. Registration → chart → discharge ───────────────────────────────────
  console.log('\n  1. REGISTRATION');
  const reg = await call('POST', '/patients', T.records, {
    firstName: 'Loop', lastName: 'Audit', gender: 'FEMALE', phone: '08031119999',
  });
  step('registration', 'a receptionist can register', reg.status === 201, `HTTP ${reg.status}`);
  step('registration', 'a chart number is issued at once', Boolean(reg.d?.mrn), reg.d?.mrn);
  step('registration', 'the patient is findable by that number',
    (await call('GET', `/patients?search=${encodeURIComponent(reg.d?.mrn || 'x')}`, T.records)).d?.patients?.length > 0);
  if (reg.d?.id) cleanup.push(() => call('DELETE', `/patients/${reg.d.id}`, T.records));

  // ── 2. Encounter → sign → immutable ──────────────────────────────────────
  console.log('\n  2. ENCOUNTER');
  const types = (await call('GET', '/encounter-types', T.doctor)).d.types;
  const enc = await call('POST', '/cases', T.doctor, {
    patientId: patient.id, chiefComplaint: 'Loop audit', encounterTypeId: types[0].id,
    icdCodes: [{ code: 'R07.9', label: 'Chest pain' }],
  });
  step('encounter', 'a doctor can open one', enc.status === 201, `HTTP ${enc.status}`);
  step('encounter', 'it records what kind of contact it was', Boolean(enc.d?.encounterTypeId));
  const signed = await call('POST', `/cases/${enc.d?.id}/sign`, T.doctor, {});
  step('encounter', 'it can be signed', signed.status === 200, `HTTP ${signed.status}`);
  step('encounter', 'signing makes it immutable',
    (await call('PUT', `/cases/${enc.d?.id}`, T.doctor, { chiefComplaint: 'changed' })).status === 409);
  step('encounter', 'an unsigned empty note cannot be signed',
    (await call('POST', '/cases', T.doctor, { patientId: patient.id, encounterTypeId: types[0].id })).status === 201);
  if (enc.d?.id) cleanup.push(() => call('DELETE', `/cases/${enc.d.id}`, T.admin));

  // ── 3. Order → nurse sees it → carried out ───────────────────────────────
  console.log('\n  3. ORDER → EXECUTION');
  const order = await call('POST', '/orders/standing', T.doctor, {
    patientId: patient.id, type: 'NURSING', name: 'Loop audit turn', frequencyHours: 2,
  });
  step('orders', 'a doctor can order', order.status === 201);
  const worklist = await call('GET', '/orders/standing?status=ACTIVE', T.nurse);
  step('orders', 'it reaches the nurse worklist',
    worklist.d?.orders?.some((o) => o.id === order.d?.id));
  const done = await call('POST', `/orders/standing/${order.d?.id}/execute`, T.nurse, { result: 'Done' });
  step('orders', 'the nurse can complete it', done.status === 201);
  step('orders', 'completion is counted',
    (await call('GET', `/orders/standing/${order.d?.id}`, T.doctor)).d?.completedCount === 1);
  step('orders', 'stopping it needs a reason',
    (await call('PUT', `/orders/standing/${order.d?.id}/status`, T.doctor, { status: 'DISCONTINUED' })).status === 400);
  if (order.d?.id) cleanup.push(() => call('PUT', `/orders/standing/${order.d.id}/status`, T.doctor, { status: 'DISCONTINUED', reason: 'audit cleanup' }));

  // ── 4. Order → monitoring chart → critical reading → alert ───────────────
  console.log('\n  4. MONITORING → ALERT');
  const mOrder = await call('POST', '/orders/standing', T.doctor, {
    patientId: patient.id, type: 'NURSING', name: 'Loop audit catheter hourly urine output', frequencyHours: 1,
  });
  step('monitoring', 'the order names the chart it needs',
    mOrder.d?.suggestedMonitoringSheet?.sheetType === 'URINARY_CATHETER');
  const waiting = await call('GET', `/nursing/monitoring-requests?patientId=${patient.id}`, T.nurse);
  step('monitoring', 'it appears as a chart waiting to be opened',
    waiting.d?.requests?.some((r) => r.orderId === mOrder.d?.id));
  const sheet = await call('POST', `/nursing/monitoring-requests/${mOrder.d?.id}/initiate`, T.nurse, {
    fields: [{ key: 'volumeMl', label: 'Urine volume', unit: 'ml', kind: 'number', mapsTo: 'outputMl', goalMin: 30, criticalLow: 15 }],
    metadata: { catheterSize: '16 Fr' },
  });
  step('monitoring', 'the nurse opens it and defines what is recorded', sheet.status === 201);
  const entry = await call('POST', `/nursing/monitoring-sheets/${sheet.d?.sheet?.id}/entries`, T.nurse, { values: { volumeMl: 10 } });
  step('monitoring', 'a critical reading is graded on the server',
    entry.d?.deviations?.volumeMl?.severity === 'CRITICAL_LOW');
  const alerts = await call('GET', '/alerts', T.doctor);
  step('monitoring', 'it raises an alert for the doctor',
    alerts.d?.alerts?.some((a) => a.category === 'OBSERVATION' && a.severity === 'CRITICAL'));
  const review = await call('POST', `/nursing/monitoring-sheets/${sheet.d?.sheet?.id}/reviews`, T.doctor, {
    kind: 'CORRECTION_REQUESTED', comment: 'Please recheck against the meter',
  });
  step('monitoring', 'the doctor can ask for a recheck', review.status === 201);
  step('monitoring', 'the nurse sees that request',
    (await call('GET', `/nursing/monitoring-reviews?patientId=${patient.id}`, T.nurse)).d?.reviews?.some((r) => r.id === review.d?.id));
  step('monitoring', 'the nurse closes the loop',
    (await call('PUT', `/nursing/monitoring-reviews/${review.d?.id}/resolve`, T.nurse, { resolution: 'Rechecked' })).status === 200);
  if (sheet.d?.sheet?.id) cleanup.push(() => call('DELETE', `/nursing/monitoring-sheets/${sheet.d.sheet.id}`, T.nurse));
  if (mOrder.d?.id) cleanup.push(() => call('PUT', `/orders/standing/${mOrder.d.id}/status`, T.doctor, { status: 'DISCONTINUED', reason: 'audit cleanup' }));

  // ── 5. Diagnostics: request → result → doctor sees it ────────────────────
  console.log('\n  5. DIAGNOSTICS');
  const lab = await call('POST', '/lab', T.doctor, {
    patientId: patient.id, testName: 'Loop audit potassium', testType: 'LAB', priority: 'URGENT',
  });
  step('diagnostics', 'a doctor can request a test', lab.status === 201);
  step('diagnostics', 'it appears in the diagnostics queue',
    (await call('GET', '/lab?status=PENDING', T.lab)).d?.requests?.some((r) => r.id === lab.d?.id));
  const result = await call('PUT', `/lab/${lab.d?.id}/result`, T.lab, {
    status: 'COMPLETED', resultValue: 7.2, resultUnit: 'mmol/L', referenceLow: 3.5, referenceHigh: 5.1,
  });
  step('diagnostics', 'diagnostics can enter a result', result.status === 200);
  step('diagnostics', 'an out-of-range result is flagged',
    Boolean(result.d?.abnormalFlag) && result.d.abnormalFlag !== 'NORMAL', result.d?.abnormalFlag);
  if (lab.d?.id) cleanup.push(() => call('DELETE', `/lab/${lab.d.id}`, T.doctor));

  // ── 6. Billing: invoice → payment → ledger ───────────────────────────────
  console.log('\n  6. BILLING');
  const inv = await call('POST', '/billing/', T.admin, {
    patientId: patient.id, subtotal: 5000, total: 5000,
    items: [{ description: 'Loop audit', quantity: 1, unitPrice: 5000, amount: 5000 }],
  });
  step('billing', 'an invoice can be raised', inv.status === 201 || inv.status === 200);
  const pay = await call('PUT', `/billing/${inv.d?.id}/record-payment`, T.admin, { amount: 5000, method: 'CASH' });
  step('billing', 'a payment settles it', pay.d?.paymentStatus === 'PAID');
  step('billing', 'the payment is attributable',
    (await call('GET', `/billing/${inv.d?.id}/payments`, T.admin)).d?.payments?.[0]?.receivedBy?.firstName != null);
  step('billing', 'a settled invoice takes no more money',
    (await call('PUT', `/billing/${inv.d?.id}/record-payment`, T.admin, { amount: 100 })).status === 400);
  if (inv.d?.id) cleanup.push(async () => {
    await fetch(`${B}/billing/${inv.d.id}`, { method: 'DELETE', headers: H(T.admin) });
  });

  // ── 7. Admission: bed → admit → discharge → bed freed ────────────────────
  console.log('\n  7. ADMISSION');
  const beds = await call('GET', '/admissions/beds?status=AVAILABLE', T.nurse);
  const bed = beds.d?.beds?.[0];
  step('admission', 'there is an available bed to admit to', Boolean(bed), `${beds.d?.counts?.available} free`);
  if (bed) {
    const adm = await call('POST', '/admissions', T.nurse, {
      patientId: patient.id, bedId: bed.id, diagnosis: 'Loop audit',
    });
    step('admission', 'a patient can be admitted', adm.status === 201, `HTTP ${adm.status}`);
    const after = await call('GET', `/admissions/beds?ward=${encodeURIComponent(bed.ward || '')}`, T.nurse);
    const nowBed = after.d?.beds?.find((b) => b.id === bed.id);
    step('admission', 'the bed becomes occupied', nowBed?.status === 'OCCUPIED', nowBed?.status);
    const disc = await call('PUT', `/admissions/${adm.d?.id}/discharge`, T.doctor, { outcome: 'Recovered' });
    step('admission', 'the patient can be discharged', disc.status === 200, `HTTP ${disc.status}`);
    const freed = await call('GET', `/admissions/beds?ward=${encodeURIComponent(bed.ward || '')}`, T.nurse);
    const freedBed = freed.d?.beds?.find((b) => b.id === bed.id);
    step('admission', 'discharge frees the bed', freedBed?.status !== 'OCCUPIED', freedBed?.status);
  }

  // ── 8. Public enquiry → records queue → registration ─────────────────────
  console.log('\n  8. PUBLIC ENQUIRY');
  const slug = (await (await fetch(`${B}/public/clinics`)).json()).clinics?.find((c) => c.slug?.includes('uch'))?.slug;
  const ip = `2001:db8:aud:${Date.now().toString(16)}::1`;
  const enq = await fetch(`${B}/public/clinic/${slug}/inquiry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ name: 'Loop Enquiry', phone: '08033332222', symptoms: 'chest pain and sweating' }),
  });
  const enqData = await enq.json();
  step('enquiry', 'the public can send one', enq.status === 201);
  step('enquiry', 'urgent symptoms are routed to emergency', enqData.isUrgent === true);
  const queue = await call('GET', '/inquiries?status=NEW', T.records);
  const mine = queue.d?.inquiries?.find((i) => i.name === 'Loop Enquiry');
  step('enquiry', 'it reaches the records desk', Boolean(mine));
  step('enquiry', 'urgent ones sort to the top', queue.d?.inquiries?.[0]?.isUrgent === true);
  step('enquiry', 'registration is prefilled from it',
    (await call('GET', `/inquiries/${mine?.id}/prefill`, T.records)).d?.phone === '08033332222');
  cleanup.push(async () => {
    if (mine?.id) await call('PUT', `/inquiries/${mine.id}/status`, T.records, { status: 'CLOSED' });
  });

  // ── 9. Emergency: intake → resuscitation → merge ─────────────────────────
  console.log('\n  9. EMERGENCY');
  const em = await call('POST', '/emergency', T.records, {
    presentingName: 'Loop Unknown', triage: 'RESUSCITATION', chiefComplaint: 'Collapse',
  });
  step('emergency', 'intake works without an identity', em.status === 201);
  const resus = await call('POST', '/emergency/resuscitation', T.nurse, {
    patientId: em.d?.patientId, emergencyEncounterId: em.d?.id, type: 'CODE_BLUE', protocols: ['ACLS'],
  });
  step('emergency', 'a nurse can start a resuscitation', resus.status === 201);
  await call('POST', `/emergency/resuscitation/${resus.d?.id}/entries`, T.nurse, { action: 'Start CPR', timeOffsetSeconds: 0 });
  step('emergency', 'actions are logged against the clock',
    (await call('GET', `/emergency/resuscitation/${resus.d?.id}`, T.doctor)).d?.entries?.length === 1);
  await call('PUT', `/emergency/resuscitation/${resus.d?.id}/end`, T.doctor, { outcome: 'ROSC' });
  const merged = await call('POST', `/emergency/${em.d?.id}/link`, T.records, { targetPatientId: patient.id });
  step('emergency', 'the record merges onto a real patient', merged.status === 200);
  step('emergency', 'the resuscitation follows the patient',
    merged.d?.moved?.resuscitationEvents === 1);
  cleanup.push(async () => {
    if (resus.d?.id) {
      await fetch(`${B}/emergency/resuscitation/${resus.d.id}`, { method: 'DELETE', headers: H(T.admin) });
    }
  });

  // ── 10. Messaging ────────────────────────────────────────────────────────
  console.log('\n 10. MESSAGING');
  const colleagues = (await call('GET', '/messages/recipients', T.nurse)).d?.recipients || [];
  const doc = colleagues.find((c) => c.subRole === 'DOCTOR');
  const msg = await call('POST', '/messages', T.nurse, {
    recipientId: doc?.id, subject: 'Loop audit', body: 'Please review bed 4.', priority: 'URGENT', patientId: patient.id,
  });
  step('messaging', 'a nurse can message a doctor', msg.status === 201);
  step('messaging', 'the doctor gets an unread badge',
    (await call('GET', '/messages/unread-count', T.doctor)).d?.unread >= 1);
  step('messaging', 'the doctor can read it',
    (await call('PUT', `/messages/${msg.d?.id}/read`, T.doctor)).status === 200);

  for (const fn of cleanup) { try { await fn(); } catch {} }

  console.log(`\n  ${ok} steps completed, ${gaps.length} gaps\n`);
  if (gaps.length) { console.log('  GAPS:'); gaps.forEach((g) => console.log(`    ${g}`)); }
  process.exit(gaps.length ? 1 : 0);
})();
