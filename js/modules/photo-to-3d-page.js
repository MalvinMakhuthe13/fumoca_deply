/**
 * FUMOCA Photo → 3D page controller.
 * photo → AI depth (on device) → 3D poster (WebGL parallax) and/or 3D splat
 * (Gaussian PLY, previewed with Spark) → video / .ply / Open in Studio.
 */
import { loadPhoto, estimateDepth } from './photo-depth.js';
import { normalizeDepth, depthToGaussians, encodeGaussianPly } from './depth-to-splat.js';
import { createParallaxPoster } from './depth-parallax.js';
import { putHandoff } from './handoff-store.js';

const $ = (id) => document.getElementById(id);
const els = {
  drop: $('p3Drop'), file: $('p3File'), progress: $('p3Progress'), status: $('p3Status'), bar: $('p3Bar'),
  tabs: $('p3Tabs'), poster: $('p3Poster'), splat: $('p3Splat'),
  posterPanel: $('p3PosterPanel'), splatPanel: $('p3SplatPanel'),
  strength: $('p3Strength'), focus: $('p3Focus'), depth: $('p3Depth'), background: $('p3Background'),
  openStudio: $('p3OpenStudio'), downloadPly: $('p3DownloadPly'), splatInfo: $('p3SplatInfo'),
};

let photo = null;          // { canvas, width, height, rgba }
let depthNorm = null;      // Float32Array 1 = near, at depth size
let depthSize = null;      // [w, h]
let poster = null;
let splatView = null;
let plyBytes = null;
let detail = 450000;
let tab = 'poster';
let fileName = 'photo';
let busy = false;

function progress(fraction, message) {
  els.progress.style.display = 'block';
  if (message) els.status.textContent = message;
  els.bar.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
}
function done(message) {
  if (message) { els.status.textContent = message; els.bar.style.width = '100%'; setTimeout(() => { els.progress.style.display = 'none'; }, 1800); }
  else els.progress.style.display = 'none';
}
function fail(error) {
  console.error('[Photo→3D]', error);
  els.progress.style.display = 'block';
  els.bar.style.width = '0';
  els.status.textContent = 'Something went wrong: ' + (error?.message || error) + '. Try another photo or reload the page.';
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function outputs() {
  $('p3StrengthOut').textContent = Math.round(Number(els.strength.value) / 0.08 * 100) + '%';
  $('p3FocusOut').textContent = Number(els.focus.value) < 0.34 ? 'background' : Number(els.focus.value) > 0.66 ? 'foreground' : 'middle';
  $('p3DepthOut').textContent = Number(els.depth.value).toFixed(1) + '×';
  $('p3BackgroundOut').textContent = Number(els.background.value) === 0 ? 'off' : Math.round(Number(els.background.value) * 100) + '%';
}

function showTab(next) {
  tab = next;
  for (const b of els.tabs.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  els.poster.hidden = tab !== 'poster';
  els.splat.hidden = tab !== 'splat';
  els.posterPanel.hidden = tab !== 'poster';
  els.splatPanel.hidden = tab !== 'splat';
  if (tab === 'splat' && !plyBytes && depthNorm) buildSplat().catch(fail);
}

async function handleFile(file) {
  if (!file || busy) return;
  if (!/^image\//.test(file.type)) { fail(new Error('Please choose an image file')); return; }
  busy = true;
  fileName = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 60) || 'photo';
  try {
    reset();
    progress(0.02, 'Reading photo…');
    photo = await loadPhoto(file);
    progress(0.05, 'Loading depth model…');
    const est = await estimateDepth(photo.canvas, { onProgress: (f, m) => progress(0.05 + f * 0.8, m) });
    depthNorm = normalizeDepth(est.raw);
    depthSize = [est.width, est.height];
    progress(0.9, 'Building 3D poster…');
    els.drop.hidden = true;
    els.tabs.hidden = false;
    poster = createParallaxPoster(els.poster, {
      image: photo.canvas, depth: depthNorm, depthWidth: est.width, depthHeight: est.height,
    }, { strength: Number(els.strength.value), focus: Number(els.focus.value) });
    showTab(tab);
    done(`Depth ready (${est.device === 'webgpu' ? 'GPU' : 'CPU'}). Move your mouse over the poster or switch to 3D Splat.`);
  } catch (error) {
    reset();
    fail(error);
  } finally { busy = false; }
}

function reset() {
  poster?.destroy(); poster = null;
  splatView?.dispose(); splatView = null;
  plyBytes = null; depthNorm = null; photo = null; tab = 'poster';
  els.openStudio.disabled = true; els.downloadPly.disabled = true;
  els.splatInfo.textContent = '';
  els.drop.hidden = false; els.tabs.hidden = true;
  els.poster.hidden = true; els.splat.hidden = true;
  els.posterPanel.hidden = true; els.splatPanel.hidden = true;
}

async function buildSplat() {
  if (!photo || !depthNorm || busy) return;
  busy = true;
  els.openStudio.disabled = true; els.downloadPly.disabled = true;
  try {
    progress(0.2, 'Building 3D splat…');
    await new Promise(r => setTimeout(r, 30));
    const range = Number(els.depth.value);
    const g = depthToGaussians({
      rgba: photo.rgba, width: photo.width, height: photo.height,
      depth: depthNorm, depthWidth: depthSize[0], depthHeight: depthSize[1],
    }, { near: 1, far: range, maxSplats: detail, removeBackground: Number(els.background.value) });
    if (!g.count) throw new Error('Nothing left to build — lower "Remove background"');
    plyBytes = encodeGaussianPly(g);
    // The PLY is the deliverable. Make download and Studio hand-off available
    // before trying the optional Spark preview so a WebGL/CDN failure cannot
    // destroy an otherwise successful on-device reconstruction.
    els.openStudio.disabled = false; els.downloadPly.disabled = false;
    els.splatInfo.textContent = `${g.count.toLocaleString()} Gaussians · ${(plyBytes.byteLength / 1048576).toFixed(1)} MB`;
    progress(0.7, 'Loading optional Spark preview…');
    try {
      splatView = splatView || await createSplatPreview(els.splat);
      await splatView.show(plyBytes);
      done('3D splat ready — drag to orbit.');
    } catch (previewError) {
      try { splatView?.dispose?.(); } catch (_) {}
      splatView = null;
      console.warn('[Photo→3D] Spark preview unavailable; PLY export is still ready:', previewError);
      done('PLY ready. The optional 3D preview is unavailable, but Download PLY and Open in Studio still work.');
    }
  } catch (error) { fail(error); } finally { busy = false; }
}

/** Minimal Spark viewer with a limited orbit (the back side is unknown). */
async function createSplatPreview(canvas) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minAzimuthAngle = -0.6; controls.maxAzimuthAngle = 0.6;
  controls.minPolarAngle = Math.PI / 2 - 0.45; controls.maxPolarAngle = Math.PI / 2 + 0.45;
  let mesh = null, raf = 0, disposed = false;
  const fit = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const loop = () => { if (disposed) return; fit(); controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();
  return {
    async show(bytes) {
      const next = new SplatMesh({ fileBytes: bytes, fileName: 'photo-3d.ply' });
      scene.add(next);
      if (next.initialized) await next.initialized;
      if (mesh) { scene.remove(mesh); mesh.dispose?.(); }
      mesh = next;
      // Frame the original camera viewpoint.
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      const dist = Math.max(size.x, size.y) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.08;
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, Math.max(0.5, dist));
      controls.minDistance = dist * 0.4; controls.maxDistance = dist * 2.5;
      controls.update();
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); if (mesh) { scene.remove(mesh); mesh.dispose?.(); } renderer.dispose(); },
  };
}

// ── Wiring ──────────────────────────────────────────────────────────────
els.file.addEventListener('change', () => handleFile(els.file.files?.[0]).finally(() => { els.file.value = ''; }));
els.drop.addEventListener('dragover', e => { e.preventDefault(); els.drop.classList.add('drag'); });
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('drag'));
els.drop.addEventListener('drop', e => { e.preventDefault(); els.drop.classList.remove('drag'); handleFile(e.dataTransfer?.files?.[0]); });
els.tabs.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) showTab(t.dataset.tab); });
for (const input of [els.strength, els.focus, els.depth, els.background]) input.addEventListener('input', outputs);
els.strength.addEventListener('input', () => poster?.set({ strength: Number(els.strength.value) }));
els.focus.addEventListener('input', () => poster?.set({ focus: Number(els.focus.value) }));
let rebuildTimer = 0;
const scheduleRebuild = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => buildSplat().catch(fail), 350); };
els.depth.addEventListener('change', scheduleRebuild);
els.background.addEventListener('change', scheduleRebuild);
$('p3Detail').addEventListener('click', e => {
  const b = e.target.closest('[data-detail]'); if (!b) return;
  detail = Number(b.dataset.detail);
  for (const x of $('p3Detail').querySelectorAll('[data-detail]')) x.setAttribute('aria-pressed', String(x === b));
  scheduleRebuild();
});
els.posterPanel.addEventListener('click', async e => {
  const m = e.target.closest('[data-motion]'); if (!m || !poster) return;
  try {
    if (m.dataset.motion === 'tilt') await poster.enableTilt(); else poster.set({ mode: m.dataset.motion });
    for (const x of els.posterPanel.querySelectorAll('[data-motion]')) x.setAttribute('aria-pressed', String(x === m));
  } catch (error) { fail(error); }
});
$('p3Record').addEventListener('click', async () => {
  if (!poster) return;
  const btn = $('p3Record'); btn.disabled = true; btn.textContent = 'Recording…';
  try { const blob = await poster.recordLoop(); download(blob, `${fileName}-3d-poster.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`); }
  catch (error) { fail(error); }
  finally { btn.disabled = false; btn.textContent = 'Download video loop'; }
});
$('p3Still').addEventListener('click', async () => {
  if (!poster) return;
  const blob = await (await fetch(poster.snapshot())).blob();
  download(blob, `${fileName}-3d-poster.png`);
});
els.downloadPly.addEventListener('click', () => plyBytes && download(new Blob([plyBytes], { type: 'application/octet-stream' }), `${fileName}-3d.ply`));
els.openStudio.addEventListener('click', async () => {
  if (!plyBytes) return;
  try {
    const id = await putHandoff({ bytes: plyBytes, filename: `${fileName}-3d.ply`, kind: 'photo-to-3d' });
    location.href = 'edit.html?handoff=' + encodeURIComponent(id);
  } catch (error) { fail(error); }
});
for (const id of ['p3PosterNew', 'p3SplatNew']) $(id).addEventListener('click', () => { reset(); els.progress.style.display = 'none'; els.file.click(); });
outputs();

// Test/automation hook.
window.FumocaPhoto3D = { handleFile, buildSplat, showTab, get plyBytes() { return plyBytes; } };
