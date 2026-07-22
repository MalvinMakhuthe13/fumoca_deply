/**
 * FUMOCA White-Label Engine v1.0
 * ═══════════════════════════════════════════════════════════════════
 * Allows any brand / enterprise client to embed a Fumoca splat viewer
 * on their own site with:
 *   - Their own logo, colours, font
 *   - Zero Fumoca branding visible
 *   - API key validation (checked against Supabase embed_keys table)
 *   - Custom CTA buttons, watermarks, accent colours
 *   - Usage metering (pageviews counted per key)
 *
 * How it works:
 *   Brands embed: <script src="https://yourdomain.com/sdk/fumoca-embed.js"
 *                         data-key="THEIR_API_KEY"
 *                         data-splat="SPLAT_ID"
 *                         data-container="my-div-id"></script>
 *   OR they use the embed/viewer.html with ?apiKey=XYZ&splatId=ABC
 *
 * This module reads the apiKey param, validates it, applies the brand
 * config (stored in the embed_keys Supabase row), and locks the UI.
 * ═══════════════════════════════════════════════════════════════════
 */

const WL = (() => {
  const params = new URLSearchParams(location.search);
  const apiKey = params.get('apiKey') || params.get('api_key') || '';
  const embedDomain = params.get('embedDomain') || '';

  // Brand config defaults — overridden by Supabase embed_key row
  let brandConfig = {
    accentColor: '#c8ff00',       // neon green = Fumoca default
    logoUrl: '',                   // empty = show Fumoca wordmark
    logoText: '',                  // text fallback if no logo image
    fontFamily: '',                // empty = inherit DM Sans
    hidePoweredBy: false,          // whether to hide "Powered by Fumoca"
    ctaLabel: '',                  // custom CTA button label
    ctaUrl: '',                    // custom CTA URL
    ctaColor: '',                  // custom CTA button color
    allowDownload: false,          // whether to show export buttons
    allowShare: true,              // whether to show copy link
    watermarkText: '',             // optional bottom-right text watermark
    clientName: '',                // for logging / analytics
  };

  let validated = false;
  let keyRow = null;

  // ── Validate API key against Supabase ──────────────────────────
  async function validateKey(key) {
    if (!key) return null;
    const supabase = window._fumocaSupabase;
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('embed_keys')
        .select('*')
        .eq('key', key)
        .eq('active', true)
        .maybeSingle();
      if (error || !data) return null;
      // Meter usage
      supabase.from('embed_key_usage').insert({
        key_id: data.id,
        splat_id: params.get('splatId') || null,
        embed_domain: embedDomain || document.referrer || '',
        ua: navigator.userAgent.slice(0, 200),
        ts: new Date().toISOString(),
      }).then(() => {}).catch(() => {});
      return data;
    } catch (_) {
      return null;
    }
  }

  // ── Apply brand config to the viewer DOM ──────────────────────
  function applyBrand(cfg) {
    if (!cfg) return;

    // Accent colour (CSS variable overrides)
    if (cfg.accentColor && cfg.accentColor !== '#c8ff00') {
      const root = document.documentElement;
      root.style.setProperty('--neon', cfg.accentColor);
      root.style.setProperty('--border-neon', cfg.accentColor + '44');
    }

    // Font family
    if (cfg.fontFamily) {
      document.documentElement.style.setProperty('--font-body', cfg.fontFamily);
      document.body.style.fontFamily = cfg.fontFamily;
    }

    // Logo in topbar
    if (cfg.logoUrl || cfg.logoText) {
      _injectBrandLogo(cfg);
    }

    // "Powered by Fumoca" badge
    if (cfg.hidePoweredBy) {
      _removePoweredBy();
    } else {
      _ensurePoweredBy();
    }

    // CTA button
    if (cfg.ctaLabel && cfg.ctaUrl) {
      _injectCtaButton(cfg);
    }

    // Watermark
    if (cfg.watermarkText) {
      _injectWatermark(cfg.watermarkText);
    }

    // Hide share if not allowed
    if (!cfg.allowShare) {
      const copyBtn = document.getElementById('copyLinkBtn');
      if (copyBtn) copyBtn.style.display = 'none';
    }
  }

  function _injectBrandLogo(cfg) {
    // Replace the "FUMOCA" title text with brand logo
    const titleEl = document.getElementById('splatTitle');
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    // Remove existing brand logo if already injected
    document.getElementById('wlBrandLogo')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'wlBrandLogo';
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex-shrink:0;';

    if (cfg.logoUrl) {
      const img = document.createElement('img');
      img.src = cfg.logoUrl;
      img.alt = cfg.clientName || 'Brand';
      img.style.cssText = 'height:32px;max-width:120px;object-fit:contain;filter:brightness(0) invert(1);';
      wrap.appendChild(img);
    } else if (cfg.logoText) {
      const span = document.createElement('span');
      span.textContent = cfg.logoText;
      span.style.cssText = `font-family:var(--font-display);font-size:24px;letter-spacing:.05em;color:${cfg.accentColor || 'var(--neon)'};line-height:1;`;
      wrap.appendChild(span);
    }

    // Insert after back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn?.nextSibling) {
      topbar.insertBefore(wrap, backBtn.nextSibling);
    } else {
      topbar.prepend(wrap);
    }
  }

  function _removePoweredBy() {
    document.getElementById('wlPoweredBy')?.remove();
  }

  function _ensurePoweredBy() {
    if (document.getElementById('wlPoweredBy')) return;
    const badge = document.createElement('div');
    badge.id = 'wlPoweredBy';
    badge.innerHTML = `<a href="https://fumoca.com" target="_blank" rel="noopener" style="
      display:flex;align-items:center;gap:5px;text-decoration:none;
      color:rgba(255,255,255,.38);font-size:10px;font-family:var(--font-mono);
      letter-spacing:.06em;
    ">Powered by <span style="color:var(--neon);font-weight:700;">FUMOCA</span></a>`;
    badge.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:8;';
    document.body.appendChild(badge);
  }

  function _injectCtaButton(cfg) {
    document.getElementById('wlCtaBtn')?.remove();
    const btn = document.createElement('button');
    btn.id = 'wlCtaBtn';
    btn.textContent = cfg.ctaLabel;
    btn.style.cssText = `
      position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:12;
      padding:12px 28px;border-radius:999px;font-weight:700;font-size:14px;
      font-family:var(--font-body);cursor:pointer;border:none;
      background:${cfg.ctaColor || cfg.accentColor || 'var(--neon)'};
      color:${_isDark(cfg.ctaColor || cfg.accentColor || '#c8ff00') ? '#fff' : '#000'};
      box-shadow:0 4px 20px rgba(0,0,0,.35);transition:opacity .15s;
    `;
    btn.addEventListener('mouseover', () => btn.style.opacity = '.88');
    btn.addEventListener('mouseout', () => btn.style.opacity = '1');
    btn.addEventListener('click', () => {
      window.open(cfg.ctaUrl, '_blank', 'noopener');
      window.dispatchEvent(new CustomEvent('fumoca:ctaClick', { detail: { key: apiKey, ctaUrl: cfg.ctaUrl } }));
    });
    document.body.appendChild(btn);
  }

  function _injectWatermark(text) {
    document.getElementById('wlWatermark')?.remove();
    const wm = document.createElement('div');
    wm.id = 'wlWatermark';
    wm.textContent = text;
    wm.style.cssText = `
      position:fixed;right:14px;bottom:${document.getElementById('wlPoweredBy') ? '32px' : '14px'};
      z-index:7;font-size:11px;color:rgba(255,255,255,.22);
      font-family:var(--font-mono);letter-spacing:.05em;pointer-events:none;
    `;
    document.body.appendChild(wm);
  }

  function _isDark(hex) {
    try {
      const c = hex.replace('#', '');
      const r = parseInt(c.slice(0, 2), 16);
      const g = parseInt(c.slice(2, 4), 16);
      const b = parseInt(c.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 < 128;
    } catch (_) { return false; }
  }

  // ── SQL schema for embed_keys (paste into Supabase SQL editor) ─
  // CREATE TABLE IF NOT EXISTS embed_keys (
  //   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  //   key text UNIQUE NOT NULL,
  //   client_name text,
  //   active boolean DEFAULT true,
  //   accent_color text DEFAULT '#c8ff00',
  //   logo_url text,
  //   logo_text text,
  //   font_family text,
  //   hide_powered_by boolean DEFAULT false,
  //   cta_label text,
  //   cta_url text,
  //   cta_color text,
  //   allow_download boolean DEFAULT false,
  //   allow_share boolean DEFAULT true,
  //   watermark_text text,
  //   allowed_domains text[], -- if set, only these domains can use the key
  //   created_at timestamptz DEFAULT now()
  // );
  // CREATE TABLE IF NOT EXISTS embed_key_usage (
  //   id bigserial PRIMARY KEY,
  //   key_id uuid REFERENCES embed_keys(id),
  //   splat_id uuid,
  //   embed_domain text,
  //   ua text,
  //   ts timestamptz DEFAULT now()
  // );

  // ── Boot ───────────────────────────────────────────────────────
  async function boot() {
    if (!apiKey) {
      // No API key = standard Fumoca viewer, just ensure powered-by
      _ensurePoweredBy();
      return;
    }

    // Wait for supabase to be available (viewer.js sets it)
    let attempts = 0;
    while (!window._fumocaSupabase && attempts < 20) {
      await new Promise(r => setTimeout(r, 150));
      attempts++;
    }

    keyRow = await validateKey(apiKey);

    if (!keyRow) {
      // Invalid key — show watermark only, no brand override
      console.warn('[FUMOCA WL] Invalid or inactive API key:', apiKey);
      _ensurePoweredBy();
      return;
    }

    validated = true;

    // Map Supabase row to brandConfig
    brandConfig = {
      accentColor:    keyRow.accent_color    || '#c8ff00',
      logoUrl:        keyRow.logo_url        || '',
      logoText:       keyRow.logo_text       || '',
      fontFamily:     keyRow.font_family     || '',
      hidePoweredBy:  !!keyRow.hide_powered_by,
      ctaLabel:       keyRow.cta_label       || '',
      ctaUrl:         keyRow.cta_url         || '',
      ctaColor:       keyRow.cta_color       || '',
      allowDownload:  !!keyRow.allow_download,
      allowShare:     keyRow.allow_share !== false,
      watermarkText:  keyRow.watermark_text  || '',
      clientName:     keyRow.client_name     || '',
    };

    applyBrand(brandConfig);

    window._fumocaWhiteLabel = { validated, config: brandConfig, keyRow };
    window.dispatchEvent(new CustomEvent('fumoca:whiteLabelReady', { detail: brandConfig }));
  }

  // Re-apply on record load (font/colour may not be applied yet)
  window.addEventListener('fumoca:recordLoaded', () => {
    if (validated) applyBrand(brandConfig);
  });

  // Public API
  return { boot, getBrandConfig: () => ({ ...brandConfig }), isValidated: () => validated };
})();

WL.boot();
window._fumocaWhiteLabel = WL;
