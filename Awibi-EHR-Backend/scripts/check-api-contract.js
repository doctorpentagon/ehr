/**
 * Check that every API path the frontend calls is a route the server serves.
 *
 * The two halves of this product are separate codebases that only meet over
 * HTTP, so nothing connects them at build time. Rename a backend route or mis-
 * type a path in a component and both sides still build, both test suites stay
 * green, and the defect surfaces as a 404 in front of whoever was using that
 * screen — often a screen nobody clicks until a demo.
 *
 * Routes are read from the live Express router stack rather than parsed out of
 * the source, because the stack is what actually answers requests. An earlier
 * regex-based version of this check reported all 161 calls as broken when in
 * fact it had simply failed to find the routes.
 *
 * What this cannot catch: a mistyped path that still lines up with a
 * parameterised route. `GET /lab/statistics` matches `GET /lab/:id` on shape,
 * so it is reported as fine even though the server will look for a lab request
 * whose id is the word "statistics" and find nothing. Structural agreement is
 * all that is checked here — that a call reaches *a* handler, not that it
 * reaches the right one. Only the smoke suite, which sends real requests and
 * reads the responses, can tell those apart.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'y'.repeat(48);

const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..');
const FRONTEND = path.join(BACKEND, '..', 'Awibi-EHR-Frontend', 'src');

if (!fs.existsSync(FRONTEND)) {
  console.log('  frontend not present beside the backend — nothing to check');
  process.exit(0);
}

// eslint-disable-next-line import/no-dynamic-require, global-require
const app = require(path.join(BACKEND, 'src', 'app.js'));

// ---- every route the server actually serves --------------------------------
const backend = new Set();

/** Recover the mount prefix from the regexp Express builds for a sub-router. */
function prefixOf(re) {
  const m = re.toString().match(/^\/\^\\\/([^\\]*)/);
  return m ? `/${m[1]}` : '';
}

function walkStack(stack, prefix) {
  for (const layer of stack) {
    if (layer.route) {
      const routePath = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      for (const method of Object.keys(layer.route.methods)) {
        if (layer.route.methods[method]) backend.add(`${method.toUpperCase()} ${routePath}`);
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      walkStack(layer.handle.stack, prefix + prefixOf(layer.regexp));
    }
  }
}

walkStack(app._router.stack, '');

// ---- every call the frontend makes -----------------------------------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const calls = new Map();
for (const file of walk(FRONTEND)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(/\bapi\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    const raw = m[2];
    if (!raw.startsWith('/')) continue;   // fully-qualified URLs go elsewhere
    const key = `${m[1].toUpperCase()} ${raw}`;
    if (!calls.has(key)) calls.set(key, new Set());
    calls.get(key).add(path.relative(FRONTEND, file).replace(/\\/g, '/'));
  }
}

/**
 * A call matches a route when the methods agree, the segment counts agree, and
 * every literal segment agrees. Interpolated values in the call and :params in
 * the route are both wildcards.
 */
function matches(call) {
  const [method, rawUrl] = call.split(' ');
  const url = rawUrl.split('?')[0].replace(/\$\{[^}]*\}/g, '*').replace(/\/+$/, '');
  const parts = url.split('/').filter(Boolean);

  for (const route of backend) {
    const [routeMethod, routePath] = route.split(' ');
    if (routeMethod !== method) continue;
    const routeParts = (routePath || '').replace(/^\/v1/, '').split('/').filter(Boolean);
    if (routeParts.length !== parts.length) continue;

    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (routeParts[i].startsWith(':') || parts[i] === '*') continue;
      if (routeParts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

const missing = [...calls.keys()].filter((call) => !matches(call)).sort();

console.log(`  backend routes served   : ${backend.size}`);
console.log(`  distinct frontend calls : ${calls.size}`);

if (missing.length) {
  console.error('');
  console.error(`  ${missing.length} frontend call(s) have no matching backend route:`);
  for (const call of missing) {
    console.error(`    ${call}`);
    console.error(`        ${[...calls.get(call)].slice(0, 3).join(', ')}`);
  }
  console.error('');
  console.error('  Each of these is a 404 waiting for whoever opens that screen.');
  process.exit(1);
}

console.log('  contract OK — every frontend call resolves to a served route');
process.exit(0);
