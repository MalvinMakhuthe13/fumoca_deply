/**
 * FUMOCA Device Preview / Experience Simulator
 *
 * Previews the *published* experience inside fixed device frames.
 * Does NOT resize or mutate the Studio Gaussian scene, camera, or meta.present.
 *
 * Uses an isolated iframe pointed at the public viewer URL for the current asset.
 */

export const DEVICE_PRESETS = Object.freeze([
  { id: 'small-phone', label: 'Small Phone', width: 360, height: 640 },
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
]);

const CSS_ID = 'fumoca-device-preview-styles';
const ROOT_ID = 'fumocaDevicePreviewRoot';

function ensureStyles() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: fixed; inset: 0; z-index: 2147482500;
      display: none; flex-direction: column;
      background: rgba(4, 5, 10, 0.92);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      color: #f0f0f0; font-family: Outfit, system-ui, sans-serif;
    }
    #${ROOT_ID}.is-open { display: flex; }
    #${ROOT_ID} .dp-bar {
      flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.35);
    }
    #${ROOT_ID} .dp-title { font-weight: 800; font-size: 13px; letter-spacing: .02em; margin-right: 6px; }
    #${ROOT_ID} .dp-bar select, #${ROOT_ID} .dp-bar button {
      border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
      background: rgba(255,255,255,.06); color: inherit;
      padding: 7px 10px; font: 600 12px/1 Outfit, system-ui, sans-serif; cursor: pointer;
    }
    #${ROOT_ID} .dp-bar button.lime { background: #d4ff00; color: #10131a; border-color: transparent; }
    #${ROOT_ID} .dp-meta {
      font: 500 11px/1.3 "JetBrains Mono", ui-monospace, monospace;
      color: rgba(255,255,255,.65); margin-left: auto;
    }
    #${ROOT_ID} .dp-warn {
      flex: 0 0 auto; display: none; gap: 8px; align-items: center;
      padding: 8px 14px; background: rgba(255,179,0,.12);
      border-bottom: 1px solid rgba(255,179,0,.28); font-size: 12px; color: #ffd27a;
    }
    #${ROOT_ID} .dp-warn.is-on { display: flex; }
    #${ROOT_ID} .dp-stage {
      flex: 1 1 auto; min-height: 0; position: relative;
      display: flex; align-items: center; justify-content: center;
      padding: 18px; overflow: hidden;
    }
    #${ROOT_ID} .dp-frame {
      position: relative; background: #0a0c12;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04);
      overflow: hidden;
    }
    #${ROOT_ID} .dp-frame iframe {
      position: absolute; inset: 0; width: 100%; height: 100%;
      border: 0; background: #000; display: block;
    }
    #${ROOT_ID} .dp-empty {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 24px; text-align: center; color: rgba(255,255,255,.55); font-size: 13px;
    }
    #fumocaDevicePreviewFab {
      position: fixed; right: 18px; bottom: 64px; z-index: 2147482000;
      border: 1px solid rgba(255,255,255,.18); border-radius: 999px;
      padding: 10px 14px; background: rgba(5,7,11,.82); color: #fff;
      font: 700 12px/1 Outfit, system-ui, sans-serif; cursor: pointer;
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 8px 28px rgba(0,0,0,.45);
    }
    #fumocaDevicePreviewFab:hover { border-color: rgba(212,255,0,.4); color: #d4ff00; }
    body.fumoca-device-preview-open #fumocaDevicePreviewFab { display: none; }
  `;
  document.head.appendChild(style);
}

function recordId() {
  const q = new URLSearchParams(location.search);
  return (
    q.get('nifId') || q.get('splatId') || q.get('id') ||
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    ''
  );
}

export function buildPublishedViewerUrl() {
  const id = recordId();
  const share = window._fumocaShareUrl;
  if (share && typeof share === 'string') {
    try {
      const u = new URL(share, location.origin);
      u.searchParams.set('public', '1');
      u.searchParams.delete('embed');
      return u.toString();
    } catch (_) {}
  }
  if (!id || id === 'default') return null;
  const u = new URL('/viewer.html', location.origin);
  u.pathname = '/viewer.html';
  u.searchParams.set('public', '1');
  u.searchParams.set('nifId', id);
  u.searchParams.set('splatId', id);
  return u.toString();
}

export function isStudioDirty() {
  if (window.__FUMOCA_DEVICE_PREVIEW_FORCE_CLEAN__) return false;
  if (typeof window.__FUMOCA_STUDIO_DIRTY__ === 'boolean') return window.__FUMOCA_STUDIO_DIRTY__;
  return !!window.__FUMOCA_LOOK_DIRTY__ || !!window.__FUMOCA_PRESENT_DIRTY__;
}

function markDirtyFromEvents() {
  const mark = () => { window.__FUMOCA_LOOK_DIRTY__ = true; window.__FUMOCA_STUDIO_DIRTY__ = true; };
  const clear = () => {
    window.__FUMOCA_LOOK_DIRTY__ = false;
    window.__FUMOCA_PRESENT_DIRTY__ = false;
    window.__FUMOCA_STUDIO_DIRTY__ = false;
  };
  window.addEventListener('fumoca:lookChange', mark);
  window.addEventListener('fumoca:platformChange', mark);
  window.addEventListener('fumoca:tutorialChange', mark);
  window.addEventListener('fumoca:tourChange', mark);
  window.addEventListener('fumoca:fileLoaded', clear);
  window.addEventListener('fumoca:published', clear);
}

export function computeFrameLayout(deviceW, deviceH, stageW, stageH, padding = 24) {
  const availW = Math.max(40, stageW - padding * 2);
  const availH = Math.max(40, stageH - padding * 2);
  const scale = Math.min(1, availW / deviceW, availH / deviceH);
  const width = Math.round(deviceW * scale);
  const height = Math.round(deviceH * scale);
  return { scale, scalePct: Math.round(scale * 100), width, height, deviceW, deviceH };
}

export function resolveDeviceSize(preset, landscape) {
  const w = preset.width;
  const h = preset.height;
  if (landscape && w < h) return { width: h, height: w };
  if (!landscape && w > h) return { width: h, height: w };
  return { width: w, height: h };
}

class DevicePreviewController {
  constructor() {
    this.presetId = 'tablet';
    this.landscape = false;
    this.root = null;
    this.frame = null;
    this.iframe = null;
    this.meta = null;
    this.warn = null;
    this.empty = null;
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this._onResize = () => this.layout();
  }

  get preset() {
    return DEVICE_PRESETS.find((p) => p.id === this.presetId) || DEVICE_PRESETS[2];
  }

  ensureDom() {
    ensureStyles();
    if (this.root) return;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Device Preview / Experience Simulator');
    root.innerHTML = `
      <div class="dp-bar">
        <span class="dp-title">Device Preview</span>
        <select data-dp="preset" title="Device">${DEVICE_PRESETS.map((p) =>
          `<option value="${p.id}">${p.label}</option>`).join('')}</select>
        <button type="button" data-dp="rotate" title="Rotate portrait / landscape">⟲ Rotate</button>
        <button type="button" data-dp="refresh" title="Reload published viewer">↻ Refresh</button>
        <button type="button" data-dp="open-tab" title="Open published URL in a new tab">Open tab</button>
        <span class="dp-meta" data-dp="meta">—</span>
        <button type="button" class="lime" data-dp="close">Close</button>
      </div>
      <div class="dp-warn" data-dp="warn">
        Studio has unsaved changes. This preview loads the last published / saved viewer state — not your dirty Studio edits.
      </div>
      <div class="dp-stage" data-dp="stage">
        <div class="dp-frame" data-dp="frame">
          <div class="dp-empty" data-dp="empty">Open a saved NIF / splat asset to preview the published experience on a device.</div>
          <iframe data-dp="iframe" title="Published experience preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" style="display:none"></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.frame = root.querySelector('[data-dp="frame"]');
    this.iframe = root.querySelector('[data-dp="iframe"]');
    this.meta = root.querySelector('[data-dp="meta"]');
    this.warn = root.querySelector('[data-dp="warn"]');
    this.empty = root.querySelector('[data-dp="empty"]');
    this.stage = root.querySelector('[data-dp="stage"]');
    const presetSel = root.querySelector('[data-dp="preset"]');
    presetSel.value = this.presetId;
    presetSel.addEventListener('change', () => {
      this.presetId = presetSel.value;
      this.layout();
      this.load();
    });
    root.querySelector('[data-dp="rotate"]').addEventListener('click', () => {
      this.landscape = !this.landscape;
      this.layout();
    });
    root.querySelector('[data-dp="refresh"]').addEventListener('click', () => this.load(true));
    root.querySelector('[data-dp="open-tab"]').addEventListener('click', () => {
      const url = buildPublishedViewerUrl();
      if (url) window.open(url, '_blank', 'noopener');
    });
    root.querySelector('[data-dp="close"]').addEventListener('click', () => this.close());
  }

  layout() {
    if (!this.root || !this.stage || !this.frame) return;
    const size = resolveDeviceSize(this.preset, this.landscape);
    const rect = this.stage.getBoundingClientRect();
    const fit = computeFrameLayout(size.width, size.height, rect.width, rect.height, 20);
    this.frame.style.width = fit.width + 'px';
    this.frame.style.height = fit.height + 'px';
    if (this.iframe) {
      this.iframe.style.width = '100%';
      this.iframe.style.height = '100%';
    }
    if (this.meta) {
      this.meta.textContent = `${size.width} × ${size.height} · ${fit.scalePct}% · ${this.landscape ? 'landscape' : 'portrait'}`;
    }
    return fit;
  }

  load(force = false) {
    const url = buildPublishedViewerUrl();
    if (this.warn) this.warn.classList.toggle('is-on', isStudioDirty());
    if (!url) {
      if (this.empty) this.empty.style.display = 'flex';
      if (this.iframe) {
        this.iframe.style.display = 'none';
        this.iframe.removeAttribute('src');
      }
      return null;
    }
    if (this.empty) this.empty.style.display = 'none';
    if (this.iframe) {
      this.iframe.style.display = 'block';
      const finalUrl = force ? url + (url.includes('?') ? '&' : '?') + '_dp=' + Date.now() : url;
      if (force || this.iframe.getAttribute('src') !== url) {
        this.iframe.setAttribute('src', finalUrl);
      }
    }
    return url;
  }

  open(options = {}) {
    this.ensureDom();
    if (options.presetId) this.presetId = options.presetId;
    if (typeof options.landscape === 'boolean') this.landscape = options.landscape;
    const sel = this.root.querySelector('[data-dp="preset"]');
    if (sel) sel.value = this.presetId;
    this.root.classList.add('is-open');
    document.body.classList.add('fumoca-device-preview-open');
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    this.layout();
    this.load(!!options.refresh);
    window.dispatchEvent(new CustomEvent('fumoca:devicePreview', { detail: { open: true, preset: this.presetId } }));
  }

  close() {
    if (!this.root) return;
    this.root.classList.remove('is-open');
    document.body.classList.remove('fumoca-device-preview-open');
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    if (this.iframe) {
      this.iframe.removeAttribute('src');
      this.iframe.style.display = 'none';
    }
    window.dispatchEvent(new CustomEvent('fumoca:devicePreview', { detail: { open: false } }));
  }

  toggle() {
    if (this.root?.classList.contains('is-open')) this.close();
    else this.open();
  }
}

let controller = null;

export function getDevicePreview() {
  if (!controller) controller = new DevicePreviewController();
  return controller;
}

export function openDevicePreview(options) {
  return getDevicePreview().open(options);
}

export function closeDevicePreview() {
  return getDevicePreview().close();
}

export function mountDevicePreviewFab() {
  ensureStyles();
  markDirtyFromEvents();
  if (document.getElementById('fumocaDevicePreviewFab')) return getDevicePreview();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'fumocaDevicePreviewFab';
  btn.title = 'Preview the published experience on phone, tablet and desktop frames';
  btn.textContent = '📱 Devices';
  btn.addEventListener('click', () => getDevicePreview().toggle());
  document.body.appendChild(btn);
  window.FumocaDevicePreview = {
    open: openDevicePreview,
    close: closeDevicePreview,
    toggle: () => getDevicePreview().toggle(),
    presets: DEVICE_PRESETS,
    buildPublishedViewerUrl,
    isStudioDirty,
    computeFrameLayout,
    resolveDeviceSize,
  };
  return getDevicePreview();
}

// Auto-mount on Studio edit routes
const isStudio =
  /\/edit(?:\.html)?\/?$/i.test(location.pathname) ||
  document.body?.dataset?.fumocaStudio === '1' ||
  /\/edit(?:\.html)?/i.test(location.pathname);
if (typeof window !== 'undefined' && isStudio) {
  const boot = () => {
    try { mountDevicePreviewFab(); } catch (e) { console.warn('[DevicePreview]', e); }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  // Retry after late Studio shell mount
  setTimeout(boot, 1200);
  setTimeout(boot, 3000);
}
