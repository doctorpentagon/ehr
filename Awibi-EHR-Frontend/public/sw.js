const CACHE_NAME = 'awibi-ehr-v1';

// Install — skip waiting so the new SW activates immediately
self.addEventListener('install', () => self.skipWaiting());

// Activate — claim all open tabs
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

// Fetch strategy:
//   API calls (/v1/*) — always network; the page handles offline queuing
//   Navigation — network first, fall back to cached index.html (SPA shell)
//   Static assets — cache first, update in background
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/v1/')) return; // let api.js handle it

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/index.html').then((r) => r || new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // Cache-first for GET assets
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const network = fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        });
        return cached || network;
      })
    );
  }
});

// Background Sync — tell open tabs to flush the IndexedDB queue
self.addEventListener('sync', (e) => {
  if (e.tag === 'awibi-sync') {
    e.waitUntil(
      self.clients.matchAll().then((clients) =>
        clients.forEach((c) => c.postMessage({ type: 'SYNC_QUEUE' }))
      )
    );
  }
});
