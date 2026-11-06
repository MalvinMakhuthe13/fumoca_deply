/**
 * FUMOCA Present — Magazine Text Layer (clean layouts)
 */

const FONT_STACK = {
  cover:    '"Bebas Neue","Impact",sans-serif',
  masthead: '"Cormorant Garamond","Georgia",serif',
  kicker:   '"IBM Plex Mono","SF Mono",monospace',
  deck:     '"DM Sans",system-ui,sans-serif',
  badge:    '"DM Sans",system-ui,sans-serif',
  caption:  '"DM Sans",system-ui,sans-serif',
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
    // Keep editorial layers inside the same measured surface as the live poster.
    // In poster mode stageHost is resized to the contain-fit canvas, so text cannot
    // drift into the surrounding workspace or escape the poster crop.
    // Studio's poster viewport is the authoritative editorial canvas.
    // Prefer it over stageHost: stageHost can remain the full workspace while
    // #viewport is contain-fitted to the selected poster aspect ratio.
    const isStudioEditor = /\/edit(?:\.html)?\/?$/i.test(window.location.pathname);
    const host = isStudioEditor
      ? (document.getElementById('viewport') || document.getElementById('stageHost') || document.getElementById('stage') || document.body)
      : (document.getElementById('stageHost') || document.getElementById('stage') || document.getElementById('viewport') || document.body);
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
    fontFamily: item.fontFamily || FONT_STACK[kind] || FONT_STACK.deck,
    fontSize: `calc(${size}px * var(--mt-scale, 1))`,
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
    whiteSpace: item.wrap ? 'pre-line' : item.style === 'deck' ? 'normal' : 'nowrap',
    maxWidth: item.maxWidth || (item.style === 'deck' ? '28ch' : '42%'),
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
  const layerWidth = root.getBoundingClientRect().width || root.parentElement?.getBoundingClientRect().width || 0;
  // All magazine typography is authored against a 1080px editorial canvas,
  // then scaled uniformly with the actual poster viewport on every device.
  root.style.setProperty('--mt-scale', String(Math.max(0.28, Math.min(1.5, layerWidth / 1080))));
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
    fontFamily: partial.fontFamily,
    color: partial.color,
    opacity: partial.opacity ?? 1,
    align: partial.align || 'left',
    z: partial.z || 0,
    weight: partial.weight,
    tracking: partial.tracking,
    wrap: !!partial.wrap,
    maxWidth: partial.maxWidth,
    uppercase: partial.uppercase,
    shadow: partial.shadow,
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
    fontSize: i.fontSize, fontFamily: i.fontFamily, color: i.color,
    opacity: i.opacity ?? 1, align: i.align,
    maxWidth: i.maxWidth, uppercase: i.uppercase, z: i.z || 0,
    weight: i.weight, tracking: i.tracking, wrap: !!i.wrap, shadow: i.shadow,
  }));
  rebuild();
}

function rebuild() {
  const root = ensureLayer();
  root.innerHTML = '';
  items.forEach((item) => root.appendChild(renderItem(item)));
}

/** Editorial systems — balanced hierarchy with deliberate safe-area placement. */
export function applyPreset(name) {
  clearText();
  // Editorial covers reserve a clean text column and move the live 3D subject
  // into the opposing visual column when fixed-canvas presentation is enabled.
  const poster = window.FumocaPoster?.getState?.();
  const subjectLayouts = {
    product: { x: 0.69, y: 0.52, scale: 0.94 },
    luxury: { x: 0.69, y: 0.52, scale: 0.94 },
    fashion: { x: 0.68, y: 0.53, scale: 0.9 },
    launch: { x: 0.69, y: 0.52, scale: 0.96 },
    architecture: { x: 0.68, y: 0.52, scale: 0.9 },
    hero: { x: 0.5, y: 0.55, scale: 1.08 },
  };
  if (poster?.enabled && subjectLayouts[name]) {
    window.FumocaPoster.updateComposition({ object: subjectLayouts[name] });
  }
  const add = (text, style, sx, sy, fontSize, color, extra = {}) =>
    addText({ text, style, mode: 'locked', sx, sy, fontSize, color, ...extra });

  if (name === 'weekly') {
    add('WEEKLY', 'cover', 50, 22, 88, '#FFFFFF', { align: 'center', weight: 800 });
  } else if (name === '48hours') {
    add('48 HOURS', 'cover', 50, 20, 72, '#F5C518', { align: 'center', weight: 800 });
    add('IN SOUTH AFRICA', 'kicker', 50, 32, 14, '#F5C518', { align: 'center' });
  } else if (name === 'product' || name === 'luxury') {
    add('OBJECTS OF DESIRE', 'kicker', 12, 12, 12, '#D8C6A0', { tracking: 0.18, weight: 700 });
    add(name === 'luxury' ? 'THE ART OF\nDETAIL' : 'THE DETAIL', 'masthead', 12, 23, name === 'luxury' ? 54 : 48, '#F4EFE5', { weight: 700, maxWidth: '44%', wrap: true, tracking: -0.035 });
    add('A closer look at form, finish and function.', 'deck', 12, 37, 16, '#D1CCC2', { maxWidth: '38%', wrap: true, weight: 400 });
    add('360° · INTERACTIVE', 'badge', 12, 88, 11, '#E7D7B5', { tracking: 0.12 });
    add('FUMOCA EDITION 01', 'caption', 88, 92, 10, '#B7B0A2', { align: 'right', tracking: 0.12 });
  } else if (name === 'hero') {
    add('THE NEXT ICON', 'kicker', 50, 72, 12, '#E8E1D2', { align: 'center', tracking: 0.2 });
    add('MADE TO MOVE', 'cover', 50, 82, 58, '#FFFFFF', { align: 'center', weight: 800, maxWidth: '86%' });
  } else if (name === 'fashion') {
    add('FUMOCA', 'masthead', 50, 10, 48, '#F4EFE8', { align: 'center', weight: 800, tracking: -0.04 });
    add('THE NEW FORM', 'kicker', 50, 17, 10, '#E5C9B1', { align: 'center', tracking: 0.24 });
    add('FORM\nWITHOUT\nLIMITS', 'cover', 10, 70, 48, '#FFFFFF', { maxWidth: '46%', wrap: true, weight: 800, tracking: -0.03 });
    add('ISSUE 01  /  AUTUMN', 'caption', 90, 93, 9, '#E5C9B1', { align: 'right', tracking: 0.14 });
    add('STYLE · OBJECT · CULTURE', 'kicker', 10, 93, 9, '#E5C9B1', { tracking: 0.12 });
  } else if (name === 'launch') {
    add('INTRODUCING', 'kicker', 10, 12, 12, '#C8FF00', { tracking: 0.2, weight: 700 });
    add('A NEW\nPERSPECTIVE', 'cover', 10, 25, 52, '#FFFFFF', { maxWidth: '66%', wrap: true, weight: 800, tracking: -0.04 });
    add('Explore every angle. Discover every detail.', 'deck', 10, 43, 15, '#D5D8D1', { maxWidth: '58%', wrap: true });
    add('AVAILABLE NOW', 'badge', 10, 88, 11, '#10131A', { weight: 800, color: '#C8FF00' });
    add('FUMOCA / PRODUCT STUDIO', 'caption', 90, 93, 9, '#AEB5AA', { align: 'right', tracking: 0.12 });
  } else if (name === 'architecture') {
    add('SPACES / 001', 'kicker', 9, 10, 11, '#D8D1C5', { tracking: 0.18 });
    add('FORM FOLLOWS\nFEELING', 'masthead', 9, 20, 42, '#F4F0E8', { maxWidth: '58%', wrap: true, weight: 500, tracking: -0.025 });
    add('A study in light, material and proportion.', 'deck', 9, 35, 14, '#D0CBC2', { maxWidth: '46%', wrap: true });
    add('ARCHITECTURE · DESIGN · PLACE', 'caption', 9, 92, 9, '#D8D1C5', { tracking: 0.1 });
    add('FUMOCA FIELD NOTES', 'caption', 91, 92, 9, '#D8D1C5', { align: 'right', tracking: 0.1 });
  }
}

const api = {
  initMagazineText, setEditable, addText, updateText, removeText, clearText,
  exportAll, importAll, applyPreset,
};

export default api;
if (typeof window !== 'undefined') window.FumocaMagazineText = api;
