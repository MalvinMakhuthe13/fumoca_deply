/**
 * FUMOCA Cinematic Tour Builder v1.0
 * ═══════════════════════════════════════════════════════════════════
 * Turns hotspot sequences into a cinema-quality guided experience.
 * Beats Luma AI's static tours: fully scripted, timed, with
 * per-stop narration, auto-advance, pause/resume, and progress HUD.
 *
 * Unlike the basic hotspot tour (which just jumps between points),
 * this system:
 *   - Plays ordered stops with individual camera duration + easing
 *   - Shows a title card + description overlay per stop
 *   - Plays audio narration per stop (if provided)
 *   - Shows a progress bar + stop counter
 *   - Can be triggered by ?tour=1 URL param (auto-starts on load)
 *   - Can be embedded as a looping showroom demo
 *   - Exposes a full JS API for third-party control
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaTour = (() => {

  // ── State ─────────────────────────────────────────────────────
  const state = {
    active:   false,
    stops:    [],       // normalised tour stops
    index:    -1,
    timer:    null,
    paused:   false,
    loop:     false,
    autoplay: false,
  };

  let activeAudio = null;

  // ── DOM helpers ───────────────────────────────────────────────
  function _ensureHUD() {
    let hud = document.getElementById('fumocaTourHUD');
    if (hud) return hud;
    hud = document.createElement('div');
    hud.id = 'fumocaTourHUD';
    hud.style.cssText = `
      position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:15;
      width:min(520px,calc(100vw - 32px));
      background:rgba(5,7,11,.88);border:1px solid rgba(255,255,255,.1);
      backdrop-filter:blur(20px);border-radius:20px;overflow:hidden;
      display:none;flex-direction:column;
      box-shadow:0 14px 50px rgba(0,0,0,.45);
    `;
    document.body.appendChild(hud);
    return hud;
  }

  function _ensureTitleCard() {
    let card = document.getElementById('fumocaTourCard');
    if (card) return card;
    card = document.createElement('div');
    card.id = 'fumocaTourCard';
    card.style.cssText = `
      position:fixed;left:24px;top:86px;z-index:15;
      width:min(380px,calc(100vw - 48px));
      background:rgba(5,7,11,.86);border:1px solid rgba(255,255,255,.1);
      backdrop-filter:blur(20px);border-radius:20px;padding:18px 20px;
      display:none;
      box-shadow:0 14px 50px rgba(0,0,0,.4);
      animation:fumocaTourFadeIn .35s ease;
    `;
    document.body.appendChild(card);
    return card;
  }

  // ── Build stop list from hotspots ─────────────────────────────
  function _buildStops(hotspots) {
    if (!hotspots?.length) return [];
    return hotspots
      .filter(h => h.type === 'tour' || h.type === 'tour_jump' || h._tourInclude)
      .sort((a, b) => (a.tourOrder ?? a.order ?? 999) - (b.tourOrder ?? b.order ?? 999))
      .map((h, i) => ({
        id:          h.id || `stop_${i}`,
        title:       h.title || `Stop ${i + 1}`,
        description: h.description || h.desc || '',
        wx:          h.wx ?? null,
        wy:          h.wy ?? null,
        wz:          h.wz ?? null,
        zoom:        Number(h.zoom) || 1.2,
        duration:    Number(h.tourDuration || h.duration) || 4200,
        dwellMs:     Number(h.tourDwell || h.dwell) || 3000,
        audioUrl:    h.audioUrl || '',
        mediaUrl:    h.mediaUrl || h.imageUrl || '',
        ctaLabel:    h.ctaLabel || '',
        ctaUrl:      h.ctaLink || h.link || '',
        accentColor: h.accentColor || '',
      }));
  }

  // ── HUD render ────────────────────────────────────────────────
  function _renderHUD() {
    const hud = _ensureHUD();
    const total = state.stops.length;
    const idx = state.index;
    const current = state.stops[idx] || null;
    const progress = total > 0 ? ((idx + 1) / total) * 100 : 0;
    const accent = current?.accentColor || window._fumocaWhiteLabel?.getBrandConfig?.()?.accentColor || '#c8ff00';

    hud.style.display = 'flex';
    hud.innerHTML = `
      <div style="height:3px;background:rgba(255,255,255,.06);">
        <div style="height:100%;background:${accent};width:${progress}%;transition:width .4s ease;"></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;">
        <div style="font-family:var(--font-mono);font-size:11px;color:rgba(255,255,255,.45);white-space:nowrap;">
          ${idx + 1} / ${total}
        </div>
        <div style="flex:1;min-width:0;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${_esc(current?.title || '')}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button id="fumocaTourPrev" style="width:32px;height:32px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:14px;" ${idx <= 0 ? 'disabled style="opacity:.3;cursor:not-allowed;"' : ''}>‹</button>
          <button id="fumocaTourPausePlay" style="width:32px;height:32px;border-radius:999px;border:1px solid ${accent}44;background:${accent}1a;color:${accent};cursor:pointer;font-size:14px;">
            ${state.paused ? '▶' : '⏸'}
          </button>
          <button id="fumocaTourNext" style="width:32px;height:32px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:14px;" ${idx >= total - 1 && !state.loop ? 'disabled style="opacity:.3;cursor:not-allowed;"' : ''}>›</button>
          <button id="fumocaTourStop" style="width:32px;height:32px;border-radius:999px;border:1px solid rgba(255,72,72,.28);background:rgba(255,72,72,.08);color:#ff6b6b;cursor:pointer;font-size:12px;">✕</button>
        </div>
      </div>
    `;

    document.getElementById('fumocaTourPrev')?.addEventListener('click', () => goTo(idx - 1));
    document.getElementById('fumocaTourNext')?.addEventListener('click', () => goTo(idx + 1));
    document.getElementById('fumocaTourPausePlay')?.addEventListener('click', togglePause);
    document.getElementById('fumocaTourStop')?.addEventListener('click', stop);
  }

  // ── Title card render ─────────────────────────────────────────
  function _renderTitleCard(stop) {
    const card = _ensureTitleCard();
    if (!stop) { card.style.display = 'none'; return; }
    const accent = stop.accentColor || '#c8ff00';

    card.style.display = 'block';
    card.innerHTML = `
      <div style="font-family:var(--font-display);font-size:28px;letter-spacing:.04em;color:#fff;line-height:1;">${_esc(stop.title)}</div>
      ${stop.description ? `<div style="margin-top:8px;font-size:13px;line-height:1.6;color:rgba(255,255,255,.72);">${_esc(stop.description)}</div>` : ''}
      ${stop.mediaUrl ? `<img src="${_esc(stop.mediaUrl)}" style="width:100%;border-radius:12px;margin-top:10px;object-fit:cover;max-height:160px;">` : ''}
      ${stop.ctaLabel && stop.ctaUrl ? `
        <a href="${_esc(stop.ctaUrl)}" target="_blank" rel="noopener" style="
          display:block;margin-top:12px;padding:11px 16px;border-radius:12px;
          background:${accent};color:${_isDark(accent)?'#fff':'#000'};
          font-weight:700;font-size:13px;text-decoration:none;text-align:center;
        ">${_esc(stop.ctaLabel)}</a>
      ` : ''}
    `;
    // Fade animation reset
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = 'fumocaTourFadeIn .35s ease';
  }

  // ── Navigation ────────────────────────────────────────────────
  function goTo(idx) {
    clearTimeout(state.timer);
    _stopAudio();
    if (!state.active || !state.stops.length) return;
    const total = state.stops.length;
    if (idx < 0) idx = state.loop ? total - 1 : 0;
    if (idx >= total) {
      if (state.loop) idx = 0;
      else { stop(); return; }
    }
    state.index = idx;
    const stop_ = state.stops[idx];

    // Camera fly
    if (Number.isFinite(stop_.wx) && Number.isFinite(stop_.wy) && Number.isFinite(stop_.wz)) {
      window._fumocaCameraEngine?.flyToHotspot?.({
        wx: stop_.wx, wy: stop_.wy, wz: stop_.wz,
        zoom: stop_.zoom,
        type: 'tour',
      });
    }

    // Audio
    if (stop_.audioUrl) _playAudio(stop_.audioUrl);

    // Title card
    _renderTitleCard(stop_);

    // HUD
    _renderHUD();

    // Analytics
    window.dispatchEvent(new CustomEvent('fumoca:tourStop', { detail: { stop: stop_, index: idx } }));

    // Auto-advance
    if (!state.paused) {
      const delay = Math.max(1000, (stop_.dwellMs || 3000) + (stop_.duration || 1200));
      state.timer = setTimeout(() => goTo(state.index + 1), delay);
    }
  }

  function togglePause() {
    if (state.paused) {
      state.paused = false;
      // Re-schedule advance from current stop
      const stop_ = state.stops[state.index];
      if (stop_) {
        const delay = Math.max(1000, (stop_.dwellMs || 3000));
        state.timer = setTimeout(() => goTo(state.index + 1), delay);
      }
    } else {
      state.paused = true;
      clearTimeout(state.timer);
    }
    _renderHUD();
  }

  // ── Audio ─────────────────────────────────────────────────────
  function _playAudio(url) {
    _stopAudio();
    try {
      activeAudio = new Audio(url);
      activeAudio.play().catch(() => {});
    } catch (_) {}
  }
  function _stopAudio() {
    try { activeAudio?.pause(); } catch (_) {}
    activeAudio = null;
  }

  // ── Public API ────────────────────────────────────────────────
  function start(hotspots, opts = {}) {
    const stops = _buildStops(hotspots || window._fumocaHotspots || []);
    if (!stops.length) {
      console.warn('[FumocaTour] No tour stops found. Add hotspots with type="tour".');
      return false;
    }
    state.stops  = stops;
    state.active = true;
    state.paused = false;
    state.loop   = !!opts.loop;
    state.index  = -1;
    window.dispatchEvent(new CustomEvent('fumoca:tourStarted', { detail: { count: stops.length } }));
    goTo(0);
    return true;
  }

  function stop() {
    clearTimeout(state.timer);
    _stopAudio();
    state.active = false;
    state.index  = -1;
    document.getElementById('fumocaTourHUD')?.remove();
    document.getElementById('fumocaTourCard')?.remove();
    window.dispatchEvent(new CustomEvent('fumoca:tourStopped'));
  }

  function next() { if (state.active) goTo(state.index + 1); }
  function prev() { if (state.active) goTo(state.index - 1); }
  function isActive() { return state.active; }

  // ── Auto-start from URL param ─────────────────────────────────
  const _autoStart = new URLSearchParams(location.search).get('tour') === '1';
  if (_autoStart) {
    // Wait for hotspots to load
    window.addEventListener('fumoca:hotspotsParsed', (e) => {
      setTimeout(() => start(e.detail?.hotspots, { loop: true }), 600);
    }, { once: true });
    // Fallback: try after record loads
    window.addEventListener('fumoca:recordLoaded', () => {
      if (!state.active) setTimeout(() => {
        const hs = window._fumocaHotspots || [];
        if (hs.length) start(hs, { loop: true });
      }, 1200);
    }, { once: true });
  }

  // ── Inject keyframe animation ─────────────────────────────────
  if (!document.getElementById('fumocaTourStyles')) {
    const style = document.createElement('style');
    style.id = 'fumocaTourStyles';
    style.textContent = `
      @keyframes fumocaTourFadeIn {
        from { opacity:0; transform:translateY(8px); }
        to   { opacity:1; transform:translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function _isDark(c) {
    try { const h=c.replace('#',''); return (parseInt(h.slice(0,2),16)*299+parseInt(h.slice(2,4),16)*587+parseInt(h.slice(4,6),16)*114)/1000<128; } catch(_){return false;}
  }

  // Expose hotspots array when loaded for external consumption
  window.addEventListener('fumoca:hotspotsParsed', (e) => {
    window._fumocaHotspots = e.detail?.hotspots || window._fumocaHotspots || [];
  });

  return { start, stop, next, prev, isActive, goTo, togglePause };
})();

window._fumocaTour = FumocaTour;
window.FumocaTour = FumocaTour;
