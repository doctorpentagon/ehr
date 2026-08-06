/**
 * Fail the build when a file uses an identifier it never imports.
 *
 * The bundler will not catch this. An unknown capitalised name is assumed to be
 * a global it cannot see, so the build succeeds and the failure appears only
 * when that line executes. When the line sits at module scope — an icon lookup
 * table, a config object — the module throws the moment it is imported, React
 * never mounts, and the whole application is a blank page with nothing in the
 * UI to say why.
 *
 * That is not hypothetical: five icons were added to the sidebar's lookup table
 * while the import statement that supplied them was never written. Build green,
 * API tests green, product dead on arrival.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'src';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Provided by the browser or the JSX runtime — never imported. */
const AMBIENT = new Set([
  'React', 'Fragment', 'Suspense', 'StrictMode', 'Math', 'JSON', 'Object',
  'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Map', 'Set',
  'Error', 'RegExp', 'Intl', 'Infinity', 'NaN', 'FormData', 'Blob', 'File',
  'URL', 'URLSearchParams', 'AbortController', 'Image', 'Audio', 'Notification',
  'Response', 'Request', 'Headers', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt',
  'Proxy', 'Reflect', 'TextEncoder', 'TextDecoder', 'MutationObserver',
  'IntersectionObserver', 'ResizeObserver', 'Event', 'CustomEvent',
]);

const files = walk(ROOT);
const problems = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');

  const imported = new Set();
  for (const m of source.matchAll(/import\s+([^;]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      braced[1].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) imported.add(name);
      });
    }
    // Default and namespace imports: `Foo`, `* as Foo`
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    bare.split(/\s+/).forEach((n) => { if (n && n !== '*' && n !== 'as') imported.add(n); });
  }

  const declared = new Set(
    [...source.matchAll(/(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]),
  );

  // Destructured bindings, from assignments and parameter lists alike:
  //   const { Foo } = ...        function Bar({ icon: Icon })
  //   ({ icon: Icon }) => ...    .map(({ icon: Icon }) => ...)
  // A renamed destructure such as `icon: Icon` is the most common way a
  // capitalised name legitimately appears without an import.
  for (const m of source.matchAll(/\{([^{}]*)\}\s*(?:=[^=>]|\)|,|=>)/g)) {
    m[1].split(',').forEach((part) => {
      const name = part.trim().split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) declared.add(name);
    });
  }

  const used = new Set([
    // JSX element names — <Foo>, <Foo/>, <Foo.Bar>
    ...[...source.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>.]/g)].map((m) => m[1]),
    // Object-literal values — `Compass: IconCompass,`
    ...[...source.matchAll(/^\s+[A-Za-z0-9_]+:\s+([A-Z][A-Za-z0-9_]+),?\s*$/gm)].map((m) => m[1]),
  ]);

  const missing = [...used].filter(
    (name) => !imported.has(name) && !declared.has(name) && !AMBIENT.has(name),
  );

  if (missing.length) {
    problems.push({ file: file.replace(/\\/g, '/'), missing: [...new Set(missing)] });
  }
}

for (const problem of problems) {
  console.error(`  ${problem.file}`);
  console.error(`      used but never imported: ${problem.missing.join(', ')}`);
}

if (problems.length) {
  console.error('');
  console.error(`  ${problems.length} file(s) reference identifiers that do not exist.`);
  console.error('  These do not fail the bundler — they fail in the browser, at runtime.');
  process.exit(1);
}

console.log(`  imports OK — ${files.length} files, no unresolved identifiers`);
