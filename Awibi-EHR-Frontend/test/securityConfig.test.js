import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('Vercel applies a restrictive CSP without unsafe eval', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const catchAll = config.headers.find((entry) => entry.source === '/(.*)');
  const csp = catchAll?.headers.find((header) => header.key === 'Content-Security-Policy')?.value || '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('startup code is external so CSP does not block it', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  assert.ok(scripts.every((attributes) => /\bsrc=/.test(attributes)), 'index.html contains inline JavaScript');
  assert.match(html, /rel="manifest" href="\/manifest\.json"/);
});

test('robots and manifest use real local assets and their true dimensions', () => {
  const robots = fs.readFileSync(path.join(root, 'public', 'robots.txt'), 'utf8');
  assert.match(robots, /User-agent:\s*\*/i);
  assert.match(robots, /Disallow:\s*\//i);

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.json'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = fs.readFileSync(path.join(root, 'public', icon.src.replace(/^\//, '')));
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
    const actual = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
    assert.equal(icon.sizes, actual, `${icon.src} declares the wrong dimensions`);
  }
});

test('dashboard routes are lazy and the duplicate auth store is gone', () => {
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  assert.match(app, /const Lab = React\.lazy\(\(\) => import\('\.\/pages\/lab\/Lab'\)\)/);
  assert.match(app, /const Pharmacy = React\.lazy/);
  assert.equal(fs.existsSync(path.join(root, 'src', 'stores', 'authStore.js')), false);

  const sourceFiles = [];
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.jsx?$/.test(entry.name)) sourceFiles.push(file);
  });
  walk(path.join(root, 'src'));
  assert.deepEqual(sourceFiles.filter((file) => /useAuthStore|stores\/authStore/.test(fs.readFileSync(file, 'utf8'))), []);
});
