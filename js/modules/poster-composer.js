/**
 * FUMOCA Poster Composer — presentation model foundation.
 *
 * Defines a stable editorial canvas around the live 3D viewer. The composition
 * stays in its own aspect ratio; responsive layouts calculate a contain-fit
 * viewport instead of stretching or repositioning the surrounding page.
 *
 * This module does not change renderer internals or persist metadata by itself.
 */
const POSTER_VERSION = '0.1.0';

const POSTER_PRESETS = Object.freeze({
  product: Object.freeze({
    label: 'Product Poster',
    aspectRatio: 4 / 5,
    background: { type: 'solid', value: '#10131a' },
    safeArea: 0.06,
    object: { x: 0.5, y: 0.53, scale: 1, rotation: 0 },
    title: { visible: true, text: 'Product title', align: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 42, color: '#ffffff', weight: 750 },
  }),
  story: Object.freeze({
    label: 'Story',
    aspectRatio: 9 / 16,
    background: { type: 'solid', value: '#10131a' },
    safeArea: 0.07,
    object: { x: 0.5, y: 0.48, scale: 0.92, rotation: 0 },
    title: { visible: true, text: 'Your story', align: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 42, color: '#ffffff', weight: 750 },
  }),
  editorial: Object.freeze({
    label: 'Editorial',
    aspectRatio: 3 / 4,
    background: { type: 'solid', value: '#171717' },
    safeArea: 0.065,
    object: { x: 0.5, y: 0.55, scale: 1, rotation: 0 },
    title: { visible: true, text: 'Edition', align: 'left', fontFamily: 'Georgia, serif', fontSize: 42, color: '#ffffff', weight: 700 },
  }),
  landscape: Object.freeze({
    label: 'Landscape Feature',
    aspectRatio: 16 / 9,
    background: { type: 'solid', value: '#10131a' },
    safeArea: 0.055,
    object: { x: 0.58, y: 0.5, scale: 1, rotation: 0 },
    title: { visible: true, text: 'Featured experience', align: 'left', fontFamily: 'system-ui, sans-serif', fontSize: 42, color: '#ffffff', weight: 750 },
  }),
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function normalizePreset(name) {
  const key = String(name || 'product').trim().toLowerCase();
  return POSTER_PRESETS[key] ? key : 'product';
}

function normalizeBackground(background, fallback) {
  if (!background || typeof background !== 'object') return clone(fallback);
  const type = ['solid', 'gradient', 'image'].includes(background.type) ? background.type : 'solid';
  const value = String(background.value ?? fallback.value).trim();
  if (type === 'image' && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) {
    try {
      const url = new URL(value, window.location.origin);
      if (!['https:', 'http:'].includes(url.protocol)) return clone(fallback);
    } catch (_) { return clone(fallback); }
  }
  return {
    type, value: value.slice(0, 180000),
    fit: ['cover','contain','fill'].includes(background.fit) ? background.fit : 'cover',
    position: String(background.position || 'center').slice(0, 80),
    opacity: clamp(background.opacity, 0, 1, 1),
    blur: clamp(background.blur, 0, 40, 0),
    brightness: clamp(background.brightness, 0.2, 2, 1),
  };
}

const initialPreset = normalizePreset(new URLSearchParams(window.location.search).get('poster'));
const state = {
  preset: initialPreset,
  composition: { ...clone(POSTER_PRESETS[initialPreset]), assets: { images: [] } },
  enabled: new URLSearchParams(window.location.search).get('posterMode') === '1',
};

function snapshot() {
  return {
    version: POSTER_VERSION,
    enabled: state.enabled,
    preset: state.preset,
    composition: clone(state.composition),
  };
}

function emit(reason) {
  window.dispatchEvent(new CustomEvent('fumoca:posterChange', {
    detail: { ...snapshot(), reason },
  }));
}

function setPreset(name) {
  const preset = normalizePreset(name);
  state.preset = preset;
  state.composition = clone(POSTER_PRESETS[preset]);
  emit('preset');
  return snapshot();
}

function updateComposition(patch = {}) {
  const current = state.composition;
  if (patch.aspectRatio !== undefined) {
    current.aspectRatio = clamp(patch.aspectRatio, 0.35, 3.5, current.aspectRatio);
  }
  if (patch.safeArea !== undefined) {
    current.safeArea = clamp(patch.safeArea, 0, 0.2, current.safeArea);
  }
  if (patch.background !== undefined) {
    current.background = normalizeBackground({ ...current.background, ...patch.background }, current.background);
  }
  if (patch.object && typeof patch.object === 'object') {
    current.object = {
      ...current.object,
      x: clamp(patch.object.x, 0, 1, current.object.x),
      y: clamp(patch.object.y, 0, 1, current.object.y),
      scale: clamp(patch.object.scale, 0.1, 4, current.object.scale),
      rotation: clamp(patch.object.rotation, -360, 360, current.object.rotation),
    };
  }
  if (patch.assets && typeof patch.assets === 'object') {
    const images = Array.isArray(patch.assets.images) ? patch.assets.images : current.assets?.images || [];
    current.assets = {
      images: images.slice(0, 12).map((item, index) => ({
        id: String(item.id || ('asset_' + index)).slice(0, 80),
        src: String(item.src || '').slice(0, 180000),
        name: String(item.name || 'Image').slice(0, 120),
        x: clamp(item.x, 0, 1, 0.5), y: clamp(item.y, 0, 1, 0.5),
        width: clamp(item.width, 0.05, 1, 0.24),
        rotation: clamp(item.rotation, -180, 180, 0),
        opacity: clamp(item.opacity, 0, 1, 1),
        z: clamp(item.z, 1, 19, index + 1),
        fit: ['contain','cover'].includes(item.fit) ? item.fit : 'contain',
        visible: item.visible !== false,
      })).filter(item => /^data:image\/(png|jpeg|webp|gif);base64,/.test(item.src) || /^https?:\/\//.test(item.src)),
    };
  }
  if (patch.title && typeof patch.title === 'object') {
    current.title = {
      ...current.title,
      visible: patch.title.visible === undefined ? current.title.visible : Boolean(patch.title.visible),
      text: patch.title.text === undefined ? current.title.text : String(patch.title.text).slice(0, 160),
      align: ['left', 'center', 'right'].includes(patch.title.align) ? patch.title.align : current.title.align,
      fontFamily: ['system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'Impact, sans-serif', 'monospace'].includes(patch.title.fontFamily) ? patch.title.fontFamily : current.title.fontFamily,
      fontSize: clamp(patch.title.fontSize, 12, 120, current.title.fontSize || 42),
      color: /^#[0-9a-f]{6}$/i.test(String(patch.title.color || '')) ? patch.title.color : current.title.color,
      weight: clamp(patch.title.weight, 400, 900, current.title.weight || 750),
    };
  }
  emit('composition');
  return snapshot();
}

function setEnabled(enabled) {
  state.enabled = Boolean(enabled);
  emit('enabled');
  return snapshot();
}

/**
 * Returns a centered contain-fit poster rectangle for the available viewport.
 * The poster's designed aspect ratio is never distorted.
 */
function getLayout(width, height) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (!w || !h) return { width: 0, height: 0, left: 0, top: 0, scale: 0 };
  const ratio = state.composition.aspectRatio;
  const fitWidth = Math.min(w, h * ratio);
  const fitHeight = fitWidth / ratio;
  const left = (w - fitWidth) / 2;
  const top = (h - fitHeight) / 2;
  const safeInset = fitWidth * state.composition.safeArea;
  const object = state.composition.object;
  return {
    width: fitWidth,
    height: fitHeight,
    left,
    top,
    scale: fitWidth,
    aspectRatio: ratio,
    // Pixel-space geometry is the stable contract consumed by the poster
    // renderer. Keep the designed canvas separate from the surrounding page.
    safe: {
      left: safeInset,
      top: safeInset,
      right: fitWidth - safeInset,
      bottom: fitHeight - safeInset,
      width: fitWidth - (safeInset * 2),
      height: fitHeight - (safeInset * 2),
    },
    object: {
      x: object.x * fitWidth,
      y: object.y * fitHeight,
      scale: object.scale,
      rotation: object.rotation,
      anchor: 'center',
    },
    background: clone(state.composition.background),
    assets: clone(state.composition.assets || { images: [] }),
    title: clone(state.composition.title),
  };
}

window.FumocaPoster = Object.freeze({
  version: POSTER_VERSION,
  getState: snapshot,
  getPresets: () => Object.entries(POSTER_PRESETS).map(([name, preset]) => ({
    name, label: preset.label, aspectRatio: preset.aspectRatio,
  })),
  setPreset,
  updateComposition,
  setEnabled,
  getLayout,
  reset: () => setPreset(state.preset),
});

console.info('[FUMOCA Poster] Composition model ready', POSTER_VERSION);
