/**
 * FUMOCA Embed Manager v61
 * ═══════════════════════════════════════════════════════════════════
 * Lets dealerships, restaurants, and brands embed any published
 * Fumoca experience directly into their own website with one
 * copy-paste iframe snippet.
 *
 * Features:
 *   - Unique embed token per splat (stored in embeds table)
 *   - Configurable: theme, autoplay, hotspot visibility, tour auto-start
 *   - CORS origin whitelist per embed
 *   - View count tracking per embed token
 *   - Copy-paste iframe snippet generator
 *   - QR code deep link generator for physical placements
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaEmbedManager = (() => {

  // ── Create or fetch embed token for a splat ───────────────────────
  async function getOrCreateEmbed(splatRecord, config = {}) {
    const sb = window._fumocaSupabase;
    if (!sb || !splatRecord?.id) return null;

    // Check if one already exists
    const { data: existing } = await sb.from('embeds')
      .select('*')
      .eq('splat_id', splatRecord.id)
      .maybeSingle();

    if (existing) return existing;

    // Create new
    const { data: created, error } = await sb.from('embeds').insert({
      splat_id:       splatRecord.id,
      label:          config.label || `${splatRecord.title || 'Splat'} embed`,
      allowed_origins: config.allowedOrigins || [],
      embed_config:   {
        theme:          config.theme      || 'dark',
        autoplay:       config.autoplay   ?? true,
        show_hotspots:  config.hotspots   ?? true,
        show_tour_btn:  config.tourBtn    ?? true,
        show_branding:  config.branding   ?? true,
        bg_color:       config.bgColor    || '#05070b',
      },
    }).select().single();

    if (error) { console.error('[Embed] Create failed:', error); return null; }

    // Save token back to splat record for quick access
    await sb.from('nif_files').update({ embed_token: created.token }).eq('id', splatRecord.id);

    return created;
  }

  // ── Generate iframe snippet ───────────────────────────────────────
  function generateIframeSnippet(embed, splatRecord, options = {}) {
    if (!embed?.token) return '';
    const base  = options.baseUrl || location.origin;
    const url   = `${base}/embed/viewer.html?token=${embed.token}`;
    const w     = options.width  || '100%';
    const h     = options.height || '520px';
    const title = splatRecord?.title || 'Fumoca 3D Experience';

    return `<!-- Fumoca 3D Experience: ${title} -->
<iframe
  src="${url}"
  width="${w}"
  height="${h}"
  style="border:none;border-radius:16px;overflow:hidden;"
  title="${title}"
  allow="autoplay;fullscreen;xr-spatial-tracking"
  loading="lazy"
></iframe>
<!-- Powered by FUMOCA — fumoca.co.za -->`;
  }

  // ── Generate QR code data URL for the embed URL ───────────────────
  async function generateQRDataUrl(embed, baseUrl) {
    const url = `${baseUrl || location.origin}/embed/viewer.html?token=${embed?.token}`;
    // Use Google Charts QR API (no API key, free)
    const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(url)}&choe=UTF-8`;
    return { qrUrl, targetUrl: url };
  }

  // ── Track embed view (called from embed/viewer.html) ──────────────
  async function trackEmbedView(token) {
    const sb = window._fumocaSupabase;
    if (!sb || !token) return;
    await sb.rpc('increment_embed_view', { p_token: token }).catch(() => {
      // Fallback if RPC not available
      sb.from('embeds').select('view_count').eq('token', token).single()
        .then(({ data }) => {
          if (data) sb.from('embeds').update({ view_count: (data.view_count||0)+1 }).eq('token', token);
        });
    });
  }

  // ── Build embed management UI ─────────────────────────────────────
  async function buildEmbedUI(containerId, splatRecord) {
    const container = document.getElementById(containerId);
    if (!container || !splatRecord?.id) return;

    const sb     = window._fumocaSupabase;
    const embed  = await getOrCreateEmbed(splatRecord);
    const snippet = generateIframeSnippet(embed, splatRecord);
    const { qrUrl, targetUrl } = await generateQRDataUrl(embed);

    container.innerHTML = `
      <div class="embed-section">
        <div class="sec-label">Embed Code</div>
        <textarea id="embedSnippet" readonly
          style="width:100%;height:100px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);
                 border-radius:10px;padding:10px;color:#c8ff00;font:12px monospace;resize:vertical;"
        >${snippet}</textarea>
        <button onclick="FumocaEmbedManager.copySnippet()" class="ac-btn lime full" style="margin-top:6px;">
          📋 Copy iframe Code
        </button>
      </div>
      <div class="embed-section" style="margin-top:12px;">
        <div class="sec-label">QR Code (for physical placement)</div>
        <img src="${qrUrl}" alt="QR Code" style="width:140px;height:140px;border-radius:10px;display:block;margin:8px 0;">
        <div style="font-size:11px;color:rgba(255,255,255,.4);word-break:break-all;">${targetUrl}</div>
        <button onclick="FumocaEmbedManager.copyLink('${targetUrl}')" class="ac-btn full" style="margin-top:6px;">
          ⎘ Copy Link
        </button>
      </div>
      <div class="embed-section" style="margin-top:12px;">
        <div class="sec-label">Embed Stats</div>
        <div style="font-size:13px;color:rgba(255,255,255,.7);">
          Views: <strong>${embed?.view_count || 0}</strong> &nbsp;·&nbsp;
          Token: <code style="font-size:10px;opacity:.5;">${embed?.token?.slice(0,12)}…</code>
        </div>
      </div>`;
  }

  function copySnippet() {
    const el = document.getElementById('embedSnippet');
    if (el) { el.select(); navigator.clipboard?.writeText(el.value) || document.execCommand('copy'); }
    _toast('📋 Iframe code copied!');
  }

  function copyLink(url) {
    navigator.clipboard?.writeText(url).catch(() => {});
    _toast('⎘ Link copied!');
  }

  function _toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(200,255,0,.18);border:1px solid rgba(200,255,0,.35);color:#c8ff00;padding:8px 18px;border-radius:999px;font-size:12px;font-weight:700;z-index:9999;pointer-events:none;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    getOrCreateEmbed,
    generateIframeSnippet,
    generateQRDataUrl,
    trackEmbedView,
    buildEmbedUI,
    copySnippet,
    copyLink,
  };

})();

window.FumocaEmbedManager = FumocaEmbedManager;
export default FumocaEmbedManager;
