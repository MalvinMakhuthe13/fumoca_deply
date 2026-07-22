/**
 * FUMOCA Offline Helper v1
 * ══════════════════════════════════════════════════════════════════════════
 * Registers the demo-resilience service worker and exposes a small API
 * the viewer / demo pages can use to pre-cache splats before a meeting.
 *
 * Usage
 * ─────
 *   <script type="module">
 *     import { ensureServiceWorker, prefetchSplat, isOnline, onNetworkChange }
 *       from './js/modules/offline-helper.js';
 *     ensureServiceWorker();
 *   </script>
 *
 * Pre-caching a splat for tomorrow's demo:
 *   await prefetchSplat({
 *     splatUrl: 'https://pub-xxx.r2.dev/splats/abc/point_cloud.ply',
 *     thumbnailUrl: '...',
 *     previewUrl: '...',
 *   });
 *
 * Notes
 * ─────
 *   - All functions are no-ops on browsers without service worker support
 *     (older iOS, in-app browsers). The app keeps working without offline
 *     caching — you just don't get resilience.
 *   - prefetchSplat returns before the actual caching completes — the SW
 *     does the work in the background. Use onPrefetchResult if you need
 *     to know it finished.
 * ══════════════════════════════════════════════════════════════════════════
 */

let _swReady = null;
const _prefetchListeners = new Set();

/**
 * Register the service worker. Idempotent — safe to call from every page.
 * Returns a promise that resolves when the SW is ready to receive messages.
 */
export function ensureServiceWorker() {
  if (_swReady) return _swReady;
  if (!('serviceWorker' in navigator)) {
    console.info('[offline-helper] Service workers not supported in this browser');
    _swReady = Promise.resolve(null);
    return _swReady;
  }

  _swReady = (async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      // Wait until a SW is actually in control of this page. A freshly-
      // registered SW doesn't take control until the next navigation,
      // unless skipWaiting + clients.claim is used (ours does).
      if (navigator.serviceWorker.controller) {
        return reg;
      }
      // First install path — wait for the controlling SW.
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        // Safety timeout: don't block forever if something goes sideways.
        setTimeout(resolve, 3000);
      });
      return reg;
    } catch (err) {
      console.warn('[offline-helper] SW registration failed:', err);
      return null;
    }
  })();

  // Listen for prefetch results regardless of who subscribes.
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const data = ev.data;
    if (!data) return;
    if (data.type === 'PREFETCH_RESULT') {
      for (const fn of _prefetchListeners) {
        try { fn(data.results); } catch (_) {}
      }
    }
  });

  return _swReady;
}

/**
 * Tell the service worker to pre-cache these URLs. Useful before a demo
 * you know you want to show later with bad network.
 *
 * Accepts a single URL string OR an object with any subset of
 * { splatUrl, thumbnailUrl, previewUrl, extraUrls: [] }.
 */
export async function prefetchSplat(arg) {
  const reg = await ensureServiceWorker();
  if (!reg || !navigator.serviceWorker.controller) {
    console.info('[offline-helper] No controlling SW — skipping prefetch');
    return { supported: false };
  }
  let urls = [];
  if (typeof arg === 'string') urls = [arg];
  else if (arg && typeof arg === 'object') {
    urls = [arg.splatUrl, arg.thumbnailUrl, arg.previewUrl, ...(arg.extraUrls || [])]
      .filter(Boolean);
  }
  if (!urls.length) return { supported: true, queued: 0 };
  navigator.serviceWorker.controller.postMessage({ type: 'PREFETCH_SPLAT', urls });
  return { supported: true, queued: urls.length };
}

/**
 * Subscribe to prefetch completion events. Returns an unsubscribe fn.
 */
export function onPrefetchResult(fn) {
  _prefetchListeners.add(fn);
  return () => _prefetchListeners.delete(fn);
}

/**
 * Basic online/offline detection. Browser reports 'online' slightly too
 * eagerly (it flips when a network interface comes up, not when the
 * internet is actually reachable) — for demo purposes that's fine; the
 * SW layer handles the actual "works offline" story.
 */
export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
}

/**
 * Call fn whenever connectivity changes. fn receives `true` (online) or
 * `false` (offline). Returns an unsubscribe fn.
 */
export function onNetworkChange(fn) {
  const on = () => fn(true);
  const off = () => fn(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}

/**
 * Utility — show a small banner if the browser goes offline during a
 * session. Call this once per page load. It's a soft UX hint, not a
 * blocker — everything still works if the splat is cached.
 */
export function installOfflineBanner(opts = {}) {
  if (typeof document === 'undefined') return;
  const banner = document.createElement('div');
  banner.setAttribute('data-fumoca-offline-banner', '');
  Object.assign(banner.style, {
    position: 'fixed',
    top: '0', left: '0', right: '0',
    background: '#ff2466',
    color: '#fff',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: '700',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    textAlign: 'center',
    zIndex: '999999',
    transform: 'translateY(-100%)',
    transition: 'transform .3s ease',
    pointerEvents: 'none',
  });
  banner.textContent = opts.offlineText || 'Offline — cached demo is still available.';
  document.body.appendChild(banner);
  onNetworkChange((online) => {
    banner.textContent = online
      ? (opts.onlineText || 'Back online.')
      : (opts.offlineText || 'Offline — cached demo is still available.');
    banner.style.background = online ? '#00a86b' : '#ff2466';
    banner.style.transform = 'translateY(0)';
    if (online) {
      // Hide the "back online" banner after 2s; the offline one stays.
      setTimeout(() => { banner.style.transform = 'translateY(-100%)'; }, 2000);
    }
  });
  if (!isOnline()) {
    banner.style.transform = 'translateY(0)';
  }
}

export default {
  ensureServiceWorker,
  prefetchSplat,
  onPrefetchResult,
  isOnline,
  onNetworkChange,
  installOfflineBanner,
};
