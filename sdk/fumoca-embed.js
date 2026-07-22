/**
 * FUMOCA Share SDK v1.0
 * ═══════════════════════════════════════════════════════════════════
 * One <script> tag. Any site. Full Fumoca viewer with commerce,
 * tours, hotspots, and a guaranteed back-to-your-site button.
 *
 * Usage (on any brand/product site):
 *
 *   <div id="fumoca-viewer" style="width:100%;height:600px;"></div>
 *   <script
 *     src="https://yourdomain.com/sdk/fumoca-embed.js"
 *     data-splat-id="YOUR_SPLAT_ID"
 *     data-api-key="YOUR_API_KEY"
 *     data-container="fumoca-viewer"
 *     data-accent="#ff6b00"
 *     data-cta-label="Buy this product"
 *     data-cta-url="https://yourshop.com/product/123"
 *     data-tour="false"
 *   ></script>
 *
 * This file is the SDK itself — it builds the iframe URL from the
 * data attributes and injects it, handling all sizing, messaging,
 * and back-to-page behaviour automatically.
 *
 * postMessage events fired to the parent window:
 *   { fumoca: true, event: 'fumoca:addedToCart', detail: {...} }
 *   { fumoca: true, event: 'fumoca:checkout',    detail: {...} }
 *   { fumoca: true, event: 'fumoca:productBuyNow', detail: {...} }
 *   { fumoca: true, event: 'fumoca:ctaClick',    detail: {...} }
 *   { fumoca: true, event: 'fumoca:tourStarted', detail: {...} }
 *   { fumoca: true, event: 'fumoca:hotspotOpened', detail: {...} }
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // Find the script tag that loaded us
  const me = document.currentScript || (() => {
    const scripts = document.querySelectorAll('script[data-splat-id],script[data-api-key]');
    return scripts[scripts.length - 1];
  })();

  if (!me) return;

  // ── Read config from data attributes ──────────────────────────
  const cfg = {
    splatId:      me.dataset.splatId     || me.dataset.splat      || '',
    apiKey:       me.dataset.apiKey      || me.dataset.key         || '',
    fileUrl:      me.dataset.fileUrl     || me.dataset.file        || '',
    container:    me.dataset.container   || '',
    accent:       me.dataset.accent      || '',
    ctaLabel:     me.dataset.ctaLabel    || '',
    ctaUrl:       me.dataset.ctaUrl      || '',
    tour:         me.dataset.tour        === 'true',
    loop:         me.dataset.loop        !== 'false',
    autoplay:     me.dataset.autoplay    === 'true',
    baseUrl:      me.dataset.baseUrl     || _inferBaseUrl(me.src),
    width:        me.dataset.width       || '100%',
    height:       me.dataset.height      || '100%',
    borderRadius: me.dataset.borderRadius|| '0',
  };

  function _inferBaseUrl(src) {
    try { return new URL(src).origin; } catch (_) { return ''; }
  }

  // ── Build the embed iframe URL ─────────────────────────────────
  function _buildUrl() {
    const base = cfg.baseUrl || window.location.origin;
    const u = new URL(`${base}/embed/viewer.html`);
    if (cfg.splatId)  u.searchParams.set('splatId',  cfg.splatId);
    if (cfg.fileUrl)  u.searchParams.set('file',      cfg.fileUrl);
    if (cfg.apiKey)   u.searchParams.set('apiKey',    cfg.apiKey);
    if (cfg.accent)   u.searchParams.set('accent',    cfg.accent);
    if (cfg.ctaLabel) u.searchParams.set('ctaLabel',  cfg.ctaLabel);
    if (cfg.ctaUrl)   u.searchParams.set('ctaUrl',    cfg.ctaUrl);
    if (cfg.tour)     u.searchParams.set('tour',      '1');
    u.searchParams.set('embed',      '1');
    u.searchParams.set('public',     '1');
    u.searchParams.set('embedDomain', window.location.origin);
    // Pass current page as back destination
    u.searchParams.set('back', window.location.href);
    return u.toString();
  }

  // ── Find or create container ───────────────────────────────────
  function _getContainer() {
    if (cfg.container) {
      const el = document.getElementById(cfg.container);
      if (el) return el;
    }
    // Fallback: insert an auto container right where the script tag is
    const div = document.createElement('div');
    div.style.cssText = `width:${cfg.width};height:${cfg.height};`;
    me.parentNode.insertBefore(div, me);
    return div;
  }

  // ── Inject the iframe ─────────────────────────────────────────
  function _inject() {
    const container = _getContainer();
    if (!container) return;

    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    if (cfg.borderRadius) container.style.borderRadius = cfg.borderRadius;

    const iframe = document.createElement('iframe');
    iframe.src = _buildUrl();
    iframe.allow = 'autoplay; fullscreen; web-share; clipboard-write';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'eager');
    iframe.style.cssText = `
      position:absolute;inset:0;width:100%;height:100%;border:0;
      background:#05070b;display:block;
    `;
    iframe.title = 'FUMOCA 3D Viewer';

    container.appendChild(iframe);

    // ── Listen for postMessage events from the iframe ────────────
    window.addEventListener('message', (e) => {
      if (!e.data?.fumoca) return;
      // Re-dispatch as native DOM events on the container
      try {
        container.dispatchEvent(new CustomEvent(e.data.event, {
          bubbles: true,
          detail: e.data.detail || {},
        }));
      } catch (_) {}
      // Also fire on window for easy global listeners
      try {
        window.dispatchEvent(new CustomEvent(e.data.event, { detail: e.data.detail || {} }));
      } catch (_) {}
    });

    return iframe;
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inject);
  } else {
    _inject();
  }

  // Expose SDK to page for programmatic control
  window.FumocaSDK = window.FumocaSDK || {};
  window.FumocaSDK[cfg.splatId || cfg.container || 'default'] = { config: cfg, rebuildUrl: _buildUrl };

})();
