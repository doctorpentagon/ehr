/**
 * Awibi Scout — loading and caching.
 *
 * Two rules drive this:
 *
 *   1. The search box must be usable on a bad connection. The index is 33 KB
 *      gzipped and is fetched once, then kept — a nurse opening Scout for the
 *      hundredth time should spend nothing.
 *   2. Bodies are ~5 KB each and only fetched when a card is opened.
 *
 * Cached in localStorage rather than IndexedDB: the payload is well inside the
 * 5 MB budget, and localStorage is synchronous, universally supported, and does
 * not need an upgrade dance. The cache key carries the content release, so new
 * content simply misses the old key instead of needing invalidation logic.
 */
import api from './api';
import { buildIndex } from './scoutSearch';

const INDEX_KEY = 'awibi.scout.index';
const ENTRY_PREFIX = 'awibi.scout.entry.';
const VERSION_KEY = 'awibi.scout.version';

let memoryIndex = null;
const memoryEntries = new Map();

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded, or private browsing. Scout still works, just without the
    // saving — never let a caching failure stop the feature loading.
    return false;
  }
}

/** Remove entries left behind by an earlier content release. */
function evictStaleEntries() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(ENTRY_PREFIX)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch { /* nothing to clean up */ }
}

/**
 * The search index, built and ready.
 *
 * Served from memory, then localStorage, then the network. Only the third
 * costs the user anything.
 */
export async function loadIndex({ onProgress } = {}) {
  if (memoryIndex) return memoryIndex;

  const cachedVersion = (() => { try { return localStorage.getItem(VERSION_KEY); } catch { return null; } })();
  const cached = cachedVersion ? readCache(INDEX_KEY) : null;

  if (cached && cached.version === cachedVersion) {
    onProgress?.({ stage: 'cache' });
    memoryIndex = buildIndex(cached);
    // Confirm in the background that this is still the current release. Never
    // block on it — a stale index that works beats a spinner that does not.
    api.get('/scout/manifest')
      .then(({ data }) => {
        if (data?.indexVersion && data.indexVersion !== cached.version) refreshIndex().catch(() => {});
      })
      .catch(() => { /* offline: carry on with what we have */ });
    return memoryIndex;
  }

  onProgress?.({ stage: 'download' });
  const { data } = await api.get('/scout/index');
  memoryIndex = buildIndex(data);

  evictStaleEntries();
  writeCache(INDEX_KEY, data);
  try { localStorage.setItem(VERSION_KEY, data.version); } catch { /* not cacheable */ }

  return memoryIndex;
}

/** Force a re-download, e.g. when the manifest reports newer content. */
export async function refreshIndex() {
  const { data } = await api.get('/scout/index');
  memoryIndex = buildIndex(data);
  memoryEntries.clear();
  evictStaleEntries();
  writeCache(INDEX_KEY, data);
  try { localStorage.setItem(VERSION_KEY, data.version); } catch { /* not cacheable */ }
  return memoryIndex;
}

/** One entry's full detail. Cached the same way, at about 5 KB each. */
export async function loadEntry(slug) {
  if (memoryEntries.has(slug)) return memoryEntries.get(slug);

  const cached = readCache(ENTRY_PREFIX + slug);
  if (cached) {
    memoryEntries.set(slug, cached);
    return cached;
  }

  const { data } = await api.get(`/scout/entry/${slug}`);
  memoryEntries.set(slug, data);
  writeCache(ENTRY_PREFIX + slug, data);
  return data;
}

/**
 * Pull the whole library down for offline use.
 *
 * For a ward round in a building with no signal, or an outreach clinic. One
 * request of ~200 KB rather than 158 separate ones.
 */
export async function downloadForOffline(onProgress) {
  onProgress?.({ stage: 'start' });
  const { data } = await api.post('/scout/entries', {});
  const all = data.entries || {};
  let stored = 0;
  for (const [slug, entry] of Object.entries(all)) {
    memoryEntries.set(slug, entry);
    if (writeCache(ENTRY_PREFIX + slug, entry)) stored += 1;
  }
  onProgress?.({ stage: 'done', stored, total: Object.keys(all).length });
  return { stored, total: Object.keys(all).length };
}

/** How much is already available without a network. */
export function offlineStatus() {
  let entries = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(ENTRY_PREFIX)) entries += 1;
    }
  } catch { /* cannot inspect storage */ }
  return { indexCached: Boolean(readCache(INDEX_KEY)), entriesCached: entries };
}

/** Free the space. */
export function clearCache() {
  try {
    evictStaleEntries();
    localStorage.removeItem(INDEX_KEY);
    localStorage.removeItem(VERSION_KEY);
  } catch { /* nothing to clear */ }
  memoryIndex = null;
  memoryEntries.clear();
}
