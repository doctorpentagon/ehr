/**
 * Fail the build when a sidebar entry points at a route that does not exist.
 *
 * Nothing catches this on its own. The page component can be fully written and
 * even imported, the nav entry can look perfectly correct, and the build still
 * succeeds — the two halves simply never meet. The only symptom is a user
 * clicking a menu item and landing on "page not found", which reads as a broken
 * product rather than a missing line of wiring.
 *
 * That already happened once: the Encounter types screen existed as a complete
 * 16KB page, was imported in App.jsx, and was linked in the sidebar, but no
 * <Route> was ever declared for it.
 *
 * Also reports the reverse — a page imported into App.jsx but never routed —
 * because that is the same wiring gap seen from the other side.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || 'src';
const appFile = path.join(SRC, 'App.jsx');
const navFile = path.join(SRC, 'lib', 'permissions.js');

const app = fs.readFileSync(appFile, 'utf8');
const nav = fs.readFileSync(navFile, 'utf8');

// Route paths declared anywhere in App.jsx, normalised to absolute form.
// Child routes are relative to the /dashboard parent they are nested under.
const declared = new Set();
for (const m of app.matchAll(/<Route\s+[^>]*path="([^"]*)"/g)) {
  const value = m[1];
  if (value === '*' || value === '') continue;
  declared.add(value.startsWith('/') ? value : `/dashboard/${value}`);
}
declared.add('/dashboard');

const problems = [];

// Every path the sidebar can send a user to must resolve.
for (const m of nav.matchAll(/path:\s*'([^']+)'/g)) {
  const target = m[1];
  if (!declared.has(target)) {
    problems.push(`nav entry "${target}" has no matching <Route> — clicking it lands on Not Found`);
  }
}

// A page imported but never rendered is a screen nobody can reach.
for (const m of app.matchAll(/^import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+'\.\/pages\/[^']+';$/gm)) {
  const component = m[1];
  const rendered = new RegExp(`<${component}\\s*/?>`).test(app);
  if (!rendered) {
    problems.push(`page "${component}" is imported in App.jsx but never rendered by any route`);
  }
}

for (const problem of problems) console.error(`  ${problem}`);

if (problems.length) {
  console.error('');
  console.error(`  ${problems.length} routing gap(s). These do not fail the bundler — users find them.`);
  process.exit(1);
}

console.log(`  routes OK — ${declared.size} routes, every nav target resolves`);
