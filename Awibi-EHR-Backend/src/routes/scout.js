const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');

/**
 * Awibi Scout — clinical reference and calculators.
 *
 * Open to every signed-in member of staff. It is published reference material,
 * not patient data: a nurse checking a drip rate, a doctor checking a score, a
 * lab scientist checking a reference interval. Gating it by role would only
 * mean somebody looks the number up on their phone instead, which is the exact
 * failure this is meant to remove.
 *
 * Nothing here touches a patient record, so there is no facility scoping to do
 * beyond confirming the caller is signed in at all.
 */
const auth = [authenticate, tenant];

const DATA_DIR = path.join(__dirname, '..', 'data', 'scout');

/**
 * Read once, at boot, and keep in memory.
 *
 * The whole corpus is 769 KB. Reading it from disk per request would add
 * latency for no benefit, and the content only changes when the service is
 * redeployed. If the files are missing the routes report it plainly rather than
 * throwing on every call.
 */
function load(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Scout: ${name} is present but unreadable —`, e.message);
    return null;
  }
}

const manifest = load('scout-manifest.json');
const index = load('scout-index.json');
const entries = load('scout-entries.json');

const AVAILABLE = Boolean(manifest && index && entries);
if (!AVAILABLE) {
  console.warn('Scout: reference data not found. Run `node scripts/build-scout-data.js`.');
}

function unavailable(res) {
  return res.status(503).json({
    error: 'Scout reference data has not been built for this deployment',
    hint: 'Run scripts/build-scout-data.js and redeploy',
  });
}

/**
 * The content is immutable for the life of a deployment, so it can be cached
 * hard. A client that already holds this release never downloads it again —
 * which is the difference between Scout opening instantly and it costing 33 KB
 * of somebody's data every single time.
 */
function cacheForever(res, version) {
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('ETag', `"${version}"`);
}

/** Tiny. Lets a client decide whether it needs anything else at all. */
router.get('/manifest', auth, (req, res) => {
  if (!AVAILABLE) return unavailable(res);
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ ...manifest, available: true });
});

/**
 * Everything search reads, and nothing else — 33 KB gzipped.
 * Bodies are fetched one at a time when a card is opened.
 */
router.get('/index', auth, (req, res) => {
  if (!AVAILABLE) return unavailable(res);
  if (req.get('if-none-match') === `"${index.version}"`) return res.status(304).end();
  cacheForever(res, index.version);
  res.json(index);
});

/** One entry's full detail: body, inputs, logic, outputs, warnings, sources. */
router.get('/entry/:slug', auth, (req, res) => {
  if (!AVAILABLE) return unavailable(res);
  const entry = entries[req.params.slug];
  if (!entry) return res.status(404).json({ error: 'Not in the reference library' });
  cacheForever(res, `${manifest.release}:${req.params.slug}`);
  res.json(entry);
});

/**
 * Several entries at once, for the offline package.
 *
 * A device about to lose connectivity — a ward round in a building with no
 * signal, an outreach clinic — can pull everything it might need in one
 * request rather than 158 separate ones.
 */
router.post('/entries', auth, (req, res) => {
  if (!AVAILABLE) return unavailable(res);
  const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : null;

  // No list means the caller wants the lot, for offline use.
  if (!slugs) {
    cacheForever(res, manifest.release);
    return res.json({ release: manifest.release, entries });
  }
  if (slugs.length > 200) {
    return res.status(400).json({ error: 'Ask for at most 200 entries at a time', field: 'slugs' });
  }
  const found = Object.fromEntries(
    slugs.filter((s) => entries[s]).map((s) => [s, entries[s]]),
  );
  res.json({ release: manifest.release, entries: found, missing: slugs.filter((s) => !entries[s]) });
});

module.exports = router;
