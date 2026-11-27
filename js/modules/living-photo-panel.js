/**
 * Studio "Living photo" panel (Import tab): one photo → a shallow 3D splat
 * with gentle motion, built in the browser with no AI and no server.
 * Replaces the old single-photo panel, which tried an AI depth model first.
 */
import * as THREE from 'three';
import { photoToLivingSplat, MOTIONS, normalizeLivingState, DEFAULTS } from './living-photo.js';
import { LivingMotion, frameLivingPhoto } from './living-photo-motion.js';

const DETAIL = { low: 480, standard: 720, high: 1024 };

export function mountLivingPhotoPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.insertAdjacentHTML('beforeend', `
    <section class="section" id="livingPhotoSection">
      <div class="sec-head"><span class="sec-label">Living photo · one image</span><span class="sec-badge">NO AI</span></div>
      <div class="sec-body">
        <div class="hint">Turn a single photo into a moving moment: the subject lifts off the background and the view drifts gently, so it feels alive. It's an effect, not a scan — you can't walk around the back.</div>
        <input type="file" id="lpFile" accept="image/jpeg,image/png,image/webp" hidden>
        <button type="button" class="ac-btn full" id="lpChoose" style="margin-top:8px">Choose a photo</button>
        <canvas id="lpPreview" style="display:none;width:100%;margin-top:8px;border-radius:8px;background:#080a0e"></canvas>
        <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Depth</span><span class="ctrl-val" id="lpDepthVal">55%</span></div>
        <input type="range" id="lpDepth" min="0.15" max="1" step="0.05" value="${DEFAULTS.depthRange}" style="width:100%">
        <div class="ctrl-row"><span class="ctrl-label">Subject pop</span><span class="ctrl-val" id="lpPopVal">60%</span></div>
        <input type="range" id="lpPop" min="0" max="1" step="0.05" value="${DEFAULTS.subject}" style="width:100%">
        <div class="ctrl-row"><span class="ctrl-label">Detail</span></div>
        <select id="lpDetail" class="ac-select" style="width:100%"><option value="low">Light (fast)</option><option value="standard" selected>Standard</option><option value="high">High</option></select>
        <button type="button" class="ac-btn lime full" id="lpBuild" disabled style="margin-top:8px">Bring it to life</button>
        <div class="ctrl-row" style="margin-top:10px"><span class="ctrl-label">Motion</span></div>
        <select id="lpMotion" class="ac-select" style="width:100%">${Object.entries(MOTIONS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select>
        <div class="ctrl-row"><span class="ctrl-label">Amount</span><span class="ctrl-val" id="lpAmountVal">50%</span></div>
        <input type="range" id="lpAmount" min="0" max="1" step="0.05" value="0.5" style="width:100%">
        <div class="ctrl-row"><span class="ctrl-label">Speed</span><span class="ctrl-val" id="lpPeriodVal">8 s loop</span></div>
        <input type="range" id="lpPeriod" min="3" max="20" step="1" value="8" style="width:100%">
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn" id="lpPlay" disabled style="flex:1">▶ Preview motion</button>
          <button type="button" class="ac-btn" id="lpReframe" disabled style="flex:1">Reset view</button>
        </div>
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="lpViewer" checked> Play this motion in the published viewer</label>
        <div class="hint" id="lpStatus" role="status" style="margin-top:8px">Choose a photo to begin.</div>
      </div>
    </section>`);

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#lpStatus').textContent = m; onStatus?.(m); };
  let image = null, name = 'photo', view = null, motion = null, active = false, expectingLoad = false;

  const state = () => ({
    enabled: active && q('#lpViewer').checked,
    motion: q('#lpMotion').value,
    amount: +q('#lpAmount').value,
    period: +q('#lpPeriod').value,
    view,
  });
  const changed = () => window.dispatchEvent(new CustomEvent('fumoca:livingChange', { detail: state() }));

  function syncLabels() {
    q('#lpDepthVal').textContent = Math.round(+q('#lpDepth').value * 100) + '%';
    q('#lpPopVal').textContent = Math.round(+q('#lpPop').value * 100) + '%';
    q('#lpAmountVal').textContent = Math.round(+q('#lpAmount').value * 100) + '%';
    q('#lpPeriodVal').textContent = q('#lpPeriod').value + ' s loop';
  }
  container.addEventListener('input', (e) => {
    if (!e.target.id?.startsWith('lp')) return;
    syncLabels();
    if (motion && ['lpMotion', 'lpAmount', 'lpPeriod'].includes(e.target.id)) motion.setState(state().enabled ? state() : { ...state(), enabled: true });
  });
  ['lpMotion', 'lpAmount', 'lpPeriod', 'lpViewer'].forEach(id => q('#' + id).addEventListener('change', changed));

  q('#lpChoose').addEventListener('click', () => q('#lpFile').click());
  q('#lpFile').addEventListener('change', async () => {
    const file = q('#lpFile').files?.[0];
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { status('That photo is over 40 MB — please use a smaller copy.'); return; }
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      image = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
      name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'photo';
      const pv = q('#lpPreview');
      pv.width = c.width; pv.height = c.height; pv.getContext('2d').drawImage(c, 0, 0); pv.style.display = 'block';
      q('#lpBuild').disabled = false;
      status('Ready. Press "Bring it to life".');
    } catch (err) {
      status('Could not read that photo: ' + (err?.message || err));
    }
  });

  function showDepth(analysis, w, h) {
    const pv = q('#lpPreview');
    pv.width = w; pv.height = h;
    const ctx = pv.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const near = 1 - analysis.depth[i];
      img.data[i * 4] = 40 + 215 * near * 0.78; img.data[i * 4 + 1] = 40 + 215 * near; img.data[i * 4 + 2] = 60 + 120 * (1 - near); img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  q('#lpBuild').addEventListener('click', async () => {
    if (!image) return;
    q('#lpBuild').disabled = true;
    status('Finding the subject and building depth…');
    await new Promise(r => setTimeout(r, 30));
    try {
      const t0 = performance.now();
      const opts = { maxSide: DETAIL[q('#lpDetail').value] || 720, depthRange: +q('#lpDepth').value, subject: +q('#lpPop').value };
      const res = photoToLivingSplat(image.data, image.w, image.h, opts);
      showDepth(res.analysis, res.width, res.height);
      view = { near: 1, range: opts.depthRange, fovY: res.gaussians.camera.fov, aspect: res.gaussians.camera.aspect };
      motion?.dispose(); motion = null;
      expectingLoad = true;
      window.dispatchEvent(new CustomEvent('fumoca:openReconstructedSplat', {
        detail: { bytes: res.ply, filename: `${name}-living.ply`, kind: 'living-photo' },
      }));
      active = true;
      changed();
      status(`${res.gaussians.count.toLocaleString()} splats in ${Math.round(performance.now() - t0)} ms${res.analysis.hasSubject ? '' : ' — no clear subject found, so depth follows the scene layout'}. Loading…`);
      // Frame once Studio has loaded it, then start the motion preview.
      setTimeout(() => { reframe(); play(true); status('Alive. Adjust the motion, then publish as usual.'); }, 900);
      q('#lpPlay').disabled = false; q('#lpReframe').disabled = false;
    } catch (err) {
      status('Could not build it: ' + (err?.message || err));
    } finally {
      q('#lpBuild').disabled = false;
    }
  });

  const studioMesh = () => window.FumocaSparkGaussian?.getMesh?.() || window.S?.points || null;
  function reframe() {
    const cam = window.camera, controls = window.controls;
    if (!cam || !view) return;
    const playing = motion?.running;
    motion?.stop({ restore: false });
    frameLivingPhoto(THREE, cam, controls, studioMesh(), view);
    if (playing) play(true);
  }
  function play(on) {
    const cam = window.camera, controls = window.controls;
    if (!cam) return;
    if (!motion) motion = new LivingMotion(THREE, cam, controls, { ...state(), enabled: true });
    if (on ?? !motion.running) { motion.start(); q('#lpPlay').textContent = '❚❚ Stop motion'; }
    else { motion.stop(); q('#lpPlay').textContent = '▶ Preview motion'; }
  }
  q('#lpPlay').addEventListener('click', () => play());
  q('#lpReframe').addEventListener('click', reframe);

  // A different file loaded → this is no longer a living photo.
  window.addEventListener('fumoca:fileLoaded', () => {
    if (expectingLoad) { expectingLoad = false; return; }      // our own living photo
    motion?.dispose(); motion = null; active = false; view = null;
    q('#lpPlay').textContent = '▶ Preview motion'; q('#lpPlay').disabled = true; q('#lpReframe').disabled = true;
    changed();
  });

  // Restore a saved living photo when its NIF is reopened in Studio.
  window.addEventListener('fumoca:fileLoaded', () => {
    const saved = normalizeLivingState(window._fumocaCurrentRecord?.meta?.present?.living);
    if (!saved) return;
    active = true; view = saved.view || null;
    q('#lpMotion').value = saved.motion; q('#lpAmount').value = saved.amount; q('#lpPeriod').value = saved.period;
    q('#lpPlay').disabled = false; q('#lpReframe').disabled = !view;
    syncLabels();
    status('This is a living photo — press Preview motion to see it move.');
  });

  syncLabels();
  const api = { getState: () => (active ? normalizeLivingState(state()) : null), play, reframe };
  window.FumocaLivingPhoto = api;
  return api;
}
