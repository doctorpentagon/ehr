/**
 * Awibi Scout — search.
 *
 * The requirement was blunt: no picking from lists. Type anything, in any
 * shape, and the right thing comes back — at ten entries or ten thousand.
 *
 * That is a resolution ladder, not one algorithm. Each layer answers a
 * different kind of failure, and a query stops at the first layer confident
 * enough to answer it:
 *
 *   L0  bridge    "how many drops"     phrase people actually say
 *   L1  exact     "curb-65"            the word is in the index
 *   L2  prefix    "tetan…"             still typing
 *   L3  trigram   "ketoacid"           part of a longer word
 *   L4  fuzzy     "diabetis"           misspelled
 *   L5  facet     "shock"              a category, not an entry
 *
 * Everything is built once, in memory, from an index of ~160 entries and scales
 * to thousands: the inverted index and gram map are hash lookups, and the only
 * scan is over postings already narrowed by the query.
 */

// ── Normalisation ───────────────────────────────────────────────────────────

/**
 * One spelling for the index and the query.
 *
 * Accents are stripped, punctuation becomes space, and British and American
 * forms are folded together — somebody typing "anemia" must find "anaemia",
 * and the corpus uses both.
 */
const SPELLING_FOLD = [
  [/\bhaem/g, 'hem'], [/\banaem/g, 'anem'], [/\boesoph/g, 'esoph'],
  [/\bdiarrhoea/g, 'diarrhea'], [/\boedema/g, 'edema'], [/\bfoetal/g, 'fetal'],
  [/\bpaediatric/g, 'pediatric'], [/\bgynaec/g, 'gynec'], [/\bsulph/g, 'sulf'],
  [/\bleuc/g, 'leuk'], [/\bcaesar/g, 'cesar'], [/\bhaemat/g, 'hemat'],
];

export function normalise(text) {
  let s = String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (d) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(d))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const [from, to] of SPELLING_FOLD) s = s.replace(from, to);
  return s;
}

export function tokenise(text) {
  const n = normalise(text);
  return n ? n.split(' ').filter((t) => t.length > 0) : [];
}

/**
 * Padded character trigrams.
 *
 * The padding is what makes prefixes work: "tb" alone yields no 3-character
 * window, but "  tb " yields "  t", " tb", "tb ". Without it every short token
 * is invisible to this layer.
 */
function trigrams(token) {
  const padded = `  ${token} `;
  const grams = [];
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.push(padded.slice(i, i + 3));
  return grams;
}

/** Damerau-Levenshtein, bailing out as soon as it exceeds what we allow. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = [];
  let prev = [];
  let cur = [];
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // Transposition: "hemorrage" vs "hemorrhage".
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] ?? Infinity) + cost);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length];
}

// ── Index ───────────────────────────────────────────────────────────────────

/**
 * Field weights from the content spec. A hit in a title means far more than the
 * same word buried in a summary, and without weighting a common word in a long
 * summary outranks the entry actually named that.
 */
const FIELD_WEIGHTS = { t: 8, s: 6, a: 5, k: 4, m: 2 };
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function buildIndex(payload) {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const entries = payload.entries || [];

  const postings = new Map();     // token  -> Map<entryIdx, weightedTermFreq>
  const gramMap = new Map();      // 3-gram -> Set<entryIdx>
  const vocabulary = new Set();   // every token, for prefix and fuzzy
  const docLength = new Float32Array(entries.length);
  const bySlug = new Map();
  const byType = new Map();

  entries.forEach((entry, idx) => {
    bySlug.set(entry.g, idx);
    if (!byType.has(entry.y)) byType.set(entry.y, []);
    byType.get(entry.y).push(idx);

    let length = 0;
    const addField = (text, weight, alsoTrigram) => {
      for (const token of tokenise(text)) {
        vocabulary.add(token);
        length += weight;
        let posting = postings.get(token);
        if (!posting) { posting = new Map(); postings.set(token, posting); }
        posting.set(idx, (posting.get(idx) || 0) + weight);

        // Only short, identifying fields are trigrammed. Trigramming summaries
        // would multiply the index and destroy precision — every entry shares
        // grams with every other.
        if (alsoTrigram) {
          for (const gram of trigrams(token)) {
            let set = gramMap.get(gram);
            if (!set) { set = new Set(); gramMap.set(gram, set); }
            set.add(idx);
          }
        }
      }
    };

    addField(entry.t, FIELD_WEIGHTS.t, true);
    addField(entry.s, FIELD_WEIGHTS.s, true);
    (entry.a || []).forEach((x) => addField(x, FIELD_WEIGHTS.a, true));
    (entry.k || []).forEach((x) => addField(x, FIELD_WEIGHTS.k, true));
    addField(entry.m, FIELD_WEIGHTS.m, false);

    docLength[idx] = length;
  });

  const avgLength = docLength.reduce((s, v) => s + v, 0) / (entries.length || 1);

  // Bridges are keyed by the phrase people actually say.
  const bridges = new Map(
    Object.entries(payload.bridges || {}).map(([phrase, target]) => [normalise(phrase), target]),
  );

  const vocabList = [...vocabulary];

  return {
    entries,
    postings,
    gramMap,
    vocabulary,
    vocabList,
    docLength,
    avgLength,
    bySlug,
    byType,
    bridges,
    types: payload.types || [],
    ui: payload.ui || {},
    version: payload.version,
    buildMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started) * 10) / 10,
  };
}

// ── Retrieval ───────────────────────────────────────────────────────────────

function bm25(index, token, scores) {
  const posting = index.postings.get(token);
  if (!posting) return false;
  const idf = Math.log(1 + (index.entries.length - posting.size + 0.5) / (posting.size + 0.5));
  for (const [idx, tf] of posting) {
    const norm = tf / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (index.docLength[idx] / index.avgLength)));
    scores.set(idx, (scores.get(idx) || 0) + idf * norm * (BM25_K1 + 1));
  }
  return true;
}

/** Tokens starting with a prefix, capped so a single letter cannot scan everything. */
function prefixMatches(index, prefix, limit = 40) {
  const out = [];
  for (const token of index.vocabList) {
    if (token.startsWith(prefix)) {
      out.push(token);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Jaccard over trigrams — the layer that makes part-words work. */
function trigramCandidates(index, token, threshold = 0.3) {
  const grams = trigrams(token);
  const hits = new Map();
  for (const gram of grams) {
    const set = index.gramMap.get(gram);
    if (!set) continue;
    for (const idx of set) hits.set(idx, (hits.get(idx) || 0) + 1);
  }
  const out = [];
  for (const [idx, shared] of hits) {
    const score = shared / grams.length;
    if (score >= threshold) out.push([idx, score]);
  }
  return out;
}

function fuzzyMatches(index, token) {
  const max = token.length <= 5 ? 1 : 2;
  const out = [];
  for (const candidate of index.vocabList) {
    if (Math.abs(candidate.length - token.length) > max) continue;
    const d = editDistance(token, candidate, max);
    if (d <= max) out.push([candidate, d]);
  }
  return out.sort((a, b) => a[1] - b[1]).slice(0, 8);
}

/**
 * Run a query.
 *
 * Returns the results and, deliberately, *how* they were found — the interface
 * says "showing partial matches" or "did you mean", so somebody can tell an
 * exact answer from a guess. Presenting a fuzzy match as though it were exact
 * is how the wrong number gets used on a ward.
 */
export function search(index, rawQuery, options = {}) {
  const { type = null, calculatorsOnly = false, limit = 40 } = options;
  const query = normalise(rawQuery);

  const applyFilters = (results) => results.filter(({ entry }) => {
    if (type && entry.y !== type) return false;
    if (calculatorsOnly && !entry.c) return false;
    return true;
  });

  const pack = (scored, state, note = null) => {
    const results = scored
      .sort((a, b) => b[1] - a[1])
      .map(([idx, score]) => ({ entry: index.entries[idx], score }));
    return { state, note, results: applyFilters(results).slice(0, limit), query: rawQuery };
  };

  // Empty query: browse, not search.
  if (!query) {
    const all = index.entries.map((e, idx) => [idx, 0]);
    return { ...pack(all, 'BROWSE'), results: applyFilters(index.entries.map((entry) => ({ entry, score: 0 }))).slice(0, limit) };
  }

  // ── L0 bridge — the whole phrase, before anything is tokenised ────────────
  const bridge = index.bridges.get(query);
  if (bridge) {
    const slug = typeof bridge === 'string' ? bridge : bridge.target_slug || bridge.slug;
    const idx = index.bySlug.get(slug);
    if (idx !== undefined) {
      return {
        state: 'BRIDGE',
        note: null,
        results: applyFilters([{ entry: index.entries[idx], score: 100 }]),
        query: rawQuery,
      };
    }
  }

  const tokens = tokenise(query);

  // ── L1 exact ──────────────────────────────────────────────────────────────
  const scores = new Map();
  let matchedAny = false;
  for (const token of tokens) {
    if (bm25(index, token, scores)) matchedAny = true;
  }

  // ── L2 prefix — the last token is probably still being typed ─────────────
  const last = tokens[tokens.length - 1];
  if (last && last.length >= 2 && !index.postings.has(last)) {
    for (const token of prefixMatches(index, last)) {
      const posting = index.postings.get(token);
      if (!posting) continue;
      matchedAny = true;
      for (const [idx, tf] of posting) {
        // Slightly discounted: a prefix is a guess at a word not yet finished.
        scores.set(idx, (scores.get(idx) || 0) + (tf / index.docLength[idx]) * 4);
      }
    }
  }

  // Whole-title match should always win.
  for (const [idx] of scores) {
    if (normalise(index.entries[idx].t) === query) scores.set(idx, scores.get(idx) + 30);
    else if (normalise(index.entries[idx].s || '') === query) scores.set(idx, scores.get(idx) + 20);
  }

  const strong = [...scores.entries()].filter(([, s]) => s > 0);
  if (strong.length >= 3 || (strong.length && matchedAny && tokens.every((t) => index.postings.has(t)))) {
    return pack(strong, 'EXACT');
  }

  // ── L3 trigram — part of a longer word ───────────────────────────────────
  const subword = new Map(scores);
  let subwordHit = false;
  for (const token of tokens) {
    if (token.length < 4) continue;
    for (const [idx, score] of trigramCandidates(index, token)) {
      subword.set(idx, (subword.get(idx) || 0) + score * 6);
      subwordHit = true;
    }
  }
  const subwordResults = [...subword.entries()].filter(([, s]) => s > 0);
  if (subwordResults.length) {
    return pack(
      subwordResults,
      strong.length ? 'EXACT' : 'SUBWORD',
      strong.length || !subwordHit ? null : `Showing partial matches for “${rawQuery}”`,
    );
  }

  // ── L4 fuzzy — probably a typo ───────────────────────────────────────────
  const fuzzy = new Map();
  const suggestions = new Set();
  for (const token of tokens) {
    if (token.length < 4) continue;
    for (const [candidate, distance] of fuzzyMatches(index, token)) {
      suggestions.add(candidate);
      const posting = index.postings.get(candidate);
      if (!posting) continue;
      for (const [idx, tf] of posting) {
        fuzzy.set(idx, (fuzzy.get(idx) || 0) + (tf / index.docLength[idx]) * (3 - distance));
      }
    }
  }
  const fuzzyResults = [...fuzzy.entries()].filter(([, s]) => s > 0);
  if (fuzzyResults.length) {
    const guess = [...suggestions][0];
    return pack(fuzzyResults, 'FUZZY', guess ? `Did you mean “${guess}”?` : null);
  }

  // ── L5 facet — a category name rather than an entry ──────────────────────
  const typeHit = index.types.find((t) => normalise(t).includes(query) || query.includes(normalise(t)));
  if (typeHit) {
    const idxs = index.byType.get(typeHit) || [];
    return pack(idxs.map((idx) => [idx, 1]), 'NAVIGATE', `Everything under ${typeHit.replace(/_/g, ' ')}`);
  }

  // ── Nothing. Say so plainly and offer a way forward ──────────────────────
  return { state: 'GAP', note: null, results: [], query: rawQuery };
}

/** As-you-type suggestions. Cheap enough to run on every keystroke. */
export function suggest(index, rawQuery, limit = 6) {
  const query = normalise(rawQuery);
  if (query.length < 2) return [];
  const { results } = search(index, rawQuery, { limit });
  return results.slice(0, limit).map((r) => ({
    slug: r.entry.g,
    title: r.entry.t,
    type: r.entry.y,
    isCalculator: r.entry.c,
  }));
}
