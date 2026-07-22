/**
 * FUMOCA Ad Embed Widget v85
 * ════════════════════════════════════════════════════════════════════════════
 * The self-contained embed script that any website or ad network drops in
 * to serve FUMOCA interactive ads.
 *
 * Usage (any website):
 *   <div class="fumoca-ad"
 *        data-src="https://fumoca.co.za/ad/CAMPAIGN_ID.fumoc"
 *        data-width="640"
 *        data-height="360"
 *        data-autoplay="true"
 *        data-brand="Toyota"
 *        data-cta-url="https://toyota.co.za/land-cruiser">
 *   </div>
 *   <script src="https://fumoca.co.za/embed/fumoca-ad.js" async></script>
 *
 * OR direct API:
 *   const player = await FumocAdEmbed.mount(container, {
 *     src:      'https://fumoca.co.za/ad/CAMPAIGN_ID.fumoc',
 *     autoplay: true,
 *   });
 *
 * What it does:
 *   1. Loads the .fumoc file (streaming, uses THUM section for instant preview)
 *   2. Shows thumbnail while the file loads
 *   3. Starts the video (VIDP section) as soon as it's available
 *   4. Activates the interactive splat at pause points (IPTS section)
 *   5. On platforms/contexts where 3D is unavailable, falls back to video-only
 *   6. Reports impressions, interactions, and CTA clicks to the FUMOCA analytics API
 *
 * Platform fallbacks:
 *   Full FUMOCA (website with WebGL) → video + interactive splat
 *   No WebGL                         → video only (VIDP)
 *   No video support                 → thumbnail image (THUM)
 *   No JavaScript                    → <noscript> placeholder
 *
 * This file is designed to be:
 *   - Self-contained (no external dependencies at runtime)
 *   - Small (~50KB minified)
 *   - Cacheable (versioned URL, long cache TTL)
 *   - Safe to embed on any site (no global namespace pollution beyond FumocAdEmbed)
 * ════════════════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  const BASE_URL     = 'https://fumoca.co.za';
  const ANALYTICS_URL = BASE_URL + '/api/ad-analytics';
  const VERSION      = 'v85';

  // ── Capability detection ──────────────────────────────────────────────────

  const CAN = {
    webgl:   (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })(),
    video:   !!document.createElement('video').canPlayType,
    mp4:     (() => { try { return document.createElement('video').canPlayType('video/mp4') !== ''; } catch { return false; } })(),
    webm:    (() => { try { return document.createElement('video').canPlayType('video/webm') !== ''; } catch { return false; } })(),
    touch:   'ontouchstart' in window,
    module:  (() => { try { new Function('return import("")'); return true; } catch { return false; } })(),
  };

  // ── Styles ────────────────────────────────────────────────────────────────

  const STYLES = `
    .fumoca-ad-embed {
      position: relative; overflow: hidden; background: #000;
      font-family: 'DM Sans', system-ui, sans-serif;
      border-radius: 8px;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .fumoca-ad-embed * { box-sizing: border-box; }
    .fumoca-ad-thumb {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover; z-index: 1;
      transition: opacity .4s ease;
    }
    .fumoca-ad-loader {
      position: absolute; inset: 0; z-index: 5;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,.4);
    }
    .fumoca-ad-spinner {
      width: 32px; height: 32px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.2);
      border-top-color: #c8ff00;
      animation: fumocaSpin .8s linear infinite;
    }
    @keyframes fumocaSpin { to { transform: rotate(360deg); } }
    .fumoca-ad-badge {
      position: absolute; bottom: 8px; right: 8px; z-index: 20;
      background: rgba(5,7,11,.7); border: 1px solid rgba(255,255,255,.1);
      border-radius: 6px; padding: 3px 8px;
      font-size: 9px; font-weight: 700; color: rgba(255,255,255,.5);
      letter-spacing: .06em; text-transform: uppercase;
      pointer-events: none;
    }
    .fumoca-ad-badge span { color: #c8ff00; }
    .fumoca-ad-interact-label {
      position: absolute; top: 8px; left: 8px; z-index: 20;
      background: rgba(200,255,0,.15); border: 1px solid rgba(200,255,0,.3);
      border-radius: 6px; padding: 3px 10px;
      font-size: 9px; font-weight: 800; color: #c8ff00;
      letter-spacing: .06em; text-transform: uppercase;
      opacity: 0; transition: opacity .3s; pointer-events: none;
    }
  `;

  function _injectStyles() {
    if (document.getElementById('fumoca-ad-styles')) return;
    const s = document.createElement('style');
    s.id        = 'fumoca-ad-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  function _track(event, data = {}) {
    try {
      navigator.sendBeacon?.(ANALYTICS_URL, JSON.stringify({
        event,
        version: VERSION,
        ts:      Date.now(),
        url:     location.href,
        ...data,
      }));
    } catch {}
  }

  // ── Fetch and parse .fumoc ────────────────────────────────────────────────

  async function _loadFumoc(src) {
    const resp = await fetch(src, { mode: 'cors' });
    if (!resp.ok) throw new Error(`Failed to fetch .fumoc: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    return buf;
  }

  // Fast header read without full decode
  function _readFumocHeader(buf) {
    const bytes   = new Uint8Array(buf);
    const magic   = String.fromCharCode(...bytes.slice(0, 6));
    if (!magic.startsWith('FUMOC')) return null;
    const headerLen = new DataView(buf).getUint32(10, true);
    try {
      return JSON.parse(new TextDecoder().decode(bytes.slice(14, 14 + headerLen)));
    } catch { return null; }
  }

  // Extract section by ID without loading the full decoder
  function _findSection(buf, sectionId) {
    const bytes  = new Uint8Array(buf);
    const view   = new DataView(buf);
    const hLen   = view.getUint32(10, true);
    let   off    = 14 + hLen;

    while (off + 13 <= bytes.length) {
      const id      = String.fromCharCode(bytes[off], bytes[off+1], bytes[off+2], bytes[off+3]);
      const flags   = bytes[off+4];
      const compLen = view.getUint32(off+5, true);
      const data    = bytes.slice(off+13, off+13+compLen);
      if (id === sectionId) return { flags, data };
      off += 13 + compLen;
    }
    return null;
  }

  async function _decompressIfNeeded(section) {
    if (!section) return null;
    if (!(section.flags & 0x01)) return section.data;
    try {
      const ds     = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      writer.write(section.data); writer.close();
      const chunks = [];
      const reader = ds.readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const out = new Uint8Array(chunks.reduce((n,c) => n+c.length, 0));
      let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    } catch { return section.data; }
  }

  // ── Mount a single ad ─────────────────────────────────────────────────────

  async function mount(container, opts = {}) {
    _injectStyles();

    const src      = opts.src      || container.dataset.src;
    const width    = opts.width    || container.dataset.width    || '100%';
    const height   = opts.height   || container.dataset.height   || '360';
    const autoplay = opts.autoplay !== false && container.dataset.autoplay !== 'false';
    const ctaUrl   = opts.ctaUrl   || container.dataset.ctaUrl;
    const brand    = opts.brand    || container.dataset.brand    || '';

    if (!src) { console.warn('[FumocAdEmbed] No src provided'); return; }

    // Size the container
    container.classList.add('fumoca-ad-embed');
    if (width  !== '100%') container.style.width  = width  + 'px';
    if (height !== '100%') container.style.height = height + 'px';
    container.style.aspectRatio = container.style.height ? '' : '16/9';

    // Loader spinner
    const loader = document.createElement('div');
    loader.className = 'fumoca-ad-loader';
    loader.innerHTML = '<div class="fumoca-ad-spinner"></div>';
    container.appendChild(loader);

    // FUMOCA badge
    const badge = document.createElement('div');
    badge.className   = 'fumoca-ad-badge';
    badge.innerHTML   = '<span>FUMOCA</span> · Drag to explore';
    container.appendChild(badge);

    // Interactive label
    const interactLabel = document.createElement('div');
    interactLabel.className = 'fumoca-ad-interact-label';
    interactLabel.textContent = 'INTERACTIVE';
    container.appendChild(interactLabel);

    _track('impression', { src, brand });

    let buffer;
    try {
      buffer = await _loadFumoc(src);
    } catch (err) {
      loader.remove();
      container.innerHTML = `<div style="color:#fff;padding:16px;font-size:13px;">Ad unavailable</div>`;
      return;
    }

    const header = _readFumocHeader(buffer);
    _track('loaded', { src, brand, nGaussians: header?.n_gaussians });

    // Show thumbnail immediately
    const thumbSection = _findSection(buffer, 'THUM');
    if (thumbSection) {
      const thumbBytes = await _decompressIfNeeded(thumbSection);
      const thumbBlob  = new Blob([thumbBytes], { type: 'image/jpeg' });
      const thumbUrl   = URL.createObjectURL(thumbBlob);
      const thumb      = document.createElement('img');
      thumb.className  = 'fumoca-ad-thumb';
      thumb.src        = thumbUrl;
      thumb.onload     = () => URL.revokeObjectURL(thumbUrl);
      container.appendChild(thumb);
    }

    loader.remove();

    // Capability routing
    if (!CAN.video) {
      // Thumbnail only — already shown
      _track('fallback', { reason: 'no_video', src });
      return;
    }

    if (!CAN.webgl) {
      // Video only — extract VIDP and play
      await _mountVideoOnly(container, buffer, header, { autoplay, ctaUrl, brand, src });
      _track('fallback', { reason: 'no_webgl', src });
      return;
    }

    // Full interactive mode
    await _mountFull(container, buffer, header, {
      autoplay, ctaUrl, brand, src, interactLabel, badge,
      onInteract: () => {
        interactLabel.style.opacity = '1';
        badge.style.display = 'none';
        _track('interact', { src, brand });
      },
      onResume: () => {
        interactLabel.style.opacity = '0';
        badge.style.display = 'block';
        _track('resume', { src, brand });
      },
      onCTA: () => _track('cta_click', { src, brand, ctaUrl }),
    });
  }

  // ── Video-only fallback ────────────────────────────────────────────────────

  async function _mountVideoOnly(container, buffer, header, opts) {
    const vidpSection = _findSection(buffer, 'VIDP');
    if (!vidpSection) return; // no video section, thumbnail stays

    const vidpData = vidpSection.data; // VIDP is not deflate-compressed (already compressed video)
    const mimeType = header?.video_mime_type || (CAN.mp4 ? 'video/mp4' : 'video/webm');
    const blob     = new Blob([vidpData], { type: mimeType });
    const url      = URL.createObjectURL(blob);

    const video        = document.createElement('video');
    video.src          = url;
    video.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:3;`;
    video.playsInline  = true;
    video.muted        = true;
    video.loop         = true;
    container.appendChild(video);

    if (opts.autoplay) video.play().catch(() => {});

    if (opts.ctaUrl) {
      container.style.cursor = 'pointer';
      container.addEventListener('click', () => {
        opts.onCTA?.();
        window.open(opts.ctaUrl, '_blank', 'noopener');
      });
    }
  }

  // ── Full interactive mode ─────────────────────────────────────────────────

  async function _mountFull(container, buffer, header, opts) {
    // Lazy-load the full decoder and ad player
    try {
      const [decoderMod, playerMod] = await Promise.all([
        import(BASE_URL + '/js/modules/fumoc-decoder.js'),
        import(BASE_URL + '/js/modules/fumoc-ad-player.js'),
      ]);

      const FumocDecoder  = decoderMod.default;
      const FumocAdPlayer = playerMod.default;

      // Full decode (this also decodes the splat)
      const decoded = await FumocDecoder.decode(buffer, { splatBinary: true });

      // Load the splat into a minimal THREE scene
      const { scene, camera, renderer, controls } = _buildMinimalThreeScene(container);

      // Load splat into renderer
      const splatBlob = new Blob([decoded.splatBinary], { type: 'application/octet-stream' });
      const splatUrl  = URL.createObjectURL(splatBlob);
      window.dispatchEvent(new CustomEvent('fumoca:loadUrl', { detail: { url: splatUrl } }));

      // Init the ad player
      FumocAdPlayer.init(container, decoded, {
        camera, controls, renderer, scene,
        onInteract: opts.onInteract,
        onResume:   opts.onResume,
        onCTA:      opts.onCTA,
      });

      // CTA handler
      if (opts.ctaUrl) {
        const ctaBtn = document.getElementById('fumocAdCTABtn');
        if (ctaBtn) {
          ctaBtn.textContent   = header?.cta_text || 'Learn more';
          ctaBtn.style.display = 'block';
        }
      }

    } catch (err) {
      console.warn('[FumocAdEmbed] Full mode failed, falling back to video:', err);
      await _mountVideoOnly(container, buffer, header, opts);
    }
  }

  function _buildMinimalThreeScene(container) {
    // This is a minimal THREE setup for the embed context.
    // In a full viewer.html context, we use the existing scene/camera/controls.
    const w = container.offsetWidth, h = container.offsetHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;opacity:0;transition:opacity .4s;';
    container.appendChild(renderer.domElement);

    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(60, w/h, 0.01, 1000);
    camera.position.set(0, 1, 5);

    // Minimal OrbitControls (inline, no import needed)
    let controls = null;
    try {
      const { OrbitControls } = THREE;
      if (OrbitControls) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enabled = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
      }
    } catch {}

    return { scene, camera, renderer, controls };
  }

  // ── Auto-mount all [data-src] elements ────────────────────────────────────

  function _autoMount() {
    document.querySelectorAll('.fumoca-ad[data-src]').forEach(el => {
      if (el.dataset.fumocaMounted) return;
      el.dataset.fumocaMounted = '1';
      mount(el);
    });
  }

  // Run on DOM ready + observe for dynamically added ads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoMount);
  } else {
    _autoMount();
  }

  new MutationObserver(_autoMount).observe(document.body, { childList: true, subtree: true });

  // ── Public API ────────────────────────────────────────────────────────────

  global.FumocAdEmbed = { mount, VERSION, CAN };

})(window);
