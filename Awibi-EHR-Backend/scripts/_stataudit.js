/* Independent recomputation of every headline number, compared to the API. */
const { prisma, connectDatabase } = require('../src/utils/database');
const BASE = 'http://localhost:8000/v1';
let fails = 0, passes = 0;
function check(label, mine, api, tol = 0) {
  const ok = Math.abs(Number(mine) - Number(api)) <= tol;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} manual=${mine}  api=${api}`);
  ok ? passes++ : fails++;
}
async function tok(pred) {
  const accounts = await (await fetch(`${BASE}/auth/local-demo-accounts`)).json();
  const a = accounts.accounts.find(pred);
  const r = await (await fetch(`${BASE}/auth/local-demo-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: a.id }) })).json();
  return { token: r.accessToken, facilityId: a.facility.id, name: a.facility.name };
}
const get = (p, t) => fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json());

(async () => {
  await connectDatabase();
  const admin = await tok(a => a.role === 'ADMIN' && a.facility.name.startsWith('UCH'));
  const sup   = await tok(a => a.role === 'SUPER_ADMIN');
  const fid = admin.facilityId;

  console.log(`\n=== ADMIN DASHBOARD (${admin.name}) ===`);
  const ov = await get('/overview', admin.token);
  const k = ov.kpi || ov;
  const dbPatients = await prisma.patient.count({ where: { facilityId: fid, isArchived: false } });
  check('total patients (facility-scoped, unarchived)', dbPatients, k.totalPatients ?? 'n/a');

  const som = new Date(); som.setDate(1); som.setHours(0,0,0,0);
  const dbMonth = await prisma.patient.count({ where: { facilityId: fid, isArchived: false, createdAt: { gte: som } } });
  check('patients this month', dbMonth, k.patientsThisMonth ?? 'n/a');

  const sod = new Date(); sod.setHours(0,0,0,0);
  const eod = new Date(); eod.setHours(23,59,59,999);
  const dbAppt = await prisma.appointment.count({
    where: { facilityId: fid, scheduledAt: { gte: sod, lte: eod }, status: { notIn: ['CANCELLED'] } } });
  check("today's appointments (excl cancelled)", dbAppt, k.todayAppointments ?? 'n/a');

  const dbPendLab = await prisma.labRequest.count({ where: { facilityId: fid, status: 'PENDING' } });
  check('pending lab', dbPendLab, k.pendingLab ?? 'n/a');

  console.log(`\n=== BILLING SUMMARY (facility) ===`);
  const bs = await get('/billing/summary', admin.token);
  const agg = await prisma.invoice.aggregate({ _sum: { total: true, amountPaid: true, balance: true }, where: { facilityId: fid } });
  check('total billed', Number(agg._sum.total||0), Number(bs.totalBilled||0), 0.01);
  check('total collected', Number(agg._sum.amountPaid||0), Number(bs.totalCollected||0), 0.01);
  check('outstanding', Number(agg._sum.balance||0), Number(bs.outstanding||0), 0.01);

  console.log(`\n=== SUPER ADMIN PLATFORM METRICS ===`);
  const pl = await get('/platform/overview', sup.token);
  check('facilities total', await prisma.facility.count(), pl.facilities.total);
  check('active users', await prisma.user.count({ where: { isActive: true } }), pl.users.active);
  check('doctors', await prisma.user.count({ where: { subRole: 'DOCTOR', isActive: true } }), pl.users.doctors);
  check('patients (all facilities)', await prisma.patient.count({ where: { isArchived: false } }), pl.patients.total);
  check('encounters (all facilities)', await prisma.case.count(), pl.encounters.total);

  const invAll = await prisma.invoice.aggregate({ _sum: { amountPaid: true } });
  const subAll = await prisma.subscription.aggregate({ _sum: { amount: true } });
  console.log(`\n  >>> platform revenue reported: NGN ${Number(pl.revenue.allTime).toLocaleString()}`);
  console.log(`      sum of PATIENT invoice payments : NGN ${Number(invAll._sum.amountPaid||0).toLocaleString()}  <-- what it matches`);
  console.log(`      sum of FACILITY subscriptions   : NGN ${Number(subAll._sum.amount||0).toLocaleString()}  <-- what Awibi actually earns`);
  if (Number(pl.revenue.allTime) === Number(invAll._sum.amountPaid||0)) {
    console.log('      FAIL  Investor "revenue" is clinical income belonging to the hospitals, not Awibi.');
    fails++;
  }

  console.log(`\n=== EMPTY / EDGE CASES ===`);
  const iso = await tok(a => a.role === 'ADMIN' && a.facility.name.startsWith('Awibi Isolation'));
  const isoOv = await get('/overview', iso.token);
  const isoK = isoOv.kpi || isoOv;
  const bad = Object.entries(isoK).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v));
  console.log(`  ${bad.length===0?'PASS':'FAIL'}  empty facility produces no NaN/Infinity        ${bad.length?JSON.stringify(bad):'(all finite)'}`);
  bad.length ? fails++ : passes++;
  const isoBill = await get('/billing/summary', iso.token);
  const badB = Object.entries(isoBill).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v));
  console.log(`  ${badB.length===0?'PASS':'FAIL'}  empty billing summary finite                  ${badB.length?JSON.stringify(badB):'(all finite)'}`);
  badB.length ? fails++ : passes++;

  console.log(`\n  ${passes} passed, ${fails} failed`);
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
