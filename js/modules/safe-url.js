/**
 * URL scheme guards for author-supplied links and media (hotspots, CTAs,
 * galleries, nested overlays). NIF/hotspot metadata is written by whoever
 * publishes a scene and is shown to every visitor, so a `javascript:` or
 * `data:` URL there is stored XSS on the FUMOCA origin. Only http(s) (and
 * same-origin blob: for local media previews) are allowed through.
 * Adapted from the helpers in PR #10.
 */
export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim(), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) { return ''; }
}

export function safeMediaUrl(value) {
  const httpUrl = safeHttpUrl(value);
  if (httpUrl) return httpUrl;
  try {
    const url = new URL(String(value || '').trim(), window.location.href);
    return url.protocol === 'blob:' && url.origin === window.location.origin ? url.href : '';
  } catch (_) { return ''; }
}
