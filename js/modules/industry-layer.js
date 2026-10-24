/**
 * Viewer tools the 2026 splat editors already ship and this page did not:
 * walk, click-to-glide, measure, two-point upright, crop, detail, light, backdrop.
 * A door that was never filmed open is still a GPU job. This file does not pretend otherwise.
 */
import * as THREE from 'three';
import { getClips, playClip } from './anim-studio.js';
import {
  sceneCenter, sceneRadius, viewPose, floaterMask,
  pickNearest, formatDistance, uprightFromEdge, applyRotation, insideCrop,
} from './industry-math.js';

const VIEWS = [
  ['front', 'Front'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['top', 'Dollhouse'],
  ['under', 'Under'],
];

let mode = 'orbit';
let sheetOpen = false;
let picks = [];
let walkOn = false;
let walking = false;
const keys = Object.create(null);
let baseSizes = null;

function storageKey() {
  const id = new URLSearchParams(location.search).get('nifId') || 'local';
  return 'fumoca:views:' + id;
}
function loadViews() {
  try { return JSON.parse(localStorage.getItem(storageKey()) || '[]'); } catch (_) { return []; }
}
function saveViews(list) {
  try { localStorage.setItem(storageKey(), JSON.stringify(list.slice(0, 24))); } catch (_) {}
}

function frame(position, target) {
  const cam = window._fumocaViewerCamera;
  const controls = window._fumocaViewerControls;
  if (!cam) return false;
  cam.position.set(position[0], position[1], position[2]);
  cam.lookAt(target[0], target[1], target[2]);
  cam.up.set(0, 1, 0);
  if (controls?.target) {
    controls.target.set(target[0], target[1], target[2]);
    controls.update?.();
  }
  return true;
}

function goNamed(name) {
  const g = window._fumocaCurrentGaussians;
  if (!g?.N) return;
  const pose = viewPose(name, sceneCenter(g), sceneRadius(g));
  frame(pose.position, pose.target);
}

function remember() {
  const cam = window._fumocaViewerCamera;
  const controls = window._fumocaViewerControls;
  if (!cam) return;
  const list = loadViews();
  list.push({
    name: 'View ' + (list.length + 1),
    position: [cam.position.x, cam.position.y, cam.position.z],
    target: controls?.target ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0],
  });
  saveViews(list);
  paint();
}

function pointGeo() {
  return window._fumocaPointGeometry || null;
}

function rememberSizes() {
  const attr = pointGeo()?.getAttribute?.('aSize');
  if (!attr || baseSizes) return;
  baseSizes = new Float32Array(attr.array);
}

function applyLook() {
  const geo = pointGeo();
  const g = window._fumocaCurrentGaussians;
  if (!geo || !g?.N) return;
  rememberSizes();
  const sizeAttr = geo.getAttribute('aSize');
  if (!sizeAttr || !baseSizes) return;
  const density = Number(document.getElementById('fiDensity')?.value || 100);
  const crop = Number(document.getElementById('fiCrop')?.value || 100) / 100;
  const stride = Math.max(1, Math.round(100 / Math.max(density, 1)));
  const center = sceneCenter(g);
  const radius = sceneRadius(g);
  for (let i = 0; i < g.N; i++) {
    const keep = (i % stride === 0) && insideCrop(g.posX[i], g.posY[i], g.posZ[i], center, radius, crop);
    sizeAttr.setX(i, keep ? baseSizes[i] : 0);
  }
  sizeAttr.needsUpdate = true;
  const mat = geo.userData?.material || window._fumocaPointMaterial;
  const sizeMul = Number(document.getElementById('fiSize')?.value || 100) / 100;
  const light = Number(document.getElementById('fiLight')?.value || 100) / 100;
  if (mat?.uniforms?.uBaseSize) mat.uniforms.uBaseSize.value = (window._fumocaPointBase || mat.uniforms.uBaseSize.value) * sizeMul;
  if (mat?.uniforms?.uBrightness) mat.uniforms.uBrightness.value = 1.15 * light;
  const bg = document.getElementById('fiBg')?.value || '#07090d';
  window._fumocaViewerRenderer?.setClearColor?.(bg, 1);
}

function applyFloaterClean() {
  const g = window._fumocaCurrentGaussians;
  if (!g?.N || !g.posX) return { removed: 0 };
  const mask = floaterMask(g);
  let removed = 0;
  const geo = pointGeo();
  const opacity = geo?.getAttribute?.('aOpacity');
  const size = geo?.getAttribute?.('aSize');
  rememberSizes();
  for (let i = 0; i < g.N; i++) {
    if (mask[i]) continue;
    removed++;
    if (baseSizes) baseSizes[i] = 0;
    if (opacity) opacity.setX(i, 0);
    if (size) size.setX(i, 0);
  }
  if (opacity) opacity.needsUpdate = true;
  if (size) size.needsUpdate = true;
  return { removed };
}

function canvasEl() {
  return window._fumocaViewerRenderer?.domElement
    || document.querySelector('#stageHost canvas')
    || document.querySelector('#viewport canvas');
}

function rayFrom(ev) {
  const cam = window._fumocaViewerCamera;
  const canvas = canvasEl();
  if (!cam || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  const ndc = new THREE.Vector3(x, y, 0.5).unproject(cam);
  const dir = ndc.sub(cam.position).normalize();
  return {
    origin: [cam.position.x, cam.position.y, cam.position.z],
    dir: [dir.x, dir.y, dir.z],
  };
}

function hitFrom(ev) {
  const g = window._fumocaCurrentGaussians;
  const ray = rayFrom(ev);
  if (!g?.N || !ray) return null;
  return pickNearest(g, ray.origin, ray.dir);
}

function onStageClick(ev) {
  if (ev.target.closest?.('.fumoca-industry')) return;
  if (mode !== 'measure' && mode !== 'upright') return;
  const hit = hitFrom(ev);
  if (!hit) {
    bNote(document.getElementById('fumocaIndustryDock'), 'Click landed off the subject.');
    return;
  }
  picks.push(hit);
  if (picks.length < 2) {
    bNote(document.getElementById('fumocaIndustryDock'), mode === 'measure' ? 'Click the second point.' : 'Click the top of that edge.');
    return;
  }
  const [a, b] = picks;
  picks = [];
  if (mode === 'measure') {
    const scale = Number(window._fumocaCalibration?.metersPerUnit || window._fumocaCalibration?.scale || 0);
    const out = formatDistance(a, b, scale);
    bNote(document.getElementById('fumocaIndustryDock'), scale ? out.label : out.label + ' — not a tape measure until the file has a real scale.');
    return;
  }
  straighten(a, b);
}

function straighten(a, b) {
  const g = window._fumocaCurrentGaussians;
  const geo = pointGeo();
  const pos = geo?.getAttribute?.('position');
  if (!g?.N || !pos) {
    bNote(document.getElementById('fumocaIndustryDock'), 'Upright works on the point view. A trained splat needs the same tool in the editor.');
    return;
  }
  const rot = uprightFromEdge([a.x, a.y, a.z], [b.x, b.y, b.z]);
  const origin = sceneCenter(g);
  const out = applyRotation(pos.array, rot, origin);
  pos.array.set(out);
  pos.needsUpdate = true;
  for (let i = 0; i < g.N; i++) {
    g.posX[i] = out[i * 3];
    g.posY[i] = out[i * 3 + 1];
    g.posZ[i] = out[i * 3 + 2];
  }
  bNote(document.getElementById('fumocaIndustryDock'), 'Edge set upright.');
}

function glide(ev) {
  const hit = hitFrom(ev);
  const cam = window._fumocaViewerCamera;
  const controls = window._fumocaViewerControls;
  const g = window._fumocaCurrentGaussians;
  if (!hit || !cam || !g?.N) return;
  const r = sceneRadius(g);
  const from = cam.position.clone();
  const to = new THREE.Vector3(hit.x, hit.y + r * 0.18, hit.z + r * 0.22);
  const tgtFrom = controls?.target?.clone?.() || from.clone();
  const tgtTo = new THREE.Vector3(hit.x, hit.y, hit.z);
  const t0 = performance.now();
  const step = (now) => {
    const u = Math.min(1, (now - t0) / 680);
    const e = u * u * (3 - 2 * u);
    cam.position.lerpVectors(from, to, e);
    if (controls?.target) {
      controls.target.lerpVectors(tgtFrom, tgtTo, e);
      controls.update?.();
    }
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function walkTick() {
  if (!walkOn) { walking = false; return; }
  walking = true;
  const cam = window._fumocaViewerCamera;
  const controls = window._fumocaViewerControls;
  if (cam && document.activeElement?.tagName !== 'INPUT') {
    const g = window._fumocaCurrentGaussians;
    const r = g?.N ? sceneRadius(g) : 1;
    const step = r * (keys.ShiftLeft || keys.ShiftRight ? 0.035 : 0.014);
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (keys.KeyW) move.add(forward);
    if (keys.KeyS) move.sub(forward);
    if (keys.KeyA) move.sub(right);
    if (keys.KeyD) move.add(right);
    if (keys.Space) move.y += 1;
    if (keys.KeyC) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(step);
      cam.position.add(move);
      if (controls?.target) controls.target.add(move);
      controls?.update?.();
    }
  }
  requestAnimationFrame(walkTick);
}

function setWalk(on) {
  walkOn = on;
  if (on && !walking) walkTick();
}

function setMode(next) {
  mode = next;
  picks = [];
  setWalk(next === 'walk');
  document.querySelectorAll('.fumoca-industry [data-mode]').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === next);
  });
  const notes = {
    orbit: 'Drag to tumble. The subject stays in frame.',
    walk: 'W forward, S back, A left, D right. Space up, C down. Double-click a surface to glide there.',
    measure: 'Click two points. Without a calibration marker this is not a tape measure.',
    upright: 'Click the bottom of a door frame, then the top. That edge becomes up.',
  };
  bNote(document.getElementById('fumocaIndustryDock'), notes[next]);
}

function paint() {
  const root = document.getElementById('fumocaIndustryDock');
  if (!root) return;
  const saved = loadViews();
  const clips = typeof getClips === 'function' ? getClips() : [];
  root.innerHTML = `
    <button type="button" class="fi-tab" id="fiToggle">Studio tools</button>
    <div class="fi-sheet"${sheetOpen ? '' : ' hidden'}>
      <div class="fi-row">
        <button type="button" data-mode="orbit" class="${mode === 'orbit' ? 'on' : ''}">Orbit</button>
        <button type="button" data-mode="walk" class="${mode === 'walk' ? 'on' : ''}">Walk</button>
        <button type="button" data-mode="measure" class="${mode === 'measure' ? 'on' : ''}">Measure</button>
        <button type="button" data-mode="upright" class="${mode === 'upright' ? 'on' : ''}">Upright</button>
      </div>
      <div class="fi-row">
        ${VIEWS.map(([id, label]) => `<button type="button" data-view="${id}">${label}</button>`).join('')}
        <button type="button" data-save="1">Save angle</button>
      </div>
      ${saved.length ? `<div class="fi-row">${saved.map((v, i) => `<button type="button" data-saved="${i}">${v.name}</button>`).join('')}</div>` : ''}
      <div class="fi-sliders">
        <label>Detail <input id="fiDensity" type="range" min="15" max="100" value="100"></label>
        <label>Size <input id="fiSize" type="range" min="40" max="220" value="100"></label>
        <label>Light <input id="fiLight" type="range" min="40" max="180" value="100"></label>
        <label>Crop <input id="fiCrop" type="range" min="25" max="100" value="100"></label>
        <label>Backdrop <input id="fiBg" type="color" value="#07090d"></label>
      </div>
      <div class="fi-row">
        ${clips.slice(0, 8).map((c) => `<button type="button" data-clip="${c.id}">${c.label}</button>`).join('')}
        <button type="button" data-clean="1">Hide floaters</button>
      </div>
      <p class="fi-note">Walk and measure work on what is loaded. A printed mesh, a learned open-door, and streamed LOD still need the GPU pipeline.</p>
    </div>`;
  const sheet = root.querySelector('.fi-sheet');
  root.querySelector('#fiToggle').onclick = () => {
    sheetOpen = sheet.hidden;
    sheet.hidden = !sheet.hidden;
  };
  root.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  root.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => goNamed(b.dataset.view); });
  root.querySelector('[data-save]').onclick = remember;
  root.querySelectorAll('[data-saved]').forEach((b) => {
    b.onclick = () => {
      const v = loadViews()[Number(b.dataset.saved)];
      if (v) frame(v.position, v.target);
    };
  });
  root.querySelectorAll('[data-clip]').forEach((b) => { b.onclick = () => playClip(b.dataset.clip); });
  root.querySelector('[data-clean]').onclick = () => {
    const { removed } = applyFloaterClean();
    bNote(root, removed ? `Hid ${removed} stray points` : 'Nothing stray to hide');
  };
  root.querySelectorAll('input').forEach((input) => { input.oninput = applyLook; });
}

function bNote(root, text) {
  const n = root?.querySelector('.fi-note');
  if (n && text) n.textContent = text;
}

function mount() {
  if (!document.querySelector('link[data-fumoca-industry]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../css/industry-layer.css', import.meta.url).href;
    link.dataset.fumocaIndustry = '1';
    document.head.appendChild(link);
  }
  if (!document.getElementById('fumocaIndustryDock')) {
    const dock = document.createElement('div');
    dock.id = 'fumocaIndustryDock';
    dock.className = 'fumoca-industry';
    (document.body || document.documentElement).appendChild(dock);
  }
  paint();
  const stage = document.getElementById('stage') || document.getElementById('viewport');
  if (stage && !stage.dataset.industryBound) {
    stage.dataset.industryBound = '1';
    stage.addEventListener('click', onStageClick);
    stage.addEventListener('dblclick', (ev) => { if (mode === 'walk') glide(ev); });
  }
}

if (typeof document !== 'undefined') {
  const armKeys = () => {
    window.addEventListener('keydown', (ev) => {
      if (!walkOn || ev.target?.matches?.('input, textarea')) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight'].includes(ev.code)) {
        keys[ev.code] = true;
        ev.preventDefault();
      }
    });
    window.addEventListener('keyup', (ev) => { keys[ev.code] = false; });
  };
  if (document.body) { mount(); armKeys(); }
  else document.addEventListener('DOMContentLoaded', () => { mount(); armKeys(); });
  window.addEventListener('fumoca:viewerReady', () => {
    document.body?.classList.remove('media-flat');
    baseSizes = null;
    const mat = window._fumocaPointMaterial;
    if (mat?.uniforms?.uBaseSize) window._fumocaPointBase = mat.uniforms.uBaseSize.value;
    paint();
  });
}

window.fumocaGoView = goNamed;
window.fumocaCleanupFloaters = applyFloaterClean;
window.fumocaSetTool = setMode;
