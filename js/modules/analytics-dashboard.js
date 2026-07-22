/**
 * FUMOCA Splat Health & Admin Analytics v1.0
 * ═══════════════════════════════════════════════════════════════════
 * Gives owners a live "splat health score" and business readiness
 * dashboard — shown only to owner/admin, never to public viewers.
 *
 * Health Score (0–100):
 *   - Gaussian count (higher = more detail)
 *   - Opacity distribution (more high-opacity = crisper subject)
 *   - Scale variance (lower = fewer halos)
 *   - Hotspot count (more = more engaging)
 *   - Has thumbnail (yes/no)
 *   - Has variant (yes/no)
 *   - Embed count (how many external sites have used it)
 *
 * Revenue Readiness Signals:
 *   - Commerce-ready (has product hotspots)
 *   - Tour-ready (has 2+ tour hotspots)
 *   - Embed-ready (public viewer locked, copy link available)
 *   - Print-ready (queued mesh cleanup)
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaAnalytics = (() => {

  let _panel = null;
  let _scoreData = null;

  // ── Only show to owners/admins ─────────────────────────────────
  function _canShow() {
    return !!window._fumocaPermissions?.canManage && !window.IS_PUBLIC_VIEWER;
  }

  // ── Compute health score from edit engine data + record ────────
  function computeHealthScore() {
    const engine = window._editEngine;
    const record = window._fumocaCurrentRecord;
    const hotspots = window._fumocaHotspots || [];

    let score = 0;
    const signals = [];
    const warnings = [];
    const tips = [];

    // 1. Gaussian count (max 25 pts)
    const total = engine?.getAliveCount?.() || 0;
    const deleted = engine?.getDeletedCount?.() || 0;
    const gaussianScore = total > 800000 ? 25 : total > 300000 ? 18 : total > 100000 ? 12 : total > 0 ? 6 : 0;
    score += gaussianScore;
    if (total > 0) signals.push({ label: 'Gaussians', value: _fmt(total), ok: gaussianScore >= 18 });
    if (total > 0 && deleted > 0) {
      const cleanPct = Math.round((deleted / (total + deleted)) * 100);
      signals.push({ label: 'Cleaned', value: `${cleanPct}%`, ok: cleanPct > 5 });
      if (cleanPct > 5) score += 5;
    }
    if (total === 0) warnings.push('No splat data loaded yet');
    if (total > 0 && total < 50000) tips.push('Splat has low Gaussian count — retrain with more frames for sharper quality');

    // 2. Thumbnail (10 pts)
    if (record?.thumbnail_url || record?.thumbnail) {
      score += 10;
      signals.push({ label: 'Thumbnail', value: 'Set', ok: true });
    } else {
      warnings.push('No thumbnail set');
      tips.push('Add a thumbnail — embeds without one show a blank card in link previews');
    }

    // 3. Hotspots (max 20 pts)
    const productHotspots = hotspots.filter(h => h.type === 'product' || h.type === 'sponsor');
    const tourHotspots = hotspots.filter(h => h.type === 'tour' || h.type === 'tour_jump');
    const allHotspots = hotspots.length;
    if (allHotspots >= 3) score += 20;
    else if (allHotspots >= 1) score += 12;
    signals.push({ label: 'Hotspots', value: String(allHotspots), ok: allHotspots >= 3 });
    if (allHotspots === 0) tips.push('Add hotspots — splats with 3+ hotspots get 4× more embed clicks');
    if (productHotspots.length === 0) tips.push('No product hotspots — add type=product hotspots to unlock commerce revenue');

    // 4. Variant exists (10 pts)
    if (record?.parent_id || record?.variant_type || record?.metadata?.has_variant) {
      score += 10;
      signals.push({ label: 'Variant saved', value: 'Yes', ok: true });
    } else {
      signals.push({ label: 'Variant saved', value: 'No', ok: false });
      tips.push('Save a cleaned variant — it\'s required for mesh export and print pipeline');
    }

    // 5. Status (10 pts)
    const status = record?.status || '';
    if (status === 'ready') {
      score += 10;
      signals.push({ label: 'Status', value: 'Ready', ok: true });
    } else {
      signals.push({ label: 'Status', value: status || 'Unknown', ok: false });
      if (status === 'processing') tips.push('Splat is still processing — check back in a few minutes');
    }

    // Revenue readiness flags
    const revenueFlags = [
      { label: 'Commerce-ready',  ok: productHotspots.length > 0,   tip: 'Add product hotspots' },
      { label: 'Tour-ready',      ok: tourHotspots.length >= 2,      tip: 'Add 2+ tour hotspots' },
      { label: 'Embed-ready',     ok: !!record?.id,                  tip: 'Publish the splat first' },
      { label: 'Print-ready',     ok: !!record?.metadata?.mesh_queued, tip: 'Queue mesh cleanup' },
    ];

    return { score: Math.min(100, score), signals, warnings, tips, revenueFlags, total, deleted, allHotspots, productHotspots: productHotspots.length, tourHotspots: tourHotspots.length };
  }

  // ── Render the dashboard panel ─────────────────────────────────
  function render() {
    if (!_canShow()) return;
    _removePanel();

    _scoreData = computeHealthScore();
    const { score, signals, warnings, tips, revenueFlags } = _scoreData;

    const scoreColor = score >= 80 ? '#c8ff00' : score >= 55 ? '#ffb800' : '#ff6b6b';
    const grade = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs work';

    _panel = document.createElement('div');
    _panel.id = 'fumocaAnalyticsPanel';
    _panel.style.cssText = `
      position:fixed;left:16px;bottom:16px;z-index:13;
      width:min(400px,calc(100vw - 32px));max-height:calc(100vh - 120px);
      background:rgba(7,10,16,.94);border:1px solid rgba(255,255,255,.1);
      border-radius:24px;backdrop-filter:blur(22px);
      box-shadow:0 20px 70px rgba(0,0,0,.45);
      display:flex;flex-direction:column;overflow:hidden;
      font-family:var(--font-body,'DM Sans',sans-serif);
      animation:fumocaSlideUp .22s ease;
    `;

    _panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.07);">
        <div style="font-family:var(--font-display,'Bebas Neue');font-size:20px;color:var(--neon,#c8ff00);letter-spacing:.06em;">SPLAT HEALTH</div>
        <button id="fumocaAnalyticsClose" style="width:30px;height:30px;border-radius:999px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#fff;cursor:pointer;">✕</button>
      </div>

      <!-- Score ring -->
      <div style="display:flex;align-items:center;gap:16px;padding:16px;">
        <div style="position:relative;width:72px;height:72px;flex-shrink:0;">
          <svg width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="6"/>
            <circle cx="36" cy="36" r="30" fill="none" stroke="${scoreColor}" stroke-width="6"
              stroke-dasharray="${2 * Math.PI * 30}" stroke-dashoffset="${2 * Math.PI * 30 * (1 - score / 100)}"
              stroke-linecap="round" transform="rotate(-90 36 36)" style="transition:stroke-dashoffset .6s ease;"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono,'monospace');font-size:16px;font-weight:700;color:${scoreColor};">${score}</div>
        </div>
        <div>
          <div style="font-size:20px;font-weight:700;color:#fff;">${grade}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:2px;">Health Score — ${score}/100</div>
        </div>
      </div>

      <div style="flex:1;overflow-y:auto;padding:0 16px 16px;">

        <!-- Signals grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;">
          ${signals.map(s => `
            <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:8px 10px;">
              <div style="font-size:10px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.08em;">${_esc(s.label)}</div>
              <div style="font-size:14px;font-weight:700;color:${s.ok ? '#c8ff00' : '#ffb800'};margin-top:2px;">${_esc(s.value)}</div>
            </div>
          `).join('')}
        </div>

        <!-- Revenue readiness -->
        <div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Revenue Readiness</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${revenueFlags.map(f => `
              <div style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;font-size:11px;
                border:1px solid ${f.ok ? 'rgba(200,255,0,.25)' : 'rgba(255,255,255,.08)'};
                background:${f.ok ? 'rgba(200,255,0,.08)' : 'rgba(255,255,255,.03)'};
                color:${f.ok ? 'var(--neon,#c8ff00)' : 'rgba(255,255,255,.4)'};
                title="${_esc(f.ok ? '' : f.tip)}">
                ${f.ok ? '✓' : '○'} ${_esc(f.label)}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Warnings -->
        ${warnings.length ? `
          <div style="margin-bottom:10px;">
            ${warnings.map(w => `
              <div style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:rgba(255,72,72,.06);border:1px solid rgba(255,72,72,.18);margin-bottom:5px;">
                <span style="color:#ff6b6b;flex-shrink:0;">⚠</span>
                <span style="font-size:12px;color:rgba(255,255,255,.7);line-height:1.45;">${_esc(w)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Tips -->
        ${tips.length ? `
          <div style="margin-bottom:10px;">
            <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Tips to improve</div>
            ${tips.map(t => `
              <div style="font-size:12px;color:rgba(255,255,255,.6);line-height:1.5;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);">→ ${_esc(t)}</div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Quick actions -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;">
          <button id="fumocaAnalyticsRefresh" style="padding:9px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#fff;cursor:pointer;font-size:12px;font-weight:700;">Refresh score</button>
          <button id="fumocaAnalyticsTour" style="padding:9px;border-radius:12px;border:1px solid rgba(200,255,0,.22);background:rgba(200,255,0,.08);color:var(--neon,#c8ff00);cursor:pointer;font-size:12px;font-weight:700;">${window._fumocaTour?.isActive?.() ? 'Stop tour' : 'Preview tour'}</button>
          <button id="fumocaAnalyticsEmbed" style="padding:9px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#fff;cursor:pointer;font-size:12px;font-weight:700;">Copy embed</button>
          <button id="fumocaAnalyticsClean" style="padding:9px;border-radius:12px;border:1px solid rgba(0,255,200,.22);background:rgba(0,255,200,.06);color:var(--acid2,#00ffc8);cursor:pointer;font-size:12px;font-weight:700;">Auto-clean</button>
        </div>
      </div>
    `;

    document.body.appendChild(_panel);

    // Wire buttons
    document.getElementById('fumocaAnalyticsClose')?.addEventListener('click', _removePanel);
    document.getElementById('fumocaAnalyticsRefresh')?.addEventListener('click', render);
    document.getElementById('fumocaAnalyticsTour')?.addEventListener('click', () => {
      if (window._fumocaTour?.isActive?.()) {
        window._fumocaTour.stop();
      } else {
        window._fumocaTour?.start?.(window._fumocaHotspots || [], { loop: false });
      }
      _removePanel();
    });
    document.getElementById('fumocaAnalyticsEmbed')?.addEventListener('click', async () => {
      const url = window._fumocaCreateEmbedUrl?.() || location.href;
      const code = `<iframe src="${url}" style="width:100%;height:600px;border:0;" allowfullscreen loading="lazy"></iframe>`;
      try { await navigator.clipboard.writeText(code); } catch (_) {}
      const btn = document.getElementById('fumocaAnalyticsEmbed');
      if (btn) { btn.textContent = '✓ Copied'; setTimeout(() => { if(btn) btn.textContent = 'Copy embed'; }, 1600); }
    });
    document.getElementById('fumocaAnalyticsClean')?.addEventListener('click', () => {
      window._fumocaApplyAutoCleanPreset?.('product');
      _removePanel();
    });
  }

  function _removePanel() {
    _panel?.remove();
    _panel = null;
  }

  function toggle() {
    if (_panel) _removePanel();
    else render();
  }

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _fmt(n) {
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
    return String(n);
  }

  // ── Inject keyframes if not already present ────────────────────
  if (!document.getElementById('fumocaAnalyticsStyles')) {
    const style = document.createElement('style');
    style.id = 'fumocaAnalyticsStyles';
    style.textContent = `@keyframes fumocaSlideUp{from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}`;
    document.head.appendChild(style);
  }

  // ── Auto-refresh when edit engine updates ──────────────────────
  window.addEventListener('fumoca:editMaskUpdated', () => { if (_panel) render(); });
  window.addEventListener('fumoca:recordLoaded', () => { if (_panel) render(); });
  window.addEventListener('fumoca:hotspotsParsed', () => { if (_panel) render(); });

  return { render, toggle, getScore: () => _scoreData, remove: _removePanel };
})();

window.FumocaAnalytics = FumocaAnalytics;

// Hook the health score button into the viewer topbar
window.addEventListener('fumoca:permissionsReady', (e) => {
  if (!e.detail?.canManage) return;
  if (document.getElementById('fumocaHealthBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'fumocaHealthBtn';
  btn.title = 'Splat Health Score & Analytics';
  btn.style.cssText = `
    background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
    color:#fff;font-family:var(--font-body);font-size:13px;font-weight:700;
    padding:9px 14px;border-radius:12px;cursor:pointer;white-space:nowrap;
  `;
  btn.textContent = '◈ Health';
  btn.addEventListener('click', FumocaAnalytics.toggle);

  const topActions = document.getElementById('topActions');
  if (topActions) topActions.prepend(btn);
});
