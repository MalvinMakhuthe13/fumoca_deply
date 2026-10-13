/**
 * FUMOCA Service Worker v94
 * Handles: offline caching, share_target file ingestion, PWA file_handler launch
 *
 * Public showroom/viewer routes are network-only so shared links work
 * for first-time visitors and are never blocked by stale offline cache.
 */

const CACHE_NAME = 'fumoca-v94';

const PLAYER_ASSETS = [
  '/sdk/fumoc-player.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const NETWORK_ONLY_PATHS = new Set([
  '/showroom.html',
  '/viewer',
  '/viewer-core.html',
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PLAYER_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Public showroom/viewer routes must always use the network.
  if (
    request.method === 'GET' &&
    NETWORK_ONLY_PATHS.has(url.pathname)
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // Share-target POST handler.
  if (request.method === 'POST' && url.pathname === '/open') {
    event.respondWith((async () => {
      try {
        const fd = await request.formData();
        const file = fd.get('fumoc') || fd.get('file');

        if (file && file instanceof File) {
          const cache = await caches.open(CACHE_NAME);
          const bytes = await file.arrayBuffer();

          await cache.put(
            '/fumoc-share-target-pending',
            new Response(bytes, {
              headers: {
                'Content-Type': 'application/fumoc',
                'X-Fumoc-Name': file.name,
              },
            })
          );

          const bc = new BroadcastChannel('fumoc_share_target');

          bc.postMessage({
            type: 'SHARED_FILE_READY',
            name: file.name,
          });

          bc.close();
        }
      } catch (err) {
        console.error('[SW v94] share target error:', err);
      }

      return Response.redirect('/open?share-target=1', 303);
    })());

    return;
  }

  // Always pass /open through to the network.
  if (url.pathname === '/open') {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for player SDK assets.
  if (
    request.method === 'GET' &&
    PLAYER_ASSETS.some(
      asset =>
        url.pathname === asset ||
        url.pathname.startsWith('/sdk/')
    )
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fresh = fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();

              caches.open(CACHE_NAME)
                .then(cache => cache.put(request, clone))
                .catch(() => {});
            }

            return response;
          });

        return cached || fresh;
      })
    );

    return;
  }

  // Network-first for everything else.
  // Always return an actual Response if both network and cache fail.
  event.respondWith(
    fetch(request)
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) {
          return cached;
        }

        return new Response(
          'FUMOCA resource unavailable offline.',
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
            },
          }
        );
      })
  );
});

self.addEventListener('message', async event => {
  if (event.data?.type === 'GET_SHARED_FILE') {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match('/fumoc-share-target-pending');

    const bc = new BroadcastChannel('fumoc_share_target');

    if (cached) {
      const buf = await cached.arrayBuffer();

      const name =
        cached.headers.get('X-Fumoc-Name') ||
        'scene.fumoc';

      bc.postMessage({
        type: 'SHARED_FILE',
        buffer: buf,
        name,
      });

      await cache.delete('/fumoc-share-target-pending');
    } else {
      bc.postMessage({
        type: 'NO_SHARED_FILE',
      });
    }

    bc.close();
  }

  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
