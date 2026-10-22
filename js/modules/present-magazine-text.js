/**
 * FUMOCA Present — Magazine Text Layer (clean layouts)
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
  return window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera || null;
}

function getTHREE() {
  return window.THREE || null;
}

function projectWorld(wx, wy, wz) {
  const THREE = getTHREE();
  const cam = getCamera();
  if (!THREE || !cam) return null;
  try {
    cam.updateMatrixWorld?.(true);
    const v = new THREE.Vector3(+wx, +wy, +wz).project(cam);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100, depth: v.z };
  } catch {
    return null;
  }
}

function styleFor(item) {
  const kind = item.style || 'cover';
  const size = item.fontSize || (kind === 'cover' ? 64 : kind === 'masthead' ? 36 : 14);
  const color = item.color || '#F2EFE6';
  const weight = item.weight || (kind === 'cover' || kind === 'masthead' ? 400 : 600);
  const tracking = item.tracking != null ? item.tracking : kind === 'cover' ? 0.01 : 0.06;
  const opacity = item.opacity != null ? item.opacity : 1;
  const shadow =
    item.shadow === false
      ? 'none'
      : item.shadow || '0 2px 24px rgba(0,0,0,.55), 0 0 1px rgba(0,0,0,.8)';
  return {
    fontFamily: FONT_STACK[kind] || FONT_STACK.deck,
    fontSize: `clamp(${Math.round(size * 0.4)}px, ${size * 0.09}vw, ${size}px)`,
    fontWeight: weight,
    letterSpacing: `${tracking}em`,
    color,
    opacity,
    textShadow: shadow,
    textTransform: item.uppercase === false ? 'none' : kind === 'cover' || kind === 'kicker' || kind === 'badge' ? 'uppercase' : 'none',
    lineHeight: kind === 'cover' ? 0.88 : kind === 'deck' ? 1.35 : 1.1,
    textAlign: item.align || 'left',
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
    whiteSpace: item.wrap ? 'normal' : item.style === 'deck' ? 'normal' : 'nowrap',
    maxWidth: item.maxWidth || (item.style === 'deck' ? '28ch' : 'min(42vw, 520px)'),
    userSelect: 'none',
    cursor: editing ? 'move' : 'default',
    zIndex: 20 + (item.z || 0),
    transition: 'opacity .25s ease',
    ...styleFor(item),
  });
  if (editing) el.addEventListener('pointerdown', (e) => startDrag(e, item, el));
  return el;
}

function startDrag(e, item, el) {
  if (!editing) return;
  e.preventDefault();
  e.stopPropagation();
  const host = ensureLayer().parentElement;
  const rect = host.getBoundingClientRect();
  const move = (ev) => {
    item.sx = Math.max(4, Math.min(96, ((ev.clientX - rect.left) / rect.width) * 100));
    item.sy = Math.max(4, Math.min(96, ((ev.clientY - rect.top) / rect.height) * 100));
    if (item.mode !== 'world') item.mode = 'locked';
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
  root.querySelectorAll('.mt-item').forEach((el) => {
    const item = items.find((i) => i.id === el.dataset.id);
    if (!item) return;

    if (item.mode === 'world' && Number.isFinite(item.wx)) {
      const p = projectWorld(item.wx, item.wy, item.wz);
      if (!p) { el.style.opacity = '0'; return; }
      el.style.opacity = String(item.opacity ?? 1);
      el.style.left = p.x + '%';
      el.style.top = p.y + '%';
      const s = 1 - Math.min(0.3, Math.max(0, p.depth) * 0.2);
      el.style.transform = `translate(-50%, -50%) scale(${s})`;
      return;
    }

    if (item.mode === 'billboard') {
      const cam = getCamera();
      let px = 0, py = 0;
      if (cam?.position) {
        px = Math.sin((cam.position.x || 0) * 0.12) * 0.6;
        py = Math.cos((cam.position.y || 0) * 0.1) * 0.4;
      }
      el.style.left = ((item.sx ?? 50) + px) + '%';
      el.style.top = ((item.sy ?? 30) + py) + '%';
      el.style.opacity = String(item.opacity ?? 1);
      el.style.transform = 'translate(-50%, -50%)';
      return;
    }

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
    text: partial.text || 'TITLE',
    style: partial.style || 'cover',
    mode: partial.mode || 'locked',
    sx: partial.sx ?? 50,
    sy: partial.sy ?? 28,
    wx: partial.wx, wy: partial.wy, wz: partial.wz,
    fontSize: partial.fontSize,
    color: partial.color,
    opacity: partial.opacity ?? 1,
    align: partial.align || 'left',
    maxWidth: partial.maxWidth,
    uppercase: partial.uppercase,
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
    mode: i.mode || 'locked',
    sx: i.sx ?? 50, sy: i.sy ?? 30,
    wx: i.wx, wy: i.wy, wz: i.wz,
    fontSize: i.fontSize, color: i.color,
    opacity: i.opacity ?? 1, align: i.align,
    maxWidth: i.maxWidth, uppercase: i.uppercase, z: i.z || 0,
  }));
  rebuild();
}

function rebuild() {
  const root = ensureLayer();
  root.innerHTML = '';
  items.forEach((item) => root.appendChild(renderItem(item)));
}

/** Clean cover layouts — one focal block, not scattered words */
export function applyPreset(name) {
  clearText();
  if (name === 'weekly') {
    // One big centered title only
    addText({ text: 'WEEKLY', style: 'cover', mode: 'locked', sx: 50, sy: 22, fontSize: 88, color: '#FFFFFF', align: 'center' });
  } else if (name === '48hours') {
    addText({ text: '48 HOURS', style: 'cover', mode: 'locked', sx: 50, sy: 20, fontSize: 72, color: '#F5C518', align: 'center' });
    addText({ text: 'In SA', style: 'kicker', mode: 'locked', sx: 50, sy: 32, fontSize: 14, color: '#F5C518', align: 'center' });
  } else if (name === 'product') {
    // Left stack — magazine column, leaves car clear in center-right
    addText({ text: 'FEATURED', style: 'badge', mode: 'locked', sx: 16, sy: 14, fontSize: 11, color: '#C8FF00', align: 'left' });
    addText({ text: 'THE DETAIL', style: 'masthead', mode: 'locked', sx: 22, sy: 24, fontSize: 40, color: '#F2EFE6', align: 'left' });
    addText({ text: 'Spin to inspect every angle', style: 'deck', mode: 'locked', sx: 22, sy: 34, fontSize: 14, color: '#B8B4A8', align: 'left', maxWidth: '22ch' });
  } else if (name === 'hero') {
    // Bottom title bar style
    addText({ text: 'TAZZ', style: 'cover', mode: 'locked', sx: 50, sy: 82, fontSize: 64, color: '#FFFFFF', align: 'center' });
  }
}

const api = {
  initMagazineText, setEditable, addText, updateText, removeText, clearText,
  exportAll, importAll, applyPreset,
};

export default api;
if (typeof window !== 'undefined') window.FumocaMagazineText = api;
