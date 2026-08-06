/**
 * Sign in as every demo role and open every screen the sidebar offers them.
 *
 * The nav is built from the permission map, but nothing confirmed that a screen
 * the sidebar offers actually returns data when opened. A menu item that 500s
 * is something a demo tester finds in the first two minutes.
 *
 * The permission each endpoint really enforces is read out of the route file
 * itself rather than assumed. An earlier version of this script kept its own
 * table of module names, guessed several of them wrong, and reported fifteen
 * security leaks that did not exist — `/households`, for instance, is guarded
 * by `patients`, not by `households`. A check that cries wolf is worse than no
 * check, because the next real finding gets waved away too.
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.API || 'http://localhost:8000/v1';
const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');
const { can } = require('../src/utils/permissions');

/**
 * Present a distinct client address per request.
 *
 * The rate limiter counts per IP. Run after the smoke suite, which spends a
 * large part of that budget, this script starts collecting 429s and reports
 * working screens as broken — a failure that looks exactly like a defect and
 * is not one. Each request therefore arrives with its own address.
 */
let ipCounter = 0;
function freshClientIp() {
  ipCounter += 1;
  return `2001:db8:${Date.now().toString(16)}::${ipCounter.toString(16)}`;
}

async function req(target, opts = {}) {
  const res = await fetch(`${BASE}${target}`, {
    ...opts,
    headers: { 'X-Forwarded-For': freshClientIp(), ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}

/**
 * The permission a route file requires for its GET / handler, read from source.
 * Handles both `requirePermission('x')` inline and the `const read = [...]`
 * array style this codebase uses.
 */
function guardFor(routeFile) {
  const full = path.join(ROUTES_DIR, `${routeFile}.js`);
  if (!fs.existsSync(full)) return null;
  const src = fs.readFileSync(full, 'utf8');

  const named = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*\[[^\]]*requirePermission\(\s*'([^']+)'\s*\)[^\]]*\]/g)) {
    named[m[1]] = m[2];
  }
  const rootGet = src.match(/router\.get\(\s*'\/'\s*,\s*([^,)]+)/);
  if (rootGet) {
    const ref = rootGet[1].trim();
    if (named[ref]) return named[ref];
    const inline = src.match(/router\.get\(\s*'\/'[^)]*requirePermission\(\s*'([^']+)'\s*\)/);
    if (inline) return inline[1];
  }
  const any = src.match(/requirePermission\(\s*'([^']+)'\s*\)/);
  return any ? any[1] : null;
}

// The screen each nav module opens, and the route file that serves it.
const SCREENS = [
  ['patients', '/patients?limit=1', 'patients'],
  ['appointments', '/appointments?limit=1', 'appointments'],
  ['cases', '/cases?limit=1', 'cases'],
  ['lab', '/lab?limit=1', 'lab'],
  ['admissions', '/admissions', 'admissions'],
  ['departments', '/departments', 'departments'],
  ['staff', '/staff?limit=1', 'staff'],
  ['billing', '/billing?limit=1', 'billing'],
  ['subscription', '/subscriptions', 'subscriptions'],
  ['platform', '/platform/overview', 'platform'],
  ['bookings', '/bookings', 'bookings'],
  ['households', '/households', 'households'],
  ['affiliates', '/affiliates', 'affiliates'],
];

(async () => {
  const { body: cat } = await req('/auth/local-demo-accounts');
  const accounts = cat?.accounts || [];
  if (!accounts.length) { console.log('  no demo accounts — is the API running with demo access on?'); process.exit(1); }

  const failures = [];
  let opened = 0;
  let refused = 0;

  for (const acct of accounts) {
    const label = acct.subRole ? `${acct.role}/${acct.subRole}` : acct.role;
    const { status, body } = await req('/auth/local-demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: acct.id }),
    });
    if (status !== 200 || !body?.accessToken) {
      failures.push(`${label}: sign-in returned ${status}`);
      console.log(`  ${label.padEnd(20)} SIGN-IN FAILED (${status})`);
      continue;
    }
    const auth = { Authorization: `Bearer ${body.accessToken}` };

    const got = [];
    for (const [module, probe, routeFile] of SCREENS) {
      const guard = guardFor(routeFile) || module;
      const allowed = can(acct.role, acct.subRole, guard);
      const r = await req(probe, { headers: auth });

      if (allowed && r.status === 200) { opened += 1; got.push(module); }
      else if (allowed) { failures.push(`${label}: ${module} is offered but returned ${r.status}`); }
      else if (r.status === 403 || r.status === 401) { refused += 1; }
      else if (r.status === 200) { failures.push(`${label}: ${module} not permitted (${guard}) but server returned 200`); }
      else { refused += 1; }
    }
    console.log(`  ${label.padEnd(20)} ${String(got.length).padStart(2)} screens open   ${acct.facility?.name || ''}`);
  }

  console.log('');
  console.log(`  offered and working : ${opened}`);
  console.log(`  correctly refused   : ${refused}`);

  if (failures.length) {
    console.log('');
    console.log('  FAILURES:');
    for (const f of failures) console.log(`    ${f}`);
    process.exit(1);
  }
  console.log('  every screen a role is offered opens, and every screen it is not is refused');
  process.exit(0);
})();
