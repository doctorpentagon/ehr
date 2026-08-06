/**
 * Confirm one facility cannot see or touch another facility's records.
 *
 * This is the property a government pilot is actually buying. Everything else
 * is a feature; this is the promise.
 *
 * The probe always runs from the facility that HAS data towards the one that
 * does not. An earlier version compared two listings and declared success when
 * they did not overlap — which is trivially true when one side is empty, and
 * proves nothing at all. The real question is whether a token from the empty
 * facility can fetch a populated facility's record by its exact id.
 */
const BASE = process.env.API || 'http://localhost:8000/v1';

/**
 * Present a distinct client address per request, so the rate limiter does not
 * turn a refused-for-the-right-reason 403 into an ambiguous 429. A 429 here
 * would be indistinguishable from correct isolation, which would let a real
 * leak pass as a pass.
 */
let ipCounter = 0;
function freshClientIp() {
  ipCounter += 1;
  return `2001:db8:${Date.now().toString(16)}::${ipCounter.toString(16)}`;
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'X-Forwarded-For': freshClientIp(), ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}

function rows(b) {
  if (Array.isArray(b)) return b;
  if (!b || typeof b !== 'object') return [];
  for (const key of ['data', 'patients', 'items', 'results', 'cases', 'appointments', 'staff', 'requests']) {
    if (Array.isArray(b[key])) return b[key];
  }
  // Fall back to the first array-valued property, whatever it is called.
  const arr = Object.values(b).find((v) => Array.isArray(v));
  return arr || [];
}

(async () => {
  const { body: cat } = await req('/auth/local-demo-accounts');
  const accounts = cat?.accounts || [];

  const admins = accounts.filter((a) => a.role === 'ADMIN' || a.role === 'SUPER_ADMIN');
  const byFacility = new Map();
  for (const a of admins) if (!byFacility.has(a.facility.id)) byFacility.set(a.facility.id, a);
  if (byFacility.size < 2) { console.log('  need two facilities'); process.exit(1); }

  async function signIn(acct) {
    const { body } = await req('/auth/local-demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: acct.id }),
    });
    return { Authorization: `Bearer ${body.accessToken}` };
  }

  const facilities = [];
  for (const acct of byFacility.values()) {
    facilities.push({ acct, auth: await signIn(acct), name: acct.facility.name });
  }

  const RESOURCES = ['/patients', '/cases', '/appointments', '/lab', '/staff'];
  const failures = [];
  let probesRun = 0;

  // Count what each facility can see, so the report shows the test had teeth.
  console.log('  rows visible to each facility:');
  const counts = {};
  for (const f of facilities) {
    counts[f.name] = {};
    const parts = [];
    for (const r of RESOURCES) {
      const { body } = await req(`${r}?limit=200`, { headers: f.auth });
      const n = rows(body).length;
      counts[f.name][r] = { n, body };
      parts.push(`${r.slice(1)}=${n}`);
    }
    console.log(`    ${f.name.padEnd(32)} ${parts.join('  ')}`);
  }

  console.log('');
  console.log('  cross-facility fetch by exact id (the test that matters):');

  for (const source of facilities) {
    for (const other of facilities) {
      if (other.name === source.name) continue;
      for (const resource of RESOURCES) {
        const record = rows(counts[source.name][resource].body)[0];
        if (!record?.id) continue;   // nothing to probe with

        probesRun += 1;
        const r = await req(`${resource}/${record.id}`, { headers: other.auth });
        const label = `${other.name} -> ${source.name}${resource}`;
        if (r.status === 200) {
          failures.push(`${label}: returned 200 (leaked record ${record.id})`);
          console.log(`    LEAK   ${label}  (200)`);
        } else if (r.status === 429) {
          // Never count a rate-limit as isolation. It proves only that the
          // request was not answered, which is exactly what a leak would also
          // look like from here — the one status that must not read as a pass.
          failures.push(`${label}: rate limited (429) — isolation was NOT proven for this probe`);
          console.log(`    ????   ${label.padEnd(58)} 429 — inconclusive`);
        } else {
          console.log(`    ok     ${label.padEnd(58)} refused ${r.status}`);
        }
      }
    }
  }

  console.log('');
  if (!probesRun) {
    console.log('  INCONCLUSIVE — no records existed to probe with, so nothing was proven.');
    process.exit(1);
  }
  if (failures.length) {
    console.log('  TENANT ISOLATION FAILURES:');
    for (const f of failures) console.log(`    ${f}`);
    process.exit(1);
  }
  console.log(`  tenant isolation holds — ${probesRun} cross-facility fetches, all refused`);
  process.exit(0);
})();
