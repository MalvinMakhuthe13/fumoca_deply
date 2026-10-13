/**
 * FUMOCA Service Worker v93
 * Handles: offline caching, share_target file ingestion, PWA file_handler launch
 */

const CACHE_NAME    = 'fumoca-v93';
const PLAYER_ASSETS = [
  '/sdk/fumoc-player.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: pre-cache player assets ─────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PLAYER_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: drop old caches ─────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fall back to network ─────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── share_target POST handler ─────────────────────────────────────────────
  if (e.request.method === 'POST' && url.pathname === '/open') {
    e.respondWith((async () => {
      try {
        const fd   = await e.request.formData();
        const file = fd.get('fumoc') || fd.get('file');
        if (file && file instanceof File) {
          const cache = await caches.open(CACHE_NAME);
          const bytes = await file.arrayBuffer();
          await cache.put(
            '/fumoc-share-target-pending',
            new Response(bytes, { headers: { 'Content-Type': 'application/fumoc', 'X-Fumoc-Name': file.name } })
          );
          const bc = new BroadcastChannel('fumoc_share_target');
          bc.postMessage({ type: 'SHARED_FILE_READY', name: file.name });
        }
      } catch (err) {
        console.error('[SW v93] share target error:', err);
      }
      return Response.redirect('/open?share-target=1', 303);
    })());
    return;
  }

  // ── Always pass /open through to network (share_target & file_handler) ──
  if (url.pathname === '/open') {
    e.respondWith(fetch(e.request));
    return;
  }

  // ── Cache-first for player SDK assets ────────────────────────────────────
  if (PLAYER_ASSETS.some(a => url.pathname === a || url.pathname.startsWith('/sdk/'))) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(resp => {
          if (resp.ok) {
            const respClone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, respClone));
          }
          return resp;
        });
        return cached || fresh;
      })
    );
    return;
  }

  // ── Network-first for everything else ────────────────────────────────────
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', async e => {
  if (e.data?.type === 'GET_SHARED_FILE') {
    const cache  = await caches.open(CACHE_NAME);
    const cached = await cache.match('/fumoc-share-target-pending');
    const bc     = new BroadcastChannel('fumoc_share_target');
    if (cached) {
      const buf  = await cached.arrayBuffer();
      const name = cached.headers.get('X-Fumoc-Name') || 'scene.fumoc';
      bc.postMessage({ type: 'SHARED_FILE', buffer: buf, name });
      await cache.delete('/fumoc-share-target-pending');
    } else {
      bc.postMessage({ type: 'NO_SHARED_FILE' });
    }
  }

  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
