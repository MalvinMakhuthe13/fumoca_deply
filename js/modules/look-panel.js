/**
 * Studio "Look" tab:
 *   • Lighting & shadow — relight the splats with a movable light and a soft
 *     shadow that follows them (and a rig's motion)
 *   • How it's viewed — start view, zoom limits, locks, steady mode and spin
 *     speed for the published page and embeds
 * Both are saved with the NIF and applied in the public viewer.
 */
import * as THREE from 'three';
import { SplatLighting, normalizeLighting, DEFAULT_LIGHTING } from './splat-lighting.js';
import { ViewController, normalizeViewSettings, captureView, DEFAULT_VIEW } from './view-settings.js';

const row = (id, label, min, max, step, value, fmt = (v) => v) =>
  `<div class="ctrl-row"><span class="ctrl-label">${label}</span><span class="ctrl-val" id="${id}Val">${fmt(value)}</span></div>
   <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%">`;
const check = (id, label, on = false) => `<label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${label}</label>`;

export function mountLookPanel(container, { onStatus } = {}) {
  if (!container) return null;
  const L = DEFAULT_LIGHTING, V = DEFAULT_VIEW;
  container.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">Lighting &amp; shadow</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Light the splat from any side and drop a soft shadow under it. The shadow follows the splat, the platform and any rig animation. Turn it off to get the scan's own colours back exactly.</div>
        ${check('lkOn', 'Use lighting')}
        ${row('lkAz', 'Direction', -180, 180, 1, L.azimuth, v => Math.round(v) + '°')}
        ${row('lkEl', 'Height', 2, 90, 1, L.elevation, v => Math.round(v) + '°')}
        ${row('lkInt', 'Light strength', 0, 2, 0.05, L.intensity, v => Math.round(v * 100) + '%')}
        ${row('lkAmb', 'Fill (ambient)', 0, 1.5, 0.05, L.ambient, v => Math.round(v * 100) + '%')}
        <div class="ctrl-row"><span class="ctrl-label">Light colour</span><input type="color" id="lkCol" value="${L.color}" style="width:48px;height:22px;border:0;background:none"></div>
        ${check('lkSh', 'Shadow', true)}
        ${row('lkShOp', 'Shadow darkness', 0, 1, 0.05, L.shadowOpacity, v => Math.round(v * 100) + '%')}
        ${row('lkShSoft', 'Shadow softness', 0, 1, 0.05, L.shadowSoftness, v => Math.round(v * 100) + '%')}
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">How it's viewed · website &amp; embed</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Set exactly how people first see it, how far they can zoom, and whether it spins. Great for a steady view on a website.</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn lime" id="vwCapture" style="flex:1">Use this view as the start</button>
          <button type="button" class="ac-btn" id="vwClear" style="flex:1">Auto-frame</button>
        </div>
        <div class="hint" id="vwStart" style="margin-top:4px">Start view: auto-framed</div>
        ${row('vwMin', 'Closest zoom', 0.05, 1, 0.05, V.zoomMin, v => Math.round(v * 100) + '% of start')}
        ${row('vwMax', 'Farthest zoom', 1, 10, 0.25, V.zoomMax, v => (+v).toFixed(2) + '× start')}
        ${check('vwLockZoom', 'Lock zoom')}
        ${check('vwLockRot', 'Lock rotation')}
        ${check('vwPan', 'Allow panning')}
        ${check('vwFixed', 'Steady view — nothing moves except the spin')}
        ${row('vwSpin', 'Spin speed', -60, 60, 1, V.spin, v => (+v === 0 ? 'off' : Math.round(v) + '°/s'))}
        <div style="display:flex;gap:6px;margin-top:8px">
          <button type="button" class="ac-btn" id="vwPreview" style="flex:1">▶ Preview here</button>
        </div>
        <div class="hint" style="margin-top:8px">Embed overrides: add <code>?spin=12&amp;lock=1&amp;zoomMin=0.6&amp;zoomMax=2.5&amp;fixed=1</code> to the viewer link.</div>
      </div>
    </div>
    <div class="hint" id="lkStatus" role="status" style="margin:8px 10px"></div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#lkStatus').textContent = m; onStatus?.(m); };
  let lighting = null, lightingMesh = null, startView = null, preview = null;

  const sparkMesh = () => (window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null);
  const lightState = () => normalizeLighting({
    enabled: q('#lkOn').checked, azimuth: +q('#lkAz').value, elevation: +q('#lkEl').value,
    intensity: +q('#lkInt').value, ambient: +q('#lkAmb').value, color: q('#lkCol').value,
    shadow: q('#lkSh').checked, shadowOpacity: +q('#lkShOp').value, shadowSoftness: +q('#lkShSoft').value,
  });
  const viewState = () => normalizeViewSettings({
    startView, zoomMin: +q('#vwMin').value, zoomMax: +q('#vwMax').value,
    lockZoom: q('#vwLockZoom').checked, lockRotate: q('#vwLockRot').checked, allowPan: q('#vwPan').checked,
    fixed: q('#vwFixed').checked, spin: +q('#vwSpin').value,
  });

  // ── lighting ──
  function ensureLighting() {
    const mesh = sparkMesh();
    if (!mesh) return null;
    if (lighting && lightingMesh === mesh) return lighting;
    lighting?.dispose?.();
    try { lighting = new SplatLighting(THREE, mesh); lightingMesh = mesh; }
    catch (e) { lighting = null; status(e.message); }
    return lighting;
  }
  let lightTimer = 0;
  function applyLighting() {
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => {
      const s = lightState();
      if (!s.enabled && !lighting) return;
      const l = ensureLighting();
      if (!l) { status('Turn on Photoreal (Spark) to light the splat.'); return; }
      const t0 = performance.now();
      try { l.apply(s); status(s.enabled ? `Lit in ${Math.round(performance.now() - t0)} ms.` : 'Lighting off — original colours.'); }
      catch (e) { status(e.message); }
    }, 60);
  }
  ['lkOn', 'lkAz', 'lkEl', 'lkInt', 'lkAmb', 'lkCol', 'lkSh', 'lkShOp', 'lkShSoft'].forEach(id => {
    q('#' + id).addEventListener('input', () => { syncLabels(); applyLighting(); });
    q('#' + id).addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange')));
  });

  // Edits written in place use the scan's colours; light them again.
  window.addEventListener('fumoca:sparkInPlaceUpdate', () => { if (lightState().enabled) applyLighting(); });
  // Keep the shadow under a playing rig.
  setInterval(() => {
    const d = window.FumocaRig?.driver;
    if (lighting && lightState().enabled && lightState().shadow && d?.playing) { try { lighting.updateShadow(); } catch (_) {} }
    const mesh = sparkMesh();
    if (lighting && mesh && mesh !== lightingMesh && lightState().enabled) { lighting = null; applyLighting(); }
  }, 160);

  // ── view ──
  function syncLabels() {
    const fmt = {
      lkAz: v => Math.round(v) + '°', lkEl: v => Math.round(v) + '°', lkInt: v => Math.round(v * 100) + '%', lkAmb: v => Math.round(v * 100) + '%',
      lkShOp: v => Math.round(v * 100) + '%', lkShSoft: v => Math.round(v * 100) + '%',
      vwMin: v => Math.round(v * 100) + '% of start', vwMax: v => (+v).toFixed(2) + '× start', vwSpin: v => (+v === 0 ? 'off' : Math.round(v) + '°/s'),
    };
    for (const [id, f] of Object.entries(fmt)) { const el = q('#' + id + 'Val'); if (el) el.textContent = f(+q('#' + id).value); }
    q('#vwStart').textContent = startView ? 'Start view: saved from Studio' : 'Start view: auto-framed';
  }
  ['vwMin', 'vwMax', 'vwLockZoom', 'vwLockRot', 'vwPan', 'vwFixed', 'vwSpin'].forEach(id => {
    q('#' + id).addEventListener('input', () => { syncLabels(); if (preview) preview.update(viewState()); });
    q('#' + id).addEventListener('change', () => window.dispatchEvent(new CustomEvent('fumoca:lookChange')));
  });
  q('#vwCapture').addEventListener('click', () => {
    if (!window.camera) return;
    startView = captureView(window.camera, window.controls);
    syncLabels(); window.dispatchEvent(new CustomEvent('fumoca:lookChange'));
    status('Start view saved — the published page opens exactly here.');
  });
  q('#vwClear').addEventListener('click', () => { startView = null; syncLabels(); window.dispatchEvent(new CustomEvent('fumoca:lookChange')); status('Start view: auto-framed.'); });

  let saved = null;
  q('#vwPreview').addEventListener('click', () => {
    if (preview) {
      preview.dispose(); preview = null;
      if (saved && window.controls) {
        const c = window.controls;
        Object.assign(c, saved.flags);
        c.minDistance = saved.min; c.maxDistance = saved.max;
      }
      q('#vwPreview').textContent = '▶ Preview here';
      status('Preview stopped — Studio controls are back.');
      return;
    }
    const c = window.controls;
    if (!window.camera || !c) return;
    saved = { min: c.minDistance, max: c.maxDistance, flags: { enableZoom: c.enableZoom, enableRotate: c.enableRotate, enablePan: c.enablePan } };
    preview = new ViewController(THREE, window.camera, c, viewState(), { domElement: window.renderer?.domElement || c.domElement });
    preview.apply();
    globalThis._fumocaViewSettings = null;            // Studio itself never locks framing
    q('#vwPreview').textContent = '■ Stop preview';
    status('Previewing how visitors will see it.');
  });

  // ── persistence ──
  window.addEventListener('fumoca:fileLoaded', () => {
    lighting?.dispose?.(); lighting = null; lightingMesh = null;
    const present = window._fumocaCurrentRecord?.meta?.present || {};
    const ls = normalizeLighting(present.lighting), vs = normalizeViewSettings(present.view);
    if (ls) {
      q('#lkOn').checked = ls.enabled; q('#lkAz').value = ls.azimuth; q('#lkEl').value = ls.elevation; q('#lkInt').value = ls.intensity;
      q('#lkAmb').value = ls.ambient; q('#lkCol').value = ls.color; q('#lkSh').checked = ls.shadow; q('#lkShOp').value = ls.shadowOpacity; q('#lkShSoft').value = ls.shadowSoftness;
      if (ls.enabled) setTimeout(applyLighting, 2500);
    } else q('#lkOn').checked = false;
    if (vs) {
      startView = vs.startView; q('#vwMin').value = vs.zoomMin; q('#vwMax').value = vs.zoomMax; q('#vwLockZoom').checked = vs.lockZoom;
      q('#vwLockRot').checked = vs.lockRotate; q('#vwPan').checked = vs.allowPan; q('#vwFixed').checked = vs.fixed; q('#vwSpin').value = vs.spin;
    } else startView = null;
    syncLabels();
  });

  syncLabels();
  const api = {
    getLighting: () => { const s = lightState(); return s.enabled ? s : null; },
    getView: () => viewState(),
    get lighting() { return lighting; },
  };
  window.FumocaLook = api;
  return api;
}
