/**
 * FUMOCA Poster Composer — presentation model foundation.
 *
 * Defines a stable editorial canvas around the live 3D viewer. The composition
 * stays in its own aspect ratio; responsive layouts calculate a contain-fit
 * viewport instead of stretching or repositioning the surrounding page.
 *
 * This module does not change renderer internals or persist metadata by itself.
 */
const POSTER_VERSION = '0.2.1';
const MAX_IMAGE_DATA_URL_CHARS = 8 * 1024 * 1024;

const POSTER_PRESETS = Object.freeze({
  product: Object.freeze({
    label: 'Product Poster',
    aspectRatio: 4 / 5,
    background: { type: 'solid', value: '#10131a' },
    safeArea: 0.06,
    framing: { zoom: 1 },
    motion: { level: 'still' },
    object: { x: 0.5, y: 0.53, scale: 1, rotation: 0 },
    title: { visible: true, text: 'Product title', align: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 42, color: '#ffffff', weight: 750 },
  }),
  story: Object.freeze({
    label: 'Story',
    aspectRatio: 9 / 16,
    background: { type: 'solid', value: '#10131a' },
    safeArea: 0.07,
    framing: { zoom: 1 },
    object: { x: 0.5, y: 0.48, scale: 0.92, rotation: 0 },
    title: { visible: true, text: 'Your story', align: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 42, color: '#ffffff', weight: 750 },
    motion: { level: 'still' },
  }),
  editorial: Object.freeze({
    label: 'Editorial',
    aspectRatio: 3 / 4,
    background: { type: 'solid', value: '#171717' },
    safeArea: 0.065,
    framing: { zoom: 1 },
    object: { x: 0.5, y: 0.55, scale: 1, rotation: 0 },
    title: { visible: true, text: 'Edition', align: 'left', fontFamily: 'Georgia, serif', fontSize: 42, color: '#ffffff', weight: 700 },
    motion: { level: 'still' },
  }),
  landscape: Object.freeze({
    label: 'Landscape Feature',
    aspectRatio: 16 / 9,
    background: { type: 'solid', value: '#10131a' },
    safeArea: 0.055,
    framing: { zoom: 1 },
    object: { x: 0.58, y: 0.5, scale: 1, rotation: 0 },
    title: { visible: true, text: 'Featured experience', align: 'left', fontFamily: 'system-ui, sans-serif', fontSize: 42, color: '#ffffff', weight: 750 },
    motion: { level: 'still' },
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
  let value = String(background.value ?? fallback.value).trim();
  if (type === 'gradient' && !/^(linear|radial)-gradient\([a-zA-Z0-9#\s.,%()\-]+\)$/i.test(value)) return clone(fallback);
  if (type === 'image' && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) {
    try {
      const url = new URL(value, window.location.origin);
      if (!['https:', 'http:'].includes(url.protocol)) return clone(fallback);
    } catch (_) { return clone(fallback); }
  }
  if (type === 'image' && value.startsWith('data:') && value.length > MAX_IMAGE_DATA_URL_CHARS) return clone(fallback);
  return {
    type, value,
    r2Key: String(background.r2Key || '').slice(0, 500),
    bucket: String(background.bucket || '').slice(0, 80),
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
  composition: { ...clone(POSTER_PRESETS[initialPreset]), assets: { images: [] }, subjects: [{ id: 'subject_main', label: 'Main subject', source: { type: 'current' }, x: POSTER_PRESETS[initialPreset].object.x, y: POSTER_PRESETS[initialPreset].object.y, scale: POSTER_PRESETS[initialPreset].object.scale, rotation: POSTER_PRESETS[initialPreset].object.rotation, visible: true, locked: false, z: 1 }] },
  selectedSubjectId: 'subject_main',
  enabled: new URLSearchParams(window.location.search).get('posterMode') === '1',
};

function snapshot() {
  return {
    version: POSTER_VERSION,
    enabled: state.enabled,
    preset: state.preset,
    composition: clone(state.composition),
    selectedSubjectId: state.selectedSubjectId,
  };
}

function emit(reason) {
  window.dispatchEvent(new CustomEvent('fumoca:posterChange', {
    detail: { ...snapshot(), reason },
  }));
}

function setPreset(name) {
  const preset = normalizePreset(name);
  const previous = state.composition || {};
  const previousAssets = clone(previous.assets || { images: [] });
  const previousSubjects = clone(previous.subjects || []);
  const previousObject = clone(previous.object || POSTER_PRESETS[preset].object);
  const next = clone(POSTER_PRESETS[preset]);

  // Changing the canvas format must not destroy the user's editorial work.
  // Keep uploaded layers and all independently positioned subjects intact.
  next.assets = previousAssets;
  next.subjects = previousSubjects.length ? previousSubjects : [{
    id: 'subject_main',
    label: 'Main subject',
    source: { type: 'current' },
    ...previousObject,
    visible: true,
    locked: false,
    z: 1,
  }];
  next.object = previousObject;
  state.preset = preset;
  state.composition = next;

  if (!next.subjects.some(item => item.id === state.selectedSubjectId)) {
    state.selectedSubjectId = next.subjects[0]?.id || 'subject_main';
  }
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
  if (patch.framing && typeof patch.framing === 'object') {
    current.framing = { ...current.framing, zoom: clamp(patch.framing.zoom, 0.5, 2.5, current.framing?.zoom || 1) };
  }
  if (patch.motion && typeof patch.motion === 'object') {
    current.motion = { level: ['still', 'gentle', 'normal', 'dynamic'].includes(patch.motion.level) ? patch.motion.level : (current.motion?.level || 'still') };
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
    const primary = current.subjects?.find(item => item.id === 'subject_main') || current.subjects?.[0];
    if (primary) Object.assign(primary, current.object);
  }
  if (patch.subjects !== undefined) {
    const incoming = Array.isArray(patch.subjects) ? patch.subjects : [];
    current.subjects = incoming.slice(0, 24).map((item, index) => ({
      id: String(item.id || ('subject_' + index)).slice(0, 80),
      label: String(item.label || ('Subject ' + (index + 1))).slice(0, 100),
      source: {
        type: ['current', 'nif', 'ply', 'url'].includes(item.source?.type) ? item.source.type : 'current',
        assetId: String(item.source?.assetId || '').slice(0, 160),
        url: String(item.source?.url || '').slice(0, 2000),
      },
      x: clamp(item.x, 0, 1, 0.5), y: clamp(item.y, 0, 1, 0.5),
      scale: clamp(item.scale, 0.1, 4, 1), rotation: clamp(item.rotation, -360, 360, 0),
      visible: item.visible !== false, locked: Boolean(item.locked),
      z: clamp(item.z, 1, 99, index + 1),
    })).filter(item => item.source.type === 'current' || (item.source.type === 'nif' && item.source.assetId) ||
      (item.source.type === 'ply' && item.source.url && /^https?:\/\//i.test(item.source.url)) ||
      (item.source.type === 'url' && item.source.url && /^https?:\/\//i.test(item.source.url)));
    if (!current.subjects.length) {
      current.subjects = [{ id: 'subject_main', label: 'Main subject', source: { type: 'current' }, ...clone(current.object), visible: true, locked: false, z: 1 }];
    }
    if (!current.subjects.some(item => item.id === state.selectedSubjectId)) state.selectedSubjectId = current.subjects[0].id;
    const primary = current.subjects.find(item => item.id === 'subject_main') || current.subjects[0];
    current.object = { x: primary.x, y: primary.y, scale: primary.scale, rotation: primary.rotation };
  }
  if (patch.assets && typeof patch.assets === 'object') {
    const images = Array.isArray(patch.assets.images) ? patch.assets.images : current.assets?.images || [];
    current.assets = {
      images: images.slice(0, 12).map((item, index) => ({
        id: String(item.id || ('asset_' + index)).slice(0, 80),
        src: String(item.src || ''),
        r2Key: String(item.r2Key || '').slice(0, 500),
        bucket: String(item.bucket || '').slice(0, 80),
        name: String(item.name || 'Image').slice(0, 120),
        x: clamp(item.x, 0, 1, 0.5), y: clamp(item.y, 0, 1, 0.5),
        width: clamp(item.width, 0.05, 1, 0.24),
        sizeMode: ['proportional','fixed','responsive'].includes(item.sizeMode) ? item.sizeMode : 'proportional',
        fixedWidthPx: clamp(item.fixedWidthPx, 24, 4000, 240),
        minWidthPx: clamp(item.minWidthPx, 24, 1200, 72),
        maxWidthPx: clamp(item.maxWidthPx, 48, 4000, 720),
        anchor: ['free','top-left','top','top-right','left','center','right','bottom-left','bottom','bottom-right'].includes(item.anchor) ? item.anchor : 'free',
        locked: Boolean(item.locked),
        rotation: clamp(item.rotation, -180, 180, 0),
        opacity: clamp(item.opacity, 0, 1, 1),
        z: clamp(item.z, 1, 99, index + 1),
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

function addSubject(input = {}) {
  const current = state.composition;
  if (!Array.isArray(current.subjects)) current.subjects = [];
  if (current.subjects.length >= 24) throw new Error('A composition can contain up to 24 subjects.');
  const id = String(input.id || ('subject_' + Math.random().toString(36).slice(2, 11)));
  if (current.subjects.some(item => item.id === id)) throw new Error('A subject with this ID already exists.');
  const subject = {
    id, label: String(input.label || ('Subject ' + (current.subjects.length + 1))).slice(0, 100),
    source: { type: ['nif','ply','url'].includes(input.source?.type) ? input.source.type : 'nif',
      assetId: String(input.source?.assetId || '').slice(0,160), url: String(input.source?.url || '').slice(0,2000) },
    x: clamp(input.x,0,1,0.5), y: clamp(input.y,0,1,0.5),
    scale: clamp(input.scale,0.1,4,1), rotation: clamp(input.rotation,-360,360,0),
    visible: input.visible !== false, locked: Boolean(input.locked), z: clamp(input.z,current.subjects.length+1,99,current.subjects.length+1),
  };
  if ((subject.source.type === 'nif' && !subject.source.assetId) ||
      (['ply','url'].includes(subject.source.type) && !/^https?:\/\//i.test(subject.source.url))) {
    throw new Error('An additional subject needs a saved NIF asset ID or an HTTP(S) PLY/source URL.');
  }
  current.subjects.push(subject);
  state.selectedSubjectId = id;
  emit('subject-added');
  return clone(subject);
}

function updateSubject(id, patch = {}) {
  const subject = state.composition.subjects?.find(item => item.id === id);
  if (!subject) return false;
  if (!subject.locked || patch.locked !== undefined) {
    if (patch.label !== undefined) subject.label = String(patch.label).slice(0,100);
    if (patch.x !== undefined) subject.x = clamp(patch.x,0,1,subject.x);
    if (patch.y !== undefined) subject.y = clamp(patch.y,0,1,subject.y);
    if (patch.scale !== undefined) subject.scale = clamp(patch.scale,0.1,4,subject.scale);
    if (patch.rotation !== undefined) subject.rotation = clamp(patch.rotation,-360,360,subject.rotation);
    if (patch.visible !== undefined) subject.visible = Boolean(patch.visible);
    if (patch.locked !== undefined) subject.locked = Boolean(patch.locked);
    if (patch.z !== undefined) subject.z = clamp(patch.z,1,99,subject.z);
    if (id === 'subject_main') state.composition.object = { x: subject.x, y: subject.y, scale: subject.scale, rotation: subject.rotation };
  }
  emit('subject-updated');
  return true;
}

function removeSubject(id) {
  if (id === 'subject_main') return false;
  const subjects = state.composition.subjects || [];
  const next = subjects.filter(item => item.id !== id);
  if (next.length === subjects.length) return false;
  state.composition.subjects = next;
  if (state.selectedSubjectId === id) state.selectedSubjectId = 'subject_main';
  emit('subject-removed');
  return true;
}

function selectSubject(id) {
  if (!state.composition.subjects?.some(item => item.id === id)) return false;
  state.selectedSubjectId = id;
  emit('subject-selected');
  return true;
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
    subjects: clone(state.composition.subjects || []),
    title: clone(state.composition.title),
  };
}

function resetComposition() {
  const preset = normalizePreset(state.preset);
  const base = clone(POSTER_PRESETS[preset]);
  state.composition = {
    ...base,
    assets: { images: [] },
    subjects: [{
      id: 'subject_main',
      label: 'Main subject',
      source: { type: 'current' },
      ...clone(base.object),
      visible: true,
      locked: false,
      z: 1,
    }],
  };
  state.selectedSubjectId = 'subject_main';
  emit('reset');
  return snapshot();
}

window.FumocaPoster = Object.freeze({
  version: POSTER_VERSION,
  getState: snapshot,
  getPresets: () => Object.entries(POSTER_PRESETS).map(([name, preset]) => ({
    name, label: preset.label, aspectRatio: preset.aspectRatio,
  })),
  setPreset,
  updateComposition,
  addSubject,
  updateSubject,
  removeSubject,
  selectSubject,
  setEnabled,
  getLayout,
  reset: resetComposition,
});

window.dispatchEvent(new CustomEvent('fumoca:posterReady', { detail: { version: POSTER_VERSION } }));
console.info('[FUMOCA Poster] Composition model ready', POSTER_VERSION);
