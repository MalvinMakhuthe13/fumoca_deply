/**
 * Camera filters for the 3D picture (posters, covers, newspapers, plain view).
 *
 * The filter sits in a see-through layer on top of the 3D canvas and filters
 * what is behind it (backdrop-filter), so typography and layout chrome above
 * it stay crisp. Optional "tap to reveal": the scan starts in the filter and,
 * where the viewer taps, the real colour spreads out from that spot.
 */

export const FILTERS = {
  none:      { label: 'None', css: '' },
  vivid:     { label: 'Vivid', css: 'saturate(1.45) contrast(1.08)' },
  mono:      { label: 'Mono', css: 'grayscale(1) contrast(1.05)' },
  noir:      { label: 'Noir', css: 'grayscale(1) contrast(1.55) brightness(0.92)', vignette: 0.55 },
  sepia:     { label: 'Sepia', css: 'sepia(0.85) contrast(1.05) brightness(1.02)', vignette: 0.25 },
  vintage:   { label: 'Vintage film', css: 'sepia(0.35) saturate(0.85) contrast(0.92) brightness(1.06)', grain: 0.35, vignette: 0.35, tint: 'rgba(255,170,90,.10)' },
  fade:      { label: 'Faded', css: 'contrast(0.82) brightness(1.1) saturate(0.8)', tint: 'rgba(240,240,255,.08)' },
  warm:      { label: 'Warm', css: 'sepia(0.25) saturate(1.2) hue-rotate(-8deg)', tint: 'rgba(255,140,60,.08)' },
  cool:      { label: 'Cool', css: 'saturate(1.05) hue-rotate(12deg) brightness(1.03)', tint: 'rgba(80,140,255,.10)' },
  cinematic: { label: 'Cinematic', css: 'contrast(1.18) saturate(0.9) brightness(0.96)', tint: 'rgba(0,120,140,.12)', vignette: 0.45 },
  polaroid:  { label: 'Instant photo', css: 'contrast(0.9) saturate(1.15) brightness(1.08) sepia(0.15)', grain: 0.2, tint: 'rgba(255,230,180,.08)' },
  cross:     { label: 'Cross-process', css: 'saturate(1.5) contrast(1.2) hue-rotate(-14deg)', tint: 'rgba(255,255,0,.06)' },
  cyber:     { label: 'Cyber', css: 'saturate(1.6) contrast(1.15) hue-rotate(190deg)', tint: 'rgba(255,0,180,.10)', vignette: 0.4 },
  newsprint: { label: 'Newsprint', css: 'grayscale(1) contrast(1.35) brightness(1.06)', grain: 0.55, tint: 'rgba(235,225,200,.18)' },
  dream:     { label: 'Dreamy', css: 'brightness(1.1) saturate(1.1) blur(0.6px) contrast(0.9)', tint: 'rgba(255,200,240,.10)' },
};

export const DEFAULT_FILTER = Object.freeze({ id: 'none', strength: 1, reveal: 'none', revealBack: 0 });

export function normalizeFilter(f) {
  if (!f || typeof f !== 'object') return { ...DEFAULT_FILTER };
  const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return {
    id: FILTERS[f.id] ? f.id : 'none',
    strength: n(f.strength, 0, 1, 1),
    // none: always filtered · tap: real colour spreads from where the viewer taps
    reveal: ['none', 'tap'].includes(f.reveal) ? f.reveal : 'none',
    // seconds before the filter comes back after a reveal (0 = stays revealed)
    revealBack: n(f.revealBack, 0, 60, 0),
  };
}

/** Scale a CSS filter chain toward "no effect" by strength (0..1). */
export function scaleCss(css, k) {
  if (!css || k >= 0.999) return css || '';
  if (k <= 0.001) return '';
  return css.replace(/([a-z-]+)\(([-\d.]+)(deg|px)?\)/g, (m, fn, v, unit = '') => {
    const x = +v;
    const neutral = { grayscale: 0, sepia: 0, 'hue-rotate': 0, blur: 0, invert: 0 }[fn] ?? 1;
    const y = neutral + (x - neutral) * k;
    return `${fn}(${+y.toFixed(4)}${unit})`;
  });
}

function findCanvas() {
  const r = window._fumocaViewerRenderer || window._fumocaGlRenderer || window.renderer || window._fumocaRenderer;
  if (r?.domElement?.isConnected) return r.domElement;
  let best = null, area = 0;
  for (const c of document.querySelectorAll('canvas')) { const b = c.getBoundingClientRect(); if (b.width * b.height > area && getComputedStyle(c).display !== 'none') { best = c; area = b.width * b.height; } }
  return best;
}

let grainUrl = null;
function grain() {
  if (grainUrl) return grainUrl;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 40; }
  g.putImageData(img, 0, 0); grainUrl = c.toDataURL();
  return grainUrl;
}

export class FilterLayer {
  constructor() {
    this.state = { ...DEFAULT_FILTER };
    this.el = null; this.canvas = null; this.revealed = false; this.anim = 0; this.backTimer = 0;
    // Layout layers (text, poster editor) sit above the canvas, so listen on the
    // page and accept taps that land on the 3D picture, not on controls or text.
    this._onDown = (e) => {
      this._down = null;
      if (!this.el || this.state.reveal !== 'tap') return;
      const r = this.el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      if (e.target?.closest?.('button,input,select,textarea,a,label,.mt-item,.mt-selected,#panelLeft,#panelRight,.fumoca-inspect-bar,.fumoca-inspect-btn,[data-no-reveal]')) return;
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this._onUp = (e) => {
      const d = this._down; this._down = null;
      if (!d || this.state.reveal !== 'tap' || this.state.id === 'none' || this.revealed) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 600) return;   // a drag turns the view
      this.revealAt(e.clientX, e.clientY);
    };
    this._place = () => this.place();
  }

  mount() {
    const canvas = findCanvas();
    if (!canvas) return false;
    if (this.canvas !== canvas) {
      this.canvas = canvas;
      if (!this._listening) { window.addEventListener('pointerdown', this._onDown, true); window.addEventListener('pointerup', this._onUp, true); this._listening = true; }
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'fumoca-filter-layer';
      this.el.setAttribute('aria-hidden', 'true');
      this.el.style.cssText = 'position:absolute;pointer-events:none;z-index:2;left:0;top:0;width:0;height:0;';
      this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this._place) : null;
      window.addEventListener('resize', this._place);
    }
    const host = canvas.parentElement;
    if (this.el.parentElement !== host) {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      canvas.insertAdjacentElement('afterend', this.el);
      this.ro?.disconnect(); this.ro?.observe(canvas);
    }
    this.place();
    return true;
  }

  place() {
    if (!this.el || !this.canvas) return;
    const host = this.el.parentElement; if (!host) return;
    const a = this.canvas.getBoundingClientRect(), b = host.getBoundingClientRect();
    Object.assign(this.el.style, { left: `${a.left - b.left + host.scrollLeft}px`, top: `${a.top - b.top + host.scrollTop}px`, width: `${a.width}px`, height: `${a.height}px` });
  }

  set(filter) {
    this.state = normalizeFilter(filter);
    this.revealed = false; cancelAnimationFrame(this.anim); clearTimeout(this.backTimer);
    this.apply();
  }

  apply(mask = null) {
    if (!this.mount()) return;
    const f = FILTERS[this.state.id] || FILTERS.none, k = this.state.strength;
    const on = this.state.id !== 'none' && !this.revealed;
    const css = on ? scaleCss(f.css, k) : '';
    const s = this.el.style;
    s.backdropFilter = s.webkitBackdropFilter = css || 'none';
    const layers = [];
    if (on && f.vignette) layers.push(`radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${(f.vignette * k).toFixed(3)}) 100%)`);
    if (on && f.tint) layers.push(`linear-gradient(${f.tint.replace(/,([\d.]+)\)$/, (m, a) => `,${(+a * k).toFixed(3)})`)}, ${f.tint.replace(/,([\d.]+)\)$/, (m, a) => `,${(+a * k).toFixed(3)})`)})`);
    if (on && f.grain) layers.push(`url(${grain()})`);
    s.backgroundImage = layers.join(',') || 'none';
    s.backgroundSize = layers.map(l => l.startsWith('url(') ? '128px 128px' : '100% 100%').join(',') || '';
    s.opacity = on && f.grain ? '1' : '1';
    s.display = on ? 'block' : 'none';
    s.maskImage = s.webkitMaskImage = mask || 'none';
  }

  /** Real colour spreads out from this screen point. */
  revealAt(clientX, clientY) {
    if (!this.el || this.state.id === 'none') return;
    const r = this.el.getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    const far = Math.max(Math.hypot(x, y), Math.hypot(r.width - x, y), Math.hypot(x, r.height - y), Math.hypot(r.width - x, r.height - y));
    const t0 = performance.now(), dur = 1100;
    cancelAnimationFrame(this.anim);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3, rad = e * far * 1.05;
      this.apply(`radial-gradient(circle at ${x}px ${y}px, transparent ${rad}px, #000 ${rad + 60}px)`);
      if (k < 1) this.anim = requestAnimationFrame(step);
      else {
        this.revealed = true; this.apply();
        window.dispatchEvent(new CustomEvent('fumoca:filterRevealed'));
        if (this.state.revealBack > 0) this.backTimer = setTimeout(() => { this.revealed = false; this.apply(); }, this.state.revealBack * 1000);
      }
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Off while inspecting full screen; back on afterwards. */
  suspend(on) { if (this.el) this.el.style.visibility = on ? 'hidden' : ''; }

  get() { return { ...this.state }; }
}

let shared = null;
export function filterLayer() { if (!shared) shared = new FilterLayer(); return shared; }
if (typeof window !== 'undefined') window.FumocaFilters = { FILTERS, normalizeFilter, scaleCss, layer: filterLayer };

// The poster layout can move the 3D canvas into its frame: follow it.
if (typeof window !== 'undefined') {
  const follow = () => requestAnimationFrame(() => { if (shared && shared.state.id !== 'none') shared.apply(); });
  window.addEventListener('fumoca:posterChange', follow);
  window.addEventListener('resize', follow);
}
