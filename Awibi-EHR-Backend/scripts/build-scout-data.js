/**
 * Prepare the Awibi Scout corpus for serving.
 *
 * The source corpus is 766 KB. Sending that to a phone on a Nigerian mobile
 * connection before the user can type a single character would make the feature
 * feel broken, so it is split by what search actually needs:
 *
 *   index.json    116 KB raw / 31 KB gzipped — every field search reads, and
 *                 nothing else. Loads once, cached, and the search box is live.
 *   entries.json  the full bodies, served one at a time at ~5 KB each, only
 *                 when somebody opens a card.
 *
 * Run after any content update:  node scripts/build-scout-data.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'AWIBI SCOUT', 'LATEST VERSION 4');
const OUT_DIR = path.join(__dirname, '..', 'src', 'data', 'scout');

function read(name) {
  const file = path.join(SOURCE_DIR, name);
  if (!fs.existsSync(file)) {
    console.error(`\nMissing source file: ${file}`);
    console.error('This script reads from the AWIBI SCOUT folder, which is not committed.\n');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const corpus = read('awibi_scout_entries_v4.json');
const searchSpec = read('awibi_scout_search_v4.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

/**
 * Short keys throughout. Over 158 entries the field names alone would be ~18 KB
 * of the payload, which is a meaningful fraction of a 31 KB download.
 */
const index = corpus.entries.map((e) => ({
  i: e.id,
  t: e.title,
  s: e.short_title || null,
  g: e.slug,
  y: e.type,
  m: e.summary || '',
  k: (e.search && e.search.terms) || [],
  a: e.also_known_as || [],
  h: e.hazard || 'low',
  u: e.urgency || 'routine',
  d: e.domains || [],
  n: e.intents || [],
  // Can this entry actually compute, or does it only describe its formula?
  //
  // 14 entries carry an executable expression tree. 6 carry `logic.note` — the
  // formula written out for a person to follow. Both are useful, but only the
  // first can be offered as a working calculator, and badging the other six as
  // calculators would send somebody to a form that cannot produce an answer.
  c: Boolean(e.logic && e.logic.op),
  // Has a written formula to display even though it cannot be computed.
  w: Boolean(e.logic && !e.logic.op && e.logic.note),
  // Counts, so a card can say what is inside before the body is fetched.
  f: (e.flashcards || []).length,
  x: (e.checkboxes || []).length,
}));

// Bodies keyed by slug — the API serves one at a time.
const entries = Object.fromEntries(corpus.entries.map((e) => [e.slug, e]));

const manifest = {
  release: corpus.release,
  schemaVersion: corpus.schema_version,
  buildDate: corpus.build_date,
  entryCount: corpus.entry_count,
  // types is a map of name -> provenance note; the UI only needs the names.
  types: Object.keys(corpus.types || {}),
  // The client stores this and skips the download entirely when it matches.
  indexVersion: `${corpus.release}:${corpus.entries.length}`,
};

const bridges = searchSpec.concept_bridges || {};
const ui = {
  placeholders: searchSpec.search_placeholders || [],
  emptyStateChips: searchSpec.empty_state_chips || [],
  fieldWeights: (searchSpec.index_spec && searchSpec.index_spec.field_weights) || {},
  boosts: (searchSpec.index_spec && searchSpec.index_spec.boosts) || {},
};

const payloads = {
  'scout-manifest.json': { ...manifest, bridgeCount: Object.keys(bridges).length },
  'scout-index.json': { version: manifest.indexVersion, types: manifest.types, entries: index, bridges, ui },
  'scout-entries.json': entries,
};

console.log('\nAwibi Scout — data build\n');
for (const [name, data] of Object.entries(payloads)) {
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT_DIR, name), json);
  const gz = zlib.gzipSync(json, { level: 9 }).length;
  console.log(`  ${name.padEnd(22)} ${String((json.length / 1024).toFixed(0)).padStart(4)} KB raw   ${String((gz / 1024).toFixed(0)).padStart(3)} KB gzipped`);
}

console.log('');
console.log(`  ${manifest.entryCount} entries · ${manifest.types.length} types · ${Object.keys(bridges).length} concept bridges`);
console.log(`  ${index.filter((e) => e.c).length} of them compute something`);
console.log(`  release ${manifest.release}\n`);
