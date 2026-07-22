/**
 * FUMOCA Visual FX Engine v61
 * ═══════════════════════════════════════════════════════════════════
 * Post-process visual layer on top of the Gaussian splat viewer.
 * Implemented in pure CSS + canvas — no renderer rewrite needed.
 *
 * Features:
 *   - Glow: radial bloom around the subject
 *   - Edge lighting: coloured rim/outline that intensifies on focus
 *   - Halo: soft distance fog giving subject a floating look
 *   - Focus illumination: dark-edge vignette that lifts on selection
 *   - Paint variant overlay: CSS hue-rotate for quick colour previews
 *   - All values stored in splat.visual_presets and reloaded live
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaVisualFX = (() => {

  // ── Inject CSS custom-property layer ─────────────────────────────
  const _STYLE_ID = 'fumoca-vfx-layer';

  function _ensureStyle() {
    if (document.getElementById(_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = _STYLE_ID;
    s.textContent = `
      /* ── FUMOCA VFX ── */
      #stage, #stageHost {
        filter:
          drop-shadow(0 0 var(--vfx-glow-radius, 0px) var(--vfx-glow-color, transparent))
          brightness(var(--vfx-brightness, 1))
          saturate(var(--vfx-saturate, 1));
        transition: filter 0.35s ease;
      }
      /* Edge / rim light — CSS outline on a full-screen overlay */
      #vfxEdgeOverlay {
        position: fixed; inset: 0; z-index: 2;
        pointer-events: none;
        border-radius: 0;
        box-shadow: inset 0 0 var(--vfx-edge-spread, 0px) var(--vfx-edge-blur, 0px)
                    var(--vfx-edge-color, transparent);
        transition: box-shadow 0.3s ease;
      }
      /* Halo / fog */
      #vfxHaloOverlay {
        position: fixed; inset: 0; z-index: 2;
        pointer-events: none;
        background: radial-gradient(
          ellipse var(--vfx-halo-w, 60%) var(--vfx-halo-h, 55%) at 50% 52%,
          transparent 0%,
          transparent var(--vfx-halo-inner, 55%),
          var(--vfx-halo-color, transparent) 100%
        );
        transition: background 0.4s ease;
      }
      /* Paint preview — hue shift on the stage */
      #stage.vfx-paint-active, #stageHost.vfx-paint-active {
        filter:
          hue-rotate(var(--vfx-hue-rotate, 0deg))
          saturate(var(--vfx-paint-saturate, 1.15))
          brightness(var(--vfx-paint-brightness, 1.05))
          drop-shadow(0 0 var(--vfx-glow-radius, 0px) var(--vfx-glow-color, transparent));
      }
    `;
    document.head.appendChild(s);

    // Create overlay divs
    ['vfxEdgeOverlay', 'vfxHaloOverlay'].forEach(id => {
      if (!document.getElementById(id)) {
        const d = document.createElement('div');
        d.id = id;
        document.body.appendChild(d);
      }
    });
  }

  function _css(prop, val) {
    document.documentElement.style.setProperty(prop, val);
  }

  // ── Presets ───────────────────────────────────────────────────────
  const PRESETS = {
    none: {
      glowRadius: '0px', glowColor: 'transparent',
      edgeSpread: '0px', edgeBlur: '0px', edgeColor: 'transparent',
      haloColor: 'transparent',
      brightness: '1', saturate: '1',
    },
    car_hero: {
      glowRadius: '32px', glowColor: 'rgba(200,255,0,0.18)',
      edgeSpread: '60px', edgeBlur: '40px', edgeColor: 'rgba(200,255,0,0.12)',
      haloColor: 'rgba(0,0,0,0.45)', haloInner: '52%',
      brightness: '1.08', saturate: '1.2',
    },
    red_rim: {
      glowRadius: '24px', glowColor: 'rgba(255,40,40,0.22)',
      edgeSpread: '80px', edgeBlur: '60px', edgeColor: 'rgba(255,40,40,0.28)',
      haloColor: 'rgba(10,0,0,0.5)', haloInner: '48%',
      brightness: '1.05', saturate: '1.15',
    },
    blue_studio: {
      glowRadius: '28px', glowColor: 'rgba(0,180,255,0.2)',
      edgeSpread: '70px', edgeBlur: '50px', edgeColor: 'rgba(0,180,255,0.18)',
      haloColor: 'rgba(0,5,20,0.55)', haloInner: '50%',
      brightness: '1.1', saturate: '1.25',
    },
    place_warm: {
      glowRadius: '20px', glowColor: 'rgba(255,180,60,0.15)',
      edgeSpread: '50px', edgeBlur: '35px', edgeColor: 'rgba(255,180,60,0.12)',
      haloColor: 'rgba(20,10,0,0.4)', haloInner: '58%',
      brightness: '1.06', saturate: '1.1',
    },
  };

  // ── Apply a preset or custom config ───────────────────────────────
  function apply(config) {
    _ensureStyle();
    const c = typeof config === 'string' ? (PRESETS[config] || PRESETS.none) : config;

    _css('--vfx-glow-radius',  c.glowRadius  || '0px');
    _css('--vfx-glow-color',   c.glowColor   || 'transparent');
    _css('--vfx-edge-spread',  c.edgeSpread  || '0px');
    _css('--vfx-edge-blur',    c.edgeBlur    || '0px');
    _css('--vfx-edge-color',   c.edgeColor   || 'transparent');
    _css('--vfx-halo-color',   c.haloColor   || 'transparent');
    _css('--vfx-halo-inner',   c.haloInner   || '55%');
    _css('--vfx-halo-w',       c.haloW       || '65%');
    _css('--vfx-halo-h',       c.haloH       || '55%');
    _css('--vfx-brightness',   c.brightness  || '1');
    _css('--vfx-saturate',     c.saturate    || '1');

    window.dispatchEvent(new CustomEvent('fumoca:vfxApplied', { detail: { config: c } }));
  }

  // ── Glow intensity on focus/selection ─────────────────────────────
  function setFocusIntensity(t) {
    // t: 0 (no focus) → 1 (full focus)
    const base = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--vfx-glow-radius')) || 0;
    const boosted = base * (1 + t * 1.6);
    _css('--vfx-glow-radius', `${boosted}px`);
    _css('--vfx-edge-spread',  `${parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vfx-edge-spread') || 0) * (1 + t * 1.4)}px`);
  }

  // ── Paint variant (hue rotation) ──────────────────────────────────
  const PAINT_COLORS = {
    original:  { hue: '0deg',    sat: '1',    bri: '1' },
    red:       { hue: '0deg',    sat: '1.4',  bri: '1.05' },
    blue:      { hue: '200deg',  sat: '1.3',  bri: '1.02' },
    green:     { hue: '100deg',  sat: '1.2',  bri: '1.02' },
    black:     { hue: '0deg',    sat: '0.2',  bri: '0.25' },
    white:     { hue: '0deg',    sat: '0.05', bri: '2.2' },
    gold:      { hue: '38deg',   sat: '1.5',  bri: '1.1' },
    silver:    { hue: '200deg',  sat: '0.15', bri: '1.55' },
    purple:    { hue: '270deg',  sat: '1.3',  bri: '1.0' },
    orange:    { hue: '28deg',   sat: '1.5',  bri: '1.05' },
  };

  function applyPaint(colorKey) {
    const stage = document.getElementById('stageHost') || document.getElementById('stage');
    if (!stage) return;
    const p = PAINT_COLORS[colorKey] || PAINT_COLORS.original;
    _css('--vfx-hue-rotate',        p.hue);
    _css('--vfx-paint-saturate',    p.sat);
    _css('--vfx-paint-brightness',  p.bri);
    if (colorKey === 'original') {
      stage.classList.remove('vfx-paint-active');
    } else {
      stage.classList.add('vfx-paint-active');
    }
    window.dispatchEvent(new CustomEvent('fumoca:paintApplied', { detail: { color: colorKey } }));
  }

  // ── Save / load presets to Supabase ───────────────────────────────
  async function savePreset(presetName) {
    const rec = window._fumocaCurrentRecord;
    if (!rec?.id) return;
    const current = rec.visual_presets || {};
    current[presetName] = {
      glowRadius: getComputedStyle(document.documentElement).getPropertyValue('--vfx-glow-radius'),
      glowColor:  getComputedStyle(document.documentElement).getPropertyValue('--vfx-glow-color'),
      edgeSpread: getComputedStyle(document.documentElement).getPropertyValue('--vfx-edge-spread'),
      edgeColor:  getComputedStyle(document.documentElement).getPropertyValue('--vfx-edge-color'),
      haloColor:  getComputedStyle(document.documentElement).getPropertyValue('--vfx-halo-color'),
      brightness: getComputedStyle(document.documentElement).getPropertyValue('--vfx-brightness'),
      saturate:   getComputedStyle(document.documentElement).getPropertyValue('--vfx-saturate'),
    };
    await window._fumocaSupabase?.from('splats')
      .update({ visual_presets: current })
      .eq('id', rec.id);
    console.log(`[VFX] Preset "${presetName}" saved live`);
  }

  async function loadFromRecord(rec) {
    if (!rec) return;
    const presets = rec.visual_presets || {};
    const active  = presets._active;
    if (active && presets[active]) apply(presets[active]);
    else if (rec.asset_type === 'car') apply('car_hero');
    else if (rec.asset_type === 'place') apply('place_warm');
    else apply('none');
  }

  // Auto-load when splat loads
  window.addEventListener('fumoca:recordLoaded', e => {
    loadFromRecord(e.detail?.record || e.detail || window._fumocaCurrentRecord);
  });
  if (window._fumocaCurrentRecord) loadFromRecord(window._fumocaCurrentRecord);

  // ── Public API ────────────────────────────────────────────────────
  return {
    apply,
    applyPaint,
    setFocusIntensity,
    savePreset,
    loadFromRecord,
    presets: PRESETS,
    paintColors: Object.keys(PAINT_COLORS),
  };

})();

window.FumocaVisualFX = FumocaVisualFX;
export default FumocaVisualFX;
