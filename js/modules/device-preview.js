/**
 * FUMOCA Device Preview / Experience Simulator
 *
 * Two modes:
 *  1) Published — iframe of the public viewer (saved NIF / share URL)
 *  2) Studio live — letterbox the live Studio viewport to a device aspect and
 *     apply Look-tab view settings (zoom limits, locks, spin) so you can test
 *     behaviour on phone/tablet without a cloud save.
 *
 * Never writes Gaussian data or meta.present. Studio mode restores layout on close.
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
    #${ROOT_ID} .dp-info {
      flex: 0 0 auto; display: none; gap: 8px; align-items: center;
      padding: 8px 14px; background: rgba(0,229,255,.08);
      border-bottom: 1px solid rgba(0,229,255,.22); font-size: 12px; color: #9ae8ff;
    }
    #${ROOT_ID} .dp-info.is-on { display: flex; }
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
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px;
      padding: 24px; text-align: center; color: rgba(255,255,255,.55); font-size: 13px;
    }
    #${ROOT_ID} .dp-empty button {
      border: 1px solid rgba(212,255,0,.35); border-radius: 999px;
      padding: 10px 16px; background: rgba(212,255,0,.12); color: #d4ff00;
      font: 700 12px/1 Outfit, system-ui, sans-serif; cursor: pointer;
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
    #${ROOT_ID} .dp-studio-host {
      position: absolute; inset: 0; overflow: hidden; background: #000;
    }
  `;
  document.head.appendChild(style);
}

function recordId() {
  const q = new URLSearchParams(location.search);
  return (
    q.get('nifId') || q.get('splatId') || q.get('id') ||
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    window._fumocaCurrentRecord?.nif_id ||
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

function readLookViewSettings() {
  try {
    const v = window.FumocaLook?.getView?.();
    if (v) return v;
  } catch (_) {}
  return window._fumocaViewSettings || null;
}

class DevicePreviewController {
  constructor() {
    this.presetId = 'phone';
    this.landscape = false;
    this.mode = 'studio';
    this.root = null;
    this.frame = null;
    this.iframe = null;
    this.meta = null;
    this.warn = null;
    this.info = null;
    this.empty = null;
    this.studioHost = null;
    this.modeSelect = null;
    this.requestedMode = 'auto';
    this._localPreview = null;
    this._viewPreview = null;
    this._savedControls = null;
    this._onKey = (e) => { if (e.key === 'Escape') this.close(); };
    this._onResize = () => this.layout();
  }

  get preset() {
    return DEVICE_PRESETS.find((p) => p.id === this.presetId) || DEVICE_PRESETS[1];
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
        <select data-dp="mode" title="Preview source">
          <option value="auto">Auto</option>
          <option value="local">Local PLY</option>
          <option value="studio">Live Studio</option>
          <option value="published">Published</option>
        </select>
        <select data-dp="preset" title="Device">${DEVICE_PRESETS.map((p) =>
          `<option value="${p.id}">${p.label}</option>`).join('')}</select>
        <button type="button" data-dp="rotate" title="Rotate portrait / landscape">⟲ Rotate</button>
        <button type="button" data-dp="refresh" title="Reload preview">↻ Refresh</button>
        <button type="button" data-dp="open-tab" title="Open published URL in a new tab">Open tab</button>
        <span class="dp-meta" data-dp="meta">—</span>
        <button type="button" class="lime" data-dp="close">Close</button>
      </div>
      <div class="dp-warn" data-dp="warn">
        Studio has unsaved Look/Present changes. Published iframe still shows last saved state when available.
      </div>
      <div class="dp-info" data-dp="info">
        Live Studio preview — same scene and Look controls (zoom limits, locks, spin). Not a published URL.
      </div>
      <div class="dp-stage" data-dp="stage">
        <div class="dp-frame" data-dp="frame">
          <div class="dp-empty" data-dp="empty">
            <div>No published asset URL for this file.</div>
            <button type="button" data-dp="studio-mode">Preview this scene in the device frame</button>
            <div style="font-size:11px;opacity:.7;max-width:280px">
              Uses your current Look settings (closest/farthest zoom, lock zoom, lock rotation, spin).
              Save & Publish for a true published-viewer iframe.
            </div>
          </div>
          <iframe data-dp="iframe" title="Published experience preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads" style="display:none"></iframe>
          <div class="dp-studio-host" data-dp="studio-host" style="display:none"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.frame = root.querySelector('[data-dp="frame"]');
    this.iframe = root.querySelector('[data-dp="iframe"]');
    this.meta = root.querySelector('[data-dp="meta"]');
    this.warn = root.querySelector('[data-dp="warn"]');
    this.info = root.querySelector('[data-dp="info"]');
    this.empty = root.querySelector('[data-dp="empty"]');
    this.studioHost = root.querySelector('[data-dp="studio-host"]');
    this.modeSelect = root.querySelector('[data-dp="mode"]');
    this.modeSelect?.addEventListener('change', () => {
      this.requestedMode = this.modeSelect.value;
      this.load();
    });
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
      if (this.mode === 'studio') this.applyStudioViewSettings();
    });
    root.querySelector('[data-dp="refresh"]').addEventListener('click', () => this.load(true));
    root.querySelector('[data-dp="open-tab"]').addEventListener('click', () => {
      const url = buildPublishedViewerUrl();
      if (url) window.open(url, '_blank', 'noopener');
      else alert('Save & publish this asset first to get a public viewer link.');
    });
    root.querySelector('[data-dp="close"]').addEventListener('click', () => this.close());
    root.querySelector('[data-dp="studio-mode"]')?.addEventListener('click', () => {
      this.mode = 'studio';
      this.enterStudioFrame();
    });
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
      this.meta.textContent = `${size.width} × ${size.height} · ${fit.scalePct}% · ${this.landscape ? 'landscape' : 'portrait'}${this.mode === 'studio' ? ' · live' : ''}`;
    }
    if (this.mode === 'studio') this.resizeStudioRenderer(fit);
    return fit;
  }

  resizeStudioRenderer(fit) {
    const width = Math.max(2, fit?.width || this.frame?.clientWidth || 2);
    const height = Math.max(2, fit?.height || this.frame?.clientHeight || 2);
    try {
      const renderer = window._fumocaGlRenderer || window.renderer;
      renderer?.setSize?.(width, height, false);
      const cam = window.camera || window._fumocaCamera || window._fumocaViewerCamera;
      if (cam) {
        cam.aspect = width / height;
        cam.updateProjectionMatrix?.();
      }
      window.dispatchEvent(new CustomEvent('fumoca:presentationResize', {
        detail: { width, height, aspect: width / height, mode: 'device-preview' },
      }));
    } catch (_) {}
  }

  async applyStudioViewSettings() {
    const settings = readLookViewSettings();
    if (!settings) return;
    try {
      const THREE = window.THREE || (await import('three'));
      const camera = window.camera || window._fumocaCamera || window._fumocaViewerCamera;
      const controls = window.controls || window._fumocaOrbitControls || window._fumocaViewerControls;
      if (!camera || !controls) return;
      if (!this._savedControls) {
        this._savedControls = {
          min: controls.minDistance,
          max: controls.maxDistance,
          enableZoom: controls.enableZoom,
          enableRotate: controls.enableRotate,
          enablePan: controls.enablePan,
        };
      }
      const { ViewController } = await import('./view-settings.js');
      this._viewPreview?.dispose?.();
      this._viewPreview = new ViewController(THREE, camera, controls, settings, {
        domElement: window.renderer?.domElement || controls.domElement,
      });
      this._viewPreview.apply();
    } catch (e) {
      console.warn('[DevicePreview] view settings', e);
    }
  }

  exitLocalFrame() {
    try { this._localPreview?.dispose?.(); } catch (error) { console.warn('[DevicePreview] local preview cleanup', error); }
    this._localPreview = null;
    if (this.studioHost) {
      this.studioHost.style.display = 'none';
      this.studioHost.replaceChildren();
    }
  }

  async enterLocalFrame(source) {
    this.exitStudioFrame();
    this.exitLocalFrame();
    if (this.empty) this.empty.style.display = 'none';
    if (this.iframe) {
      this.iframe.style.display = 'none';
      this.iframe.removeAttribute('src');
    }
    if (this.info) {
      this.info.textContent = source.edited
        ? 'Local PLY preview — isolated Spark renderer using the current edited Gaussian data. Nothing is uploaded.'
        : 'Local PLY preview — isolated Spark renderer using the loaded local Gaussian file. Nothing is uploaded.';
      this.info.classList.add('is-on');
    }
    this.studioHost.style.display = 'block';
    this.studioHost.replaceChildren();
    this.mode = 'local';
    this.layout();
    const token = (this._localLoadToken || 0) + 1;
    this._localLoadToken = token;
    this.studioHost.textContent = 'Loading local Gaussian file…';
    try {
      const { mountLocalGaussianPreview } = await import('./device-preview-local.js');
      const preview = await mountLocalGaussianPreview(this.studioHost, source.bytes, source.fileName, readLookViewSettings());
      if (token !== this._localLoadToken || !this.root?.classList.contains('is-open') || this.mode !== 'local') {
        preview.dispose();
        return;
      }
      this._localPreview = preview;
    } catch (error) {
      if (token !== this._localLoadToken) return;
      console.error('[DevicePreview] local PLY preview failed', error);
      this.studioHost.innerHTML = '';
      const message = document.createElement('div');
      message.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:#ffbf9b;font-size:12px;';
      message.textContent = 'Local PLY preview could not start: ' + (error?.message || String(error));
      this.studioHost.appendChild(message);
    }
  }

  enterStudioFrame() {
    this.exitLocalFrame();
    if (this.empty) this.empty.style.display = 'none';
    if (this.iframe) {
      this.iframe.style.display = 'none';
      this.iframe.removeAttribute('src');
    }
    if (this.info) this.info.classList.add('is-on');
    const canvas =
      window._fumocaCaptureCanvas ||
      window._fumocaGlRenderer?.domElement ||
      window.renderer?.domElement ||
      document.querySelector('#viewport canvas') ||
      document.querySelector('#canvasHost canvas');
    if (this.studioHost && canvas) {
      if (!this._canvasHome) {
        this._canvasHome = { parent: canvas.parentElement, next: canvas.nextSibling };
      }
      this.studioHost.style.display = 'block';
      this.studioHost.appendChild(canvas);
      Object.assign(canvas.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        maxWidth: '100%', maxHeight: '100%',
      });
    } else if (this.studioHost) {
      this.studioHost.style.display = 'block';
      this.studioHost.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.5);font-size:12px;padding:16px;text-align:center">Live canvas not found — open a splat in Studio first.</div>';
    }
    this.mode = 'studio';
    this.layout();
    this.applyStudioViewSettings();
  }

  exitStudioFrame() {
    this._viewPreview?.dispose?.();
    this._viewPreview = null;
    if (this._savedControls) {
      const c = window.controls || window._fumocaOrbitControls || window._fumocaViewerControls;
      if (c) {
        Object.assign(c, {
          minDistance: this._savedControls.min,
          maxDistance: this._savedControls.max,
          enableZoom: this._savedControls.enableZoom,
          enableRotate: this._savedControls.enableRotate,
          enablePan: this._savedControls.enablePan,
        });
        c.update?.();
      }
      this._savedControls = null;
    }
    const canvas = this.studioHost?.querySelector('canvas');
    if (canvas && this._canvasHome?.parent) {
      const { parent, next } = this._canvasHome;
      if (next && next.parentElement === parent) parent.insertBefore(canvas, next);
      else parent.appendChild(canvas);
      Object.assign(canvas.style, {
        position: '', inset: '', left: '', top: '', width: '100%', height: '100%',
        maxWidth: '', maxHeight: '',
      });
      try {
        const host = document.getElementById('viewport') || document.getElementById('canvasHost') || parent;
        const w = Math.max(2, host.clientWidth || 2);
        const h = Math.max(2, host.clientHeight || 2);
        const renderer = window._fumocaGlRenderer || window.renderer;
        renderer?.setSize?.(w, h, false);
        const cam = window.camera || window._fumocaCamera;
        if (cam) { cam.aspect = w / h; cam.updateProjectionMatrix?.(); }
      } catch (_) {}
    }
    this._canvasHome = null;
    if (this.studioHost) {
      this.studioHost.style.display = 'none';
      this.studioHost.innerHTML = '';
    }
    if (this.info) this.info.classList.remove('is-on');
  }

  load(force = false) {
    const url = buildPublishedViewerUrl();
    let localSource = null;
    try {
      // Import lazily so the published-only viewer path does not load Spark twice.
      // The helper snapshots current edited Gaussian bytes when Studio's Spark bridge is active.
      localSource = window.S?.fileName ? null : null;
    } catch (_) {}
    if (this.warn) this.warn.classList.toggle('is-on', isStudioDirty());
    const chooseLocalSource = async () => {
      const mod = await import('./device-preview-local.js');
      return mod.getLocalGaussianPreviewBytes(window.S || {});
    };
    const selectMode = async () => {
      const source = await chooseLocalSource();
      const wanted = this.requestedMode || 'auto';
      const target = wanted === 'auto' ? (url ? 'published' : source ? 'local' : 'studio') : wanted;
      if (this.modeSelect) {
        const localOption = this.modeSelect.querySelector('option[value="local"]');
        const publishedOption = this.modeSelect.querySelector('option[value="published"]');
        if (localOption) localOption.disabled = !source;
        if (publishedOption) publishedOption.disabled = !url;
        this.modeSelect.value = target;
      }
      if (target === 'published') {
        if (!url) {
          this.exitLocalFrame();
          this.exitStudioFrame();
          this.mode = 'published';
          if (this.info) { this.info.textContent = 'No published viewer URL is available. Save and publish this asset first.'; this.info.classList.add('is-on'); }
          if (this.empty) this.empty.style.display = 'flex';
          if (this.iframe) this.iframe.style.display = 'none';
          this.layout();
          return null;
        }
        this.exitLocalFrame();
        this.mode = 'published';
        this.exitStudioFrame();
        if (this.empty) this.empty.style.display = 'none';
        if (this.info) this.info.classList.remove('is-on');
        if (this.iframe) {
          this.iframe.style.display = 'block';
          const finalUrl = force ? url + (url.includes('?') ? '&' : '?') + '_dp=' + Date.now() : url;
          if (force || this.iframe.getAttribute('src') !== url) this.iframe.setAttribute('src', finalUrl);
        }
        this.layout();
        return url;
      }
      if (target === 'local') {
        if (!source) {
          this.exitLocalFrame();
          this.exitStudioFrame();
          this.mode = 'local';
          if (this.info) { this.info.textContent = 'No local Gaussian PLY is loaded. Open a Gaussian .ply file in Studio first.'; this.info.classList.add('is-on'); }
          if (this.empty) this.empty.style.display = 'flex';
          this.layout();
          return null;
        }
        return this.enterLocalFrame(source);
      }
      this.mode = 'studio';
      if (this.iframe) { this.iframe.style.display = 'none'; this.iframe.removeAttribute('src'); }
      if (this.info) this.info.classList.remove('is-on');
      this.enterStudioFrame();
      return null;
    };
    return selectMode().catch((error) => {
      console.error('[DevicePreview] mode selection failed', error);
      this.mode = 'studio';
      this.enterStudioFrame();
      return null;
    });
  }

  /* legacy-load-removed */
  _legacyLoadRemoved(force = false) {
    const url = buildPublishedViewerUrl();
    if (this.warn) this.warn.classList.toggle('is-on', isStudioDirty());

    if (url) {
      this.mode = 'published';
      this.exitStudioFrame();
      if (this.empty) this.empty.style.display = 'none';
      if (this.info) this.info.classList.remove('is-on');
      if (this.iframe) {
        this.iframe.style.display = 'block';
        const finalUrl = force ? url + (url.includes('?') ? '&' : '?') + '_dp=' + Date.now() : url;
        if (force || this.iframe.getAttribute('src') !== url) {
          this.iframe.setAttribute('src', finalUrl);
        }
      }
      this.layout();
      return url;
    }

    this.mode = 'studio';
    if (this.iframe) {
      this.iframe.style.display = 'none';
      this.iframe.removeAttribute('src');
    }
    this.enterStudioFrame();
    return null;
  }

  open(options = {}) {
    this.ensureDom();
    if (options.presetId) this.presetId = options.presetId;
    if (options.mode) this.requestedMode = options.mode;
    if (typeof options.landscape === 'boolean') this.landscape = options.landscape;
    const sel = this.root.querySelector('[data-dp="preset"]');
    if (sel) sel.value = this.presetId;
    if (this.modeSelect) this.modeSelect.value = this.requestedMode;
    this.root.classList.add('is-open');
    document.body.classList.add('fumoca-device-preview-open');
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    this.layout();
    this.load(!!options.refresh);
    window.dispatchEvent(new CustomEvent('fumoca:devicePreview', { detail: { open: true, preset: this.presetId, mode: this.mode } }));
  }

  close() {
    if (!this.root) return;
    this._localLoadToken = (this._localLoadToken || 0) + 1;
    this.exitLocalFrame();
    this.exitStudioFrame();
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
  btn.title = 'Preview on phone, tablet and desktop — uses Look zoom limits & locks';
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

const isStudio =
  /\/edit(?:\.html)?\/?$/i.test(location.pathname) ||
  document.body?.dataset?.fumocaStudio === '1' ||
  /\/edit(?:\.html)?/i.test(location.pathname);
if (typeof window !== 'undefined' && isStudio) {
  const boot = () => { try { mountDevicePreviewFab(); } catch (e) { console.warn('[DevicePreview]', e); } };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  setTimeout(boot, 1200);
  setTimeout(boot, 3000);
}
