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
let selectedTextId = null;

function uid() {
  return 'mt_' + Math.random().toString(36).slice(2, 10);
}

function ensureLayer() {
  if (!layer) {
    layer = document.getElementById('magazineTextLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'magazineTextLayer';
      layer.className = 'mt-layer';
    }
  }
  // The Studio poster canvas is created by poster-viewport after module boot.
  // Reparent the text layer when it appears so all editorial layers share the
  // exact poster-local coordinate system, rather than the wider editor stage.
  const isStudioEditor = /\/edit(?:\.html)?\/?$/i.test(window.location.pathname);
  const viewport = isStudioEditor
    ? (document.getElementById('viewport') || document.getElementById('stageHost') || document.getElementById('stage') || document.body)
    : (document.getElementById('stageHost') || document.getElementById('stage') || document.getElementById('viewport') || document.body);
  const host = isStudioEditor
    ? (viewport.querySelector?.('[data-fumoca-poster-canvas]') || viewport)
    : viewport;
  if (layer.parentElement !== host) host.appendChild(layer);
  Object.assign(layer.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    overflow: 'hidden', pointerEvents: 'none', zIndex: '20',
  });
  // Delegate pointer handling from the text layer in capture phase. This
  // keeps text dragging reliable when poster canvas / renderer overlays are
  // remounted, and avoids depending on a per-node handler surviving rebuilds.
  if (!layer.dataset.dragDelegateBound) {
    layer.dataset.dragDelegateBound = '1';
    layer.addEventListener('pointerdown', event => {
      if (!editing || event.button !== 0) return;
      const el = event.target.closest?.('.mt-item');
      if (!el || !layer.contains(el)) return;
      const item = items.find(entry => entry.id === el.dataset.id);
      if (!item || item.locked) return;
      const handle = event.target.closest?.('[data-resize]');
      if (handle) { startResize(event, item, handle.dataset.resize); return; }
      selectedTextId = item.id;
      layer.querySelectorAll('.mt-item').forEach(node => node.classList.toggle('mt-selected', node === el));
      startDrag(event, item, el);
    }, true);
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

function textAnchorTransform(align = 'center') {
  if (align === 'left') return 'translate(0, -50%)';
  if (align === 'right') return 'translate(-100%, -50%)';
  return 'translate(-50%, -50%)';
}

function itemTransform(item) { return textAnchorTransform(item.align) + ' rotate(' + (Number(item.rotation) || 0) + 'deg)'; }

function renderItem(item) {
  const el = document.createElement('div');
  el.className = `mt-item mt-${item.style || 'cover'} mt-mode-${item.mode || 'billboard'}`;
  el.dataset.id = item.id;
  el.textContent = item.text || '';
  if (editing && selectedTextId === item.id) {
    el.classList.add('mt-selected');
    ['nw', 'ne', 'sw', 'se'].forEach(position => {
      const handle = document.createElement('span');
      handle.className = 'mt-resize-handle mt-resize-' + position;
      handle.dataset.resize = position;
      handle.setAttribute('aria-label', 'Resize text');
      el.appendChild(handle);
    });
  }

  Object.assign(el.style, {
    position: 'absolute',
    // Restore the saved poster-local anchor for every text item. The previous
    // renderer initialized both coordinates to zero, so freshly restored
    // public viewers silently stacked all copy at the upper-left corner.
    left: (Number(item.sx ?? 50)) + '%',
    top: (Number(item.sy ?? 30)) + '%',
    // Treat the authored X coordinate as the text alignment anchor. Left-
    // aligned cover copy starts at its X coordinate instead of extending
    // half its width to the left of the poster; centered/right copy anchor
    // on their corresponding edges.
    transform: itemTransform(item),
    pointerEvents: editing ? 'auto' : 'none',
    // Text must wrap within the poster canvas. Previously cover/kicker items
    // defaulted to nowrap, so long headlines could paint beyond the safe frame
    // even though the viewport itself was correctly clipped.
    whiteSpace: item.wrap ? 'pre-line' : 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'normal',
    boxSizing: 'border-box',
    maxWidth: item.maxWidth || (item.style === 'deck' ? '28ch' : '42%'),
    userSelect: 'none',
    cursor: editing ? 'move' : 'default',
    zIndex: 20 + (item.z || 0),
    transition: 'opacity .25s ease',
    ...styleFor(item),
  });
  return el;
}

function startResize(e, item, position) {
  if (!editing || item.locked) return;
  e.preventDefault();
  e.stopPropagation();
  const host = ensureLayer().parentElement;
  const startX = e.clientX, startY = e.clientY;
  const startSize = Number(item.fontSize) || (item.style === 'cover' ? 64 : 24);
  const direction = position.includes('e') ? 1 : -1;
  const startWidth = host.getBoundingClientRect().width || 1080;
  const move = ev => {
    const delta = ((ev.clientX - startX) * direction + (ev.clientY - startY)) / 2;
    item.fontSize = Math.max(8, Math.min(240, startSize + delta * 2 * (1080 / startWidth)));
    const el = ensureLayer().querySelector('[data-id="' + item.id + '"]');
    if (el) el.style.fontSize = 'calc(' + item.fontSize + 'px * var(--mt-scale, 1))';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onChange?.(exportAll());
    rebuild();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startDrag(e, item, el) {
  if (!editing || item.locked) return;
  e.preventDefault();
  e.stopPropagation();
  const target = ensureLayer();
  const rect = target.getBoundingClientRect();
  // Capture the pointer on the actual text element so moving outside the glyph
  // bounds never drops the drag. Coordinates are measured against the same
  // poster-local layer used by the rendered text.
  try { el.setPointerCapture?.(e.pointerId); } catch (_) {}
  e.preventDefault();
  e.stopPropagation();
  // Keep the original grab point relative to the text anchor. Without this
  // offset the first pointer move snaps text so its anchor jumps under the cursor.
  const startX = Number(item.sx ?? 50), startY = Number(item.sy ?? 30);
  const pointerX = e.clientX, pointerY = e.clientY;
  const move = (ev) => {
    item.sx = Math.max(0, Math.min(100, startX + ((ev.clientX - pointerX) / Math.max(1, rect.width)) * 100));
    item.sy = Math.max(0, Math.min(100, startY + ((ev.clientY - pointerY) / Math.max(1, rect.height)) * 100));
    // A manual drag converts even world-anchored copy into a freely placed poster layer.
    item.mode = 'locked';
    el.style.left = item.sx + '%';
    el.style.top = item.sy + '%';
    el.style.transform = itemTransform(item);
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    try { el.releasePointerCapture?.(ev.pointerId); } catch (_) {}
    onChange?.(exportAll());
    rebuild();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
  window.addEventListener('pointercancel', up, { once: true });
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
      const viewport = root.parentElement;
      const viewportRect = viewport?.getBoundingClientRect();
      const layerRect = root.getBoundingClientRect();
      const screenX = (p.x / 100) * (viewportRect?.width || layerRect.width);
      const screenY = (p.y / 100) * (viewportRect?.height || layerRect.height);
      el.style.left = (((screenX + (viewportRect?.left || 0) - layerRect.left) / Math.max(1, layerRect.width)) * 100) + '%';
      el.style.top = (((screenY + (viewportRect?.top || 0) - layerRect.top) / Math.max(1, layerRect.height)) * 100) + '%';
      const s = 1 - Math.min(0.3, Math.max(0, p.depth) * 0.2);
      el.style.transform = `translate(-50%, -50%) scale(${s}) rotate(${Number(item.rotation) || 0}deg)`;
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
      el.style.transform = itemTransform(item);
      return;
    }

    el.style.left = (item.sx ?? 50) + '%';
    el.style.top = (item.sy ?? 30) + '%';
    el.style.opacity = String(item.opacity ?? 1);
    el.style.transform = itemTransform(item);
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
    rotation: Number(partial.rotation) || 0,
    locked: !!partial.locked,
    weight: partial.weight,
    tracking: partial.tracking,
    wrap: !!partial.wrap,
    maxWidth: partial.maxWidth,
    uppercase: partial.uppercase,
    shadow: partial.shadow,
  };
  items.push(item);
  selectedTextId = item.id;
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
  if (selectedTextId === id) selectedTextId = items.length ? items[items.length - 1].id : null;
  rebuild();
  onChange?.(exportAll());
}

export function clearText() {
  items = [];
  selectedTextId = null;
  rebuild();
  onChange?.(exportAll());
}

export function selectText(id) {
  selectedTextId = items.some(item => item.id === id) ? id : null;
  rebuild();
  return selectedTextId;
}

export function getSelectedTextId() { return selectedTextId; }

export function moveTextLayer(id, direction) {
  const item = items.find(entry => entry.id === id);
  if (!item || item.locked) return null;
  const levels = items.map(entry => Number(entry.z) || 0);
  item.z = direction === 'front' ? Math.max(0, ...levels) + 1 : Math.min(0, ...levels) - 1;
  rebuild();
  onChange?.(exportAll());
  return item;
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
    rotation: Number(i.rotation) || 0, locked: !!i.locked,
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

export { textAnchorTransform };

const api = {
  initMagazineText, setEditable, addText, updateText, removeText, clearText,
  exportAll, importAll, applyPreset, selectText, getSelectedTextId, moveTextLayer,
};

export default api;
if (typeof window !== 'undefined') window.FumocaMagazineText = api;
