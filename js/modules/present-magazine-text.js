/**
 * FUMOCA Present — Magazine Text Layer
 * ─────────────────────────────────────
 * World-anchored / billboard typography that stays readable while the
 * splat orbits — the "WEEKLY" / "48 HOURS" cover look on a live 3D subject.
 *
 * Modes:
 *   billboard  — text always faces camera (readable while spinning)
 *   locked     — fixed screen anchor with parallax drift (cover feel)
 *   world      — projected from 3D point; hides when behind subject
 *
 * Styles: cover | masthead | kicker | deck | badge | caption
 */

const FONT_STACK = {
  cover:    '"Anton","Impact",sans-serif',
  masthead: '"Anton","Impact",sans-serif',
  kicker:   '"IBM Plex Mono","SF Mono",monospace',
  deck:     '"Inter",system-ui,sans-serif',
  badge:    '"Inter",system-ui,sans-serif',
  caption:  '"Inter",system-ui,sans-serif',
};

let layer = null;
let items = [];
let raf = 0;
let editing = false;
let onChange = null;

function uid() {
  return 'mt_' + Math.random().toString(36).slice(2, 10);
}

function ensureLayer() {
  if (layer) return layer;
  layer = document.getElementById('magazineTextLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'magazineTextLayer';
    layer.className = 'mt-layer';
    const host =
      document.getElementById('stage') ||
      document.getElementById('viewport') ||
      document.getElementById('stageHost') ||
      document.body;
    host.appendChild(layer);
  }
  return layer;
}

function getCamera() {
  return (
    window._fumocaViewerCamera ||
    window._fumocaViewer?.camera ||
    window._fumocaCamera ||
    null
  );
}

function getTHREE() {
  return window.THREE || null;
}

/** Project world → CSS % of stage. Returns null if behind camera. */
function projectWorld(wx, wy, wz) {
  const THREE = getTHREE();
  const cam = getCamera();
  if (!THREE || !cam) return null;
  try {
    cam.updateMatrixWorld?.(true);
    const v = new THREE.Vector3(+wx, +wy, +wz).project(cam);
    if (v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * 100,
      y: (-v.y * 0.5 + 0.5) * 100,
      depth: v.z,
    };
  } catch {
    return null;
  }
}

function styleFor(item) {
  const kind = item.style || 'cover';
  const size = item.fontSize || (kind === 'cover' ? 72 : kind === 'masthead' ? 42 : 16);
  const color = item.color || '#F2EFE6';
  const weight = item.weight || (kind === 'cover' || kind === 'masthead' ? 400 : 600);
  const tracking = item.tracking != null ? item.tracking : kind === 'cover' ? 0.02 : 0.04;
  const opacity = item.opacity != null ? item.opacity : 1;
  const shadow =
    item.shadow === false
      ? 'none'
      : item.shadow ||
        '0 2px 24px rgba(0,0,0,.55), 0 0 1px rgba(0,0,0,.8)';
  return {
    fontFamily: FONT_STACK[kind] || FONT_STACK.deck,
    fontSize: `clamp(${Math.round(size * 0.45)}px, ${size * 0.11}vw, ${size}px)`,
    fontWeight: weight,
    letterSpacing: `${tracking}em`,
    color,
    opacity,
    textShadow: shadow,
    textTransform: item.uppercase === false ? 'none' : kind === 'cover' || kind === 'kicker' ? 'uppercase' : 'none',
    lineHeight: kind === 'cover' ? 0.9 : 1.15,
    mixBlendMode: item.blend || (kind === 'cover' ? 'normal' : 'normal'),
  };
}

function renderItem(item) {
  const el = document.createElement('div');
  el.className = `mt-item mt-${item.style || 'cover'} mt-mode-${item.mode || 'billboard'}`;
  el.dataset.id = item.id;
  el.textContent = item.text || '';
  Object.assign(el.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    transform: 'translate(-50%, -50%)',
    pointerEvents: editing ? 'auto' : 'none',
    whiteSpace: item.wrap ? 'normal' : 'nowrap',
    maxWidth: item.maxWidth || '80%',
    textAlign: item.align || 'center',
    userSelect: 'none',
    cursor: editing ? 'move' : 'default',
    zIndex: 20 + (item.z || 0),
    transition: 'opacity .25s ease',
    ...styleFor(item),
  });
  if (editing) {
    el.addEventListener('pointerdown', (e) => startDrag(e, item, el));
  }
  return el;
}

function startDrag(e, item, el) {
  if (!editing) return;
  e.preventDefault();
  e.stopPropagation();
  const host = ensureLayer().parentElement;
  const rect = host.getBoundingClientRect();
  const move = (ev) => {
    const x = ((ev.clientX - rect.left) / rect.width) * 100;
    const y = ((ev.clientY - rect.top) / rect.height) * 100;
    item.sx = Math.max(2, Math.min(98, x));
    item.sy = Math.max(2, Math.min(98, y));
    item.mode = item.mode === 'world' ? 'world' : 'locked';
    el.style.left = item.sx + '%';
    el.style.top = item.sy + '%';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onChange?.(exportAll());
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function tick() {
  raf = 0;
  const root = ensureLayer();
  const kids = root.querySelectorAll('.mt-item');
  kids.forEach((el) => {
    const item = items.find((i) => i.id === el.dataset.id);
    if (!item) return;

    if (item.mode === 'world' && Number.isFinite(item.wx)) {
      const p = projectWorld(item.wx, item.wy, item.wz);
      if (!p) {
        el.style.opacity = '0';
        return;
      }
      el.style.opacity = String(item.opacity ?? 1);
      el.style.left = p.x + '%';
      el.style.top = p.y + '%';
      // subtle scale by depth so far text is smaller
      const s = 1 - Math.min(0.35, Math.max(0, p.depth) * 0.25);
      el.style.transform = `translate(-50%, -50%) scale(${s})`;
      return;
    }

    if (item.mode === 'billboard') {
      // Screen anchor with gentle orbit parallax from camera yaw
      const cam = getCamera();
      let parallaxX = 0;
      let parallaxY = 0;
      if (cam?.position) {
        parallaxX = Math.sin((cam.position.x || 0) * 0.15) * 1.2;
        parallaxY = Math.cos((cam.position.y || 0) * 0.12) * 0.8;
      }
      const sx = (item.sx ?? 50) + parallaxX;
      const sy = (item.sy ?? 30) + parallaxY;
      el.style.left = sx + '%';
      el.style.top = sy + '%';
      el.style.opacity = String(item.opacity ?? 1);
      el.style.transform = 'translate(-50%, -50%)';
      return;
    }

    // locked — pure screen %
    el.style.left = (item.sx ?? 50) + '%';
    el.style.top = (item.sy ?? 30) + '%';
    el.style.opacity = String(item.opacity ?? 1);
    el.style.transform = 'translate(-50%, -50%)';
  });
  raf = requestAnimationFrame(tick);
}

export function initMagazineText({ editable = false, onChange: cb } = {}) {
  editing = editable;
  onChange = cb || null;
  ensureLayer();
  if (!raf) raf = requestAnimationFrame(tick);
  return api;
}

export function setEditable(v) {
  editing = !!v;
  rebuild();
}

export function addText(partial = {}) {
  const item = {
    id: uid(),
    text: partial.text || 'WEEKLY',
    style: partial.style || 'cover',
    mode: partial.mode || 'billboard',
    sx: partial.sx ?? 50,
    sy: partial.sy ?? 28,
    wx: partial.wx,
    wy: partial.wy,
    wz: partial.wz,
    fontSize: partial.fontSize,
    color: partial.color,
    opacity: partial.opacity ?? 1,
    blend: partial.blend,
    uppercase: partial.uppercase,
    align: partial.align || 'center',
    maxWidth: partial.maxWidth,
    z: partial.z || 0,
  };
  items.push(item);
  rebuild();
  onChange?.(exportAll());
  return item;
}

export function updateText(id, patch) {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  rebuild();
  onChange?.(exportAll());
  return item;
}

export function removeText(id) {
  items = items.filter((i) => i.id !== id);
  rebuild();
  onChange?.(exportAll());
}

export function clearText() {
  items = [];
  rebuild();
  onChange?.(exportAll());
}

export function exportAll() {
  return items.map((i) => ({ ...i }));
}

export function importAll(list = []) {
  items = (list || []).map((i) => ({
    id: i.id || uid(),
    text: i.text || '',
    style: i.style || 'cover',
    mode: i.mode || 'billboard',
    sx: i.sx ?? 50,
    sy: i.sy ?? 30,
    wx: i.wx,
    wy: i.wy,
    wz: i.wz,
    fontSize: i.fontSize,
    color: i.color,
    opacity: i.opacity ?? 1,
    blend: i.blend,
    uppercase: i.uppercase,
    align: i.align,
    maxWidth: i.maxWidth,
    z: i.z || 0,
  }));
  rebuild();
}

function rebuild() {
  const root = ensureLayer();
  root.innerHTML = '';
  items.forEach((item) => root.appendChild(renderItem(item)));
}

/** Presets matching the magazine screenshots the user shared */
export function applyPreset(name) {
  clearText();
  if (name === 'weekly') {
    addText({ text: 'WEEKLY', style: 'cover', mode: 'billboard', sx: 50, sy: 42, fontSize: 96, color: '#FFFFFF' });
  } else if (name === '48hours') {
    addText({ text: '48 HOURS', style: 'cover', mode: 'billboard', sx: 50, sy: 38, fontSize: 88, color: '#F5C518' });
    addText({ text: 'In SA 🇿🇦', style: 'kicker', mode: 'billboard', sx: 72, sy: 52, fontSize: 22, color: '#F5C518' });
  } else if (name === 'product') {
    addText({ text: 'FEATURED', style: 'kicker', mode: 'billboard', sx: 18, sy: 12, fontSize: 14, color: '#C8FF00' });
    addText({ text: 'THE DETAIL', style: 'masthead', mode: 'billboard', sx: 28, sy: 22, fontSize: 48, color: '#F2EFE6' });
    addText({ text: 'Spin to inspect every angle', style: 'deck', mode: 'billboard', sx: 28, sy: 34, fontSize: 15, color: '#CFCBC0' });
  }
}

const api = {
  initMagazineText,
  setEditable,
  addText,
  updateText,
  removeText,
  clearText,
  exportAll,
  importAll,
  applyPreset,
};

export default api;

if (typeof window !== 'undefined') {
  window.FumocaMagazineText = api;
}
