/**
 * Offline support.
 *
 * The previous version cached every GET response cache-first, under a cache
 * name that never changed, and never deleted anything. On a build with hashed
 * filenames that is a trap you cannot escape from inside the browser:
 *
 *   1. index.html is cached, pointing at index-ABC.js
 *   2. a deploy replaces it with index-XYZ.js; ABC no longer exists
 *   3. the cached index.html is served, asks for ABC, gets a 404
 *   4. the application never starts — and the cache never expires, so every
 *      later visit repeats step 3 forever
 *
 * Two rules prevent that:
 *
 *   HTML is never served from cache while the network is reachable. It is the
 *   document that names every other file, so a stale copy poisons everything.
 *
 *   Hashed assets under /assets/ may be cached indefinitely, because their name
 *   changes whenever their content does. A stale one is impossible.
 *
 * The cache name carries a version. Bump it and every older cache is deleted on
 * activation, which is the escape hatch the previous version lacked.
 */
const VERSION = 'v3';
const CACHE_NAME = `awibi-ehr-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Remove every cache this app has ever written except the current one.
    // Without this, a bad cache from an earlier release survives indefinitely.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('awibi-ehr-') && n !== CACHE_NAME)
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

/** Files whose name changes with their content — safe to keep indefinitely. */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/assets/')
    && /\.[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|svg)$/.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // The API is never cached — the page handles offline queuing itself.
  if (url.pathname.startsWith('/v1/')) return;
  if (e.request.method !== 'GET') return;
  // Only this origin. Fonts and third parties manage their own caching.
  if (url.origin !== self.location.origin) return;

  const isDocument = e.request.mode === 'navigate'
    || e.request.destination === 'document'
    || url.pathname === '/'
    || url.pathname.endsWith('.html');

  if (isDocument) {
    // Network first. The cached copy exists only so the app still opens with
    // no connection at all, and it is refreshed on every successful load.
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('/index.html', fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>'
          + '<body style="font-family:system-ui;padding:2rem">'
          + '<h1>No connection</h1><p>Awibi EHR needs to reach the network to start.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html' } },
        );
      }
    })());
    return;
  }

  if (isImmutableAsset(url)) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      const fresh = await fetch(e.request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(e.request, fresh.clone());
      }
      return fresh;
    })());
    return;
  }

  // Everything else — favicons, the manifest, anything unhashed — goes to the
  // network and falls back to cache only if the network fails. An unhashed file
  // can change under the same name, so serving it from cache first is exactly
  // the mistake that caused this.
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(e.request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      throw new Error('offline and not cached');
    }
  })());
});

// Background Sync — tell open tabs to flush the offline queue.
self.addEventListener('sync', (e) => {
  if (e.tag === 'awibi-sync') {
    e.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'awibi-flush-queue' }));
      }),
    );
  }
});

// Lets the page force an update rather than waiting for a navigation.
self.addEventListener('message', (e) => {
  if (e.data === 'awibi-skip-waiting') self.skipWaiting();
});
