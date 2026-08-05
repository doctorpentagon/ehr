const BASE = 'http://localhost:8000/v1';
let fails = 0, passes = 0;
const rows = [];
async function tokens() {
  const acc = (await (await fetch(`${BASE}/auth/local-demo-accounts`)).json()).accounts;
  const out = {};
  for (const a of acc) {
    const key = a.facility.name.startsWith('Awibi Isolation') ? 'isoAdmin'
      : (a.subRole || a.role).toLowerCase();
    const r = await (await fetch(`${BASE}/auth/local-demo-login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: a.id }) })).json();
    out[key] = { token: r.accessToken, facility: a.facility.name, fid: a.facility.id };
  }
  return out;
}
async function probe(role, t, method, path, expect, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const ok = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
  rows.push(`  ${ok ? 'PASS' : 'FAIL'}  ${role.padEnd(12)} ${method.padEnd(5)} ${path.padEnd(38)} got ${res.status} want ${expect}`);
  ok ? passes++ : fails++;
  return res.status;
}
(async () => {
  const T = await tokens();
  console.log('=== RBAC: roles that must be BLOCKED (403) ===');
  await probe('nurse',   T.nurse.token,   'GET',  '/platform/overview', 403);
  await probe('doctor',  T.doctor.token,  'GET',  '/platform/overview', 403);
  await probe('records', T.records.token, 'GET',  '/platform/overview', 403);
  await probe('admin',   T.admin.token,   'GET',  '/platform/overview', 403);
  await probe('lab',     T.lab.token,     'GET',  '/platform/facilities', 403);
  await probe('nurse',   T.nurse.token,   'GET',  '/bookings', 403);
  await probe('doctor',  T.doctor.token,  'GET',  '/bookings', 403);
  await probe('lab',     T.lab.token,     'GET',  '/orders/worklist', 403);
  await probe('records', T.records.token, 'GET',  '/orders/nursing-tasks', 403);
  await probe('lab',     T.lab.token,     'GET',  '/nursing/monitoring-sheets', 403);
  await probe('records', T.records.token, 'GET',  '/nursing/monitoring-sheets', 403);
  await probe('doctor',  T.doctor.token,  'GET',  '/staff', 403);
  await probe('doctor',  T.doctor.token,  'GET',  '/billing', 403);
  await probe('lab',     T.lab.token,     'GET',  '/settings/facility', 403);
  await probe('nurse',   T.nurse.token,   'GET',  '/insurance/report', 403);

  console.log(rows.join('\n')); rows.length = 0;
  console.log('\n=== RBAC: writes that must be BLOCKED ===');
  const pat = (await (await fetch(`${BASE}/patients/lookup?q=Dav`, { headers: { Authorization: `Bearer ${T.doctor.token}` } })).json()).patients[0];
  await probe('nurse',   T.nurse.token,   'POST', '/orders/medications', 403, { patientId: pat.id, drugName: 'X' });
  await probe('records', T.records.token, 'POST', '/orders/nursing-tasks', 403, { patientId: pat.id, title: 'X' });
  await probe('doctor',  T.doctor.token,  'POST', '/insurance', 403, { patientId: pat.id, provider: 'X' });
  await probe('lab',     T.lab.token,     'POST', '/households', 403, { name: 'X' });
  await probe('admin',   T.admin.token,   'POST', `/cases/${'00000000-0000-4000-8000-000000000000'}/sign`, 403, {});
  await probe('nurse',   T.nurse.token,   'POST', '/emergency', [201,403], { presentingName: 'RBAC probe' });
  console.log(rows.join('\n')); rows.length = 0;

  console.log('\n=== TENANT ISOLATION: Facility B admin must see zero Facility A data ===');
  const iso = T.isoAdmin.token;
  const checks = [
    ['/patients?limit=100', d => (d.patients||[]).length],
    ['/lab?limit=100', d => (d.requests||[]).length],
    ['/billing?limit=100', d => (d.invoices||d||[]).length],
    ['/cases?limit=100', d => (d.cases||[]).length],
    ['/households', d => (d.households||[]).length],
    ['/emergency?status=ALL', d => (d.encounters||[]).length],
    ['/orders/nursing-tasks?status=ALL', d => (d.tasks||[]).length],
    ['/nursing/monitoring-sheets', d => (d.sheets||[]).length],
    ['/bookings?status=ALL', d => (d.requests||[]).length],
  ];
  for (const [path, count] of checks) {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${iso}` } });
    if (r.status !== 200) { rows.push(`  SKIP  ${path.padEnd(38)} HTTP ${r.status}`); continue; }
    const n = count(await r.json());
    const ok = n === 0;
    rows.push(`  ${ok ? 'PASS' : 'FAIL'}  isolation ${path.padEnd(38)} rows visible=${n} (want 0)`);
    ok ? passes++ : fails++;
  }
  console.log(rows.join('\n'));
  console.log(`\n  ${passes} passed, ${fails} failed`);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exitCode = 1; });
