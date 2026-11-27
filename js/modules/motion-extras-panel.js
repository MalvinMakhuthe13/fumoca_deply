/**
 * Studio (Parts tab): "Free move" — animate any area as you please, no part
 * to make first — and "Shoe laces" — click the eyelets, lace up and tie.
 * CPU only, no AI.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MotionExtras } from './motion-extras.js';
import { normalizeClips, normalizeClip, pinPose } from './free-move.js';
import { normalizeLaces, surfaceNormal, LACED } from './shoe-laces.js';
import { readRest } from './splat-rig-driver.js';
import { SOUNDS, MAX_SOUND_BYTES } from './part-animator.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const R2D = 180 / Math.PI;

export function mountMotionExtras(container, { onStatus } = {}) {
  if (!container) return null;
  const root = document.createElement('div');
  root.id = 'motionExtras';
  root.innerHTML = `
    <div class="section">
      <div class="sec-head"><span class="sec-label">✋ Free move — animate anything</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">No part needed. <b>Add pin</b>, click the scan, then drag the arrows to move or switch to <b>Turn</b>. The area around the pin follows softly. Move the time slider and drag again for the next pose — every drag is a keyframe. <b>Hold pins</b> keep an area still.</div>
        <div class="ctrl-row" style="margin-top:8px;gap:6px">
          <select id="fmClip" class="ac-select" style="flex:1"></select>
          <button type="button" class="ac-btn" id="fmNew" title="New free move">＋ New</button>
        </div>
        <div id="fmBody" style="display:none">
          <div class="ctrl-row" style="gap:6px;margin-top:6px">
            <input id="fmName" class="ac-input" style="flex:1" maxlength="60" placeholder="Name">
            <button type="button" class="ac-btn" id="fmDel" title="Delete this free move">🗑</button>
          </div>
          <div class="ctrl-row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
            <button type="button" class="ac-btn lime" id="fmAddPin">📍 Add pin</button>
            <button type="button" class="ac-btn" id="fmAddHold">📌 Hold pin</button>
            <button type="button" class="ac-btn" id="fmGizmoMode">↔ Move</button>
          </div>
          <div id="fmPins" style="margin-top:6px;display:flex;flex-direction:column;gap:4px"></div>
          <div id="fmPinEdit" style="display:none;margin-top:6px">
            <div class="ctrl-row"><span class="ctrl-label">Area size</span><input type="range" id="fmRadius" min="1" max="100" value="12" style="flex:1"><span id="fmRadiusV" class="ctrl-val"></span></div>
            <div class="ctrl-row"><span class="ctrl-label">Softness</span><input type="range" id="fmSoft" min="0" max="100" value="60" style="flex:1"><span id="fmSoftV" class="ctrl-val"></span></div>
            <div class="hint" id="fmReach"></div>
          </div>
          <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Time</span><input type="range" id="fmTime" min="0" max="1000" value="0" style="flex:1"><span id="fmTimeV" class="ctrl-val">0.00s</span></div>
          <div id="fmKeys" style="position:relative;height:14px;margin:2px 0 6px;border-radius:4px;background:rgba(255,255,255,.06)"></div>
          <div class="ctrl-row" style="gap:6px;flex-wrap:wrap">
            <button type="button" class="ac-btn" id="fmKey" title="Keyframe the selected pin here">◆ Key</button>
            <button type="button" class="ac-btn" id="fmUnkey" title="Remove the selected pin's key at this time">◇ Remove key</button>
            <button type="button" class="ac-btn" id="fmRec" title="Play in real time and record while you drag">● Record</button>
            <button type="button" class="ac-btn lime" id="fmPlay">▶ Play</button>
            <button type="button" class="ac-btn" id="fmHome">⏮ Start</button>
          </div>
          <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Length</span><input type="number" id="fmDur" class="ac-input" min="0.2" max="60" step="0.1" style="width:70px"><span class="ctrl-val">s</span>
            <select id="fmLoop" class="ac-select" style="margin-left:6px"><option value="once">Play once</option><option value="loop">Loop</option><option value="bounce">Back and forth</option></select></div>
          <div class="ctrl-row"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fmAuto"> Plays by itself in the viewer</label></div>
          <div class="ctrl-row"><span class="ctrl-label">Sound</span><select id="fmSound" class="ac-select" style="flex:1">${SOUNDS.map(s => `<option>${s}</option>`).join('')}</select>
            <button type="button" class="ac-btn" id="fmSoundUp" title="Use your own recording">🎙 Upload</button><input type="file" id="fmSoundFile" accept="audio/*" style="display:none"></div>
          <div class="hint" id="fmSoundName"></div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="sec-head"><span class="sec-label">👟 Shoe laces — lace up and tie</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Press <b>Click eyelets</b>, then click each lace hole <b>from the toe up to the top</b>, both sides (any order within a pair). Then <b>Make laces</b>. Fumoca threads them criss-cross and ties a bow.</div>
        <div class="ctrl-row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
          <button type="button" class="ac-btn lime" id="lcPick">👆 Click eyelets</button>
          <button type="button" class="ac-btn" id="lcUndo">↶ Undo</button>
          <button type="button" class="ac-btn" id="lcClear">✕ Clear</button>
          <span class="ctrl-val" id="lcCount">0 eyelets</span>
        </div>
        <button type="button" class="ac-btn lime full" id="lcMake" style="margin-top:6px">Make laces</button>
        <select id="lcList" class="ac-select" style="width:100%;margin-top:8px;display:none"></select>
        <div id="lcEdit" style="display:none;margin-top:6px">
          <div class="ctrl-row" style="gap:6px;flex-wrap:wrap">
            <button type="button" class="ac-btn lime" data-lc="lace">Lace up</button>
            <button type="button" class="ac-btn lime" data-lc="tie">Tie</button>
            <button type="button" class="ac-btn" data-lc="untie">Untie</button>
            <button type="button" class="ac-btn" data-lc="unlace">Unlace</button>
          </div>
          <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Colour</span><input type="color" id="lcColor" value="#f4f1ea">
            <span class="ctrl-label" style="margin-left:8px">Tie</span><select id="lcTie" class="ac-select"><option value="bow">Bow</option><option value="knot">Knot</option><option value="none">Loose ends</option></select></div>
          <div class="ctrl-row"><span class="ctrl-label">Thickness</span><input type="range" id="lcWidth" min="20" max="300" value="100" style="flex:1"></div>
          <div class="ctrl-row"><span class="ctrl-label">Bow size</span><input type="range" id="lcBow" min="30" max="300" value="100" style="flex:1"></div>
          <div class="ctrl-row"><span class="ctrl-label">Starts</span><select id="lcStart" class="ac-select" style="flex:1"><option value="unlaced">No laces (laces itself up)</option><option value="untied">Laced, untied</option><option value="tied">Tied</option></select></div>
          <div class="ctrl-row"><span class="ctrl-label">Lace up</span><input type="number" id="lcDur" class="ac-input" min="0.4" max="20" step="0.1" style="width:64px"><span class="ctrl-val">s</span>
            <span class="ctrl-label" style="margin-left:8px">Tie</span><input type="number" id="lcTieDur" class="ac-input" min="0.3" max="10" step="0.1" style="width:64px"><span class="ctrl-val">s</span></div>
          <div class="ctrl-row"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="lcAuto"> Laces up and ties by itself in the viewer</label></div>
          <div class="ctrl-row"><span class="ctrl-label">Sound</span><select id="lcSound" class="ac-select" style="flex:1">${SOUNDS.map(s => `<option>${s}</option>`).join('')}</select>
            <button type="button" class="ac-btn" id="lcSoundUp" title="Use your own recording">🎙 Upload</button><input type="file" id="lcSoundFile" accept="audio/*" style="display:none"></div>
          <div class="hint" id="lcSoundName"></div>
          <button type="button" class="ac-btn full" id="lcDel" style="margin-top:6px">🗑 Delete laces</button>
        </div>
        <div class="hint" id="mxStatus" style="margin-top:8px"></div>
      </div>
    </div>`;
  container.appendChild(root);
  const q = (s) => root.querySelector(s);
  const status = (m) => { q('#mxStatus').textContent = m; onStatus?.(m); };

  let clips = [], laces = [], curClip = null, curPin = null, curLace = null;
  let extras = null, extrasMesh = null, rest = null, size = 1;
  let picking = null;        // 'pin' | 'hold' | 'eyelet'
  let eyelets = [];          // being clicked
  let time = 0, gizmoMode = 'translate', recording = false;

  const sparkMesh = () => (window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null);
  async function needMesh() {
    let m = sparkMesh();
    if (!m && window.FumocaStudioHooks?.ensureSpark) m = await window.FumocaStudioHooks.ensureSpark();
    if (!m) { status('Photoreal (Spark) could not start on this device — free move and laces need it.'); return null; }
    if (m.initialized) await m.initialized;
    return m;
  }
  function ensureExtras() {
    const mesh = sparkMesh(); if (!mesh) return null;
    if (extras && extrasMesh === mesh) return extras;
    extras?.dispose?.(); helpers.parent?.remove(helpers);
    try {
      extras = new MotionExtras(THREE, mesh, { freeMoves: clips, laces }); extrasMesh = mesh; rest = null;
      mesh.add(helpers);
    } catch (e) { extras = null; status(e.message); }
    return extras;
  }
  function restInfo() {
    const mesh = sparkMesh(); if (!mesh) return null;
    if (!rest) {
      rest = readRest(mesh); if (!rest) return null;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], step = Math.max(1, Math.floor(rest.count / 20000));
      for (let i = 0; i < rest.count; i += step) for (let k = 0; k < 3; k++) { const v = rest.positions[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
      size = Math.max(1e-4, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    }
    return rest;
  }
  const changed = () => {
    extras?.setFreeMoves(clips); extras?.setLaces(laces);
    window.dispatchEvent(new CustomEvent('fumoca:motionExtrasChange', { detail: { freeMoves: clips, laces } }));
  };

  // ── helpers drawn in Studio only: pin balls and eyelet dots ──
  const helpers = new THREE.Group(); helpers.name = 'fumoca-motion-helpers'; helpers.renderOrder = 9;
  const ballMat = (c) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9 });
  function drawHelpers() {
    for (const o of [...helpers.children]) { helpers.remove(o); o.geometry?.dispose?.(); o.material?.dispose?.(); }
    const r = size * 0.006;
    const c = clips.find(x => x.id === curClip);
    for (const p of c?.pins || []) {
      const P = pinPose(p, time), b = new THREE.Mesh(new THREE.SphereGeometry(r * (p.id === curPin ? 1.5 : 1), 12, 10), ballMat(p.hold ? 0xff7a59 : p.id === curPin ? 0xc8ff00 : 0x7fd3ff));
      b.position.set(p.at[0] + P.move[0], p.at[1] + P.move[1], p.at[2] + P.move[2]); b.renderOrder = 9; helpers.add(b);
      if (p.id === curPin) {   // area ring
        const ring = new THREE.Mesh(new THREE.SphereGeometry(p.radius, 20, 14), new THREE.MeshBasicMaterial({ color: p.hold ? 0xff7a59 : 0xc8ff00, wireframe: true, transparent: true, opacity: 0.12, depthTest: false }));
        ring.position.copy(b.position); helpers.add(ring);
      }
    }
    for (const e of eyelets) { const d = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 10, 8), ballMat(0xffd400)); d.position.set(...e.p); helpers.add(d); }
  }

  // ── gizmo ──
  let tc = null; const proxy = new THREE.Object3D();
  function gizmo() {
    if (tc || !window.camera || !window.renderer) return tc;
    tc = new TransformControls(window.camera, window.renderer.domElement);
    tc.setSize(0.9); tc.setSpace('local');
    (typeof tc.getHelper === 'function' ? window.scene.add(tc.getHelper()) : window.scene.add(tc));
    tc.addEventListener('dragging-changed', (e) => {
      if (window.controls) window.controls.enabled = !e.value;
      if (!e.value) { changed(); drawHelpers(); renderKeys(); }
    });
    tc.addEventListener('objectChange', onGizmo);
    return tc;
  }
  function attachGizmo() {
    const c = clips.find(x => x.id === curClip), p = c?.pins.find(x => x.id === curPin), mesh = sparkMesh();
    if (!p || p.hold || !mesh || !gizmo()) { tc?.detach(); return; }
    if (proxy.parent !== mesh) mesh.add(proxy);
    const P = pinPose(p, time);
    proxy.position.set(p.at[0] + P.move[0], p.at[1] + P.move[1], p.at[2] + P.move[2]);
    proxy.rotation.set(P.turn[0] / R2D, P.turn[1] / R2D, P.turn[2] / R2D, 'XYZ');
    tc.setMode(gizmoMode); tc.attach(proxy);
  }
  let poseQueued = false;
  function poseLater() {
    if (poseQueued) return; poseQueued = true;
    requestAnimationFrame(() => { poseQueued = false; extras?.mover?.pose(curClip, time); drawHelpers(); });
  }
  function setKey(p, t, move, turn) {
    const keys = p.keys.filter(k => Math.abs(k.t - t) > (recording ? 0.03 : 0.02));
    if (!p.keys.length && t > 0.02) keys.push({ t: 0, move: [0, 0, 0], turn: [0, 0, 0] });   // starts where it is
    keys.push({ t, move, turn });
    p.keys = keys.sort((a, b) => a.t - b.t);
  }
  function onGizmo() {
    const c = clips.find(x => x.id === curClip), p = c?.pins.find(x => x.id === curPin); if (!p) return;
    const move = [proxy.position.x - p.at[0], proxy.position.y - p.at[1], proxy.position.z - p.at[2]];
    const turn = [proxy.rotation.x * R2D, proxy.rotation.y * R2D, proxy.rotation.z * R2D];
    setKey(p, +time.toFixed(3), move, turn);
    extras?.mover?.setClips(clips);
    poseLater();
  }

  // ── clicking the scan (pins, eyelets) ──
  const dom = window.renderer?.domElement;
  let down = null;
  dom?.addEventListener('pointerdown', (e) => { down = picking ? { x: e.clientX, y: e.clientY } : null; }, true);
  dom?.addEventListener('pointerup', async (e) => {
    if (!picking || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || tc?.dragging || tc?.axis) { down = null; return; }
    down = null;
    const w = window.FumocaOutline?.dotAt?.(e.clientX, e.clientY);
    const mesh = sparkMesh();
    if (!w || !mesh) { status('Click on the scan itself (zoom in closer if needed).'); return; }
    const p = mesh.worldToLocal(w.clone()).toArray();
    const R = restInfo();
    if (picking === 'eyelet') {
      const cam = mesh.worldToLocal(window.camera.position.clone()).toArray();
      const n = R ? surfaceNormal(R.positions, R.count, p, { radius: size * 0.012, toward: cam }) : null;
      eyelets.push({ p, n }); q('#lcCount').textContent = `${eyelets.length} eyelet${eyelets.length === 1 ? '' : 's'}`;
      drawHelpers(); status(`${eyelets.length} eyelets — keep going from the toe to the top, then Make laces.`);
      return;
    }
    const c = clips.find(x => x.id === curClip); if (!c) return;
    const pin = { id: uid('pin'), at: p, radius: size * (picking === 'hold' ? 0.1 : 0.08), soft: picking === 'hold' ? 0.3 : 0.6, hold: picking === 'hold', keys: [] };
    c.pins.push(pin); curPin = pin.id;
    clips = normalizeClips(clips); changed();
    const reach = extras?.mover?.reachCount(c.id) || 0;
    status(pin.hold ? 'Hold pin placed — that area stays still.' : `Pin placed — drag the arrows to move it (${reach.toLocaleString()} splats follow). Switch to Turn to rotate.`);
    stopPicking(); renderClip();
  }, true);
  // quick clicks while placing must not count as Studio's double-click select
  dom?.addEventListener('dblclick', (e) => { if (picking) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  function startPicking(kind) {
    picking = kind; window.FumocaStudioHooks?.setMode?.('orbit');
    q('#fmAddPin').classList.toggle('active', kind === 'pin'); q('#fmAddHold').classList.toggle('active', kind === 'hold'); q('#lcPick').classList.toggle('active', kind === 'eyelet');
    q('#lcPick').textContent = kind === 'eyelet' ? '✓ Done clicking' : '👆 Click eyelets';
  }
  function stopPicking() { startPicking(null); picking = null; }

  // ── free move UI ──
  function renderClipList() {
    q('#fmClip').innerHTML = clips.length ? clips.map(c => `<option value="${esc(c.id)}"${c.id === curClip ? ' selected' : ''}>${esc(c.name)}</option>`).join('') : '<option value="">— no free moves yet —</option>';
    q('#fmBody').style.display = curClip ? '' : 'none';
  }
  function renderKeys() {
    const c = clips.find(x => x.id === curClip), bar = q('#fmKeys'); if (!c) { bar.innerHTML = ''; return; }
    const ticks = [];
    for (const p of c.pins) for (const k of p.keys) ticks.push(`<span title="${esc(k.t.toFixed(2))}s" style="position:absolute;top:2px;left:calc(${(k.t / c.duration) * 100}% - 4px);width:8px;height:10px;transform:rotate(45deg) scale(.7);background:${p.id === curPin ? '#c8ff00' : 'rgba(127,211,255,.6)'}"></span>`);
    ticks.push(`<span style="position:absolute;top:0;bottom:0;left:${(time / c.duration) * 100}%;width:2px;background:#fff"></span>`);
    bar.innerHTML = ticks.join('');
  }
  function renderClip() {
    renderClipList();
    const c = clips.find(x => x.id === curClip);
    if (!c) { tc?.detach(); drawHelpers(); return; }
    q('#fmName').value = c.name; q('#fmDur').value = c.duration; q('#fmLoop').value = c.loop; q('#fmAuto').checked = c.autoplay; q('#fmSound').value = c.sound;
    q('#fmSoundName').textContent = c.soundFile ? `🎙 ${c.soundFile.name} (your recording) — ` : '';
    if (c.soundFile) { const x = document.createElement('a'); x.href = '#'; x.textContent = 'remove'; x.onclick = (e) => { e.preventDefault(); delete c.soundFile; changed(); renderClip(); }; q('#fmSoundName').appendChild(x); }
    if (!c.pins.some(p => p.id === curPin)) curPin = c.pins.find(p => !p.hold)?.id || c.pins[0]?.id || null;
    q('#fmPins').innerHTML = c.pins.map((p, i) => `<div style="display:flex;gap:4px;align-items:center"><button type="button" class="ac-btn${p.id === curPin ? ' lime' : ''}" data-pin="${esc(p.id)}" style="flex:1;text-align:left">${p.hold ? '📌 Hold' : '📍 Pin'} ${i + 1}${p.hold ? '' : ` · ${p.keys.length} key${p.keys.length === 1 ? '' : 's'}`}</button><button type="button" class="ac-btn" data-pindel="${esc(p.id)}" title="Remove pin">✕</button></div>`).join('') || '<div class="hint">No pins yet — press Add pin and click the scan.</div>';
    const p = c.pins.find(x => x.id === curPin);
    q('#fmPinEdit').style.display = p ? '' : 'none';
    if (p) {
      const rpct = Math.round(Math.min(100, Math.max(1, (p.radius / size) * 200)));
      q('#fmRadius').value = rpct; q('#fmRadiusV').textContent = rpct + '%'; q('#fmSoft').value = Math.round(p.soft * 100); q('#fmSoftV').textContent = Math.round(p.soft * 100) + '%';
      q('#fmReach').textContent = `${(extras?.mover?.reachCount(c.id) || 0).toLocaleString()} splats move with this free move`;
    }
    q('#fmTime').value = Math.round((time / c.duration) * 1000); q('#fmTimeV').textContent = time.toFixed(2) + 's';
    q('#fmGizmoMode').textContent = gizmoMode === 'translate' ? '↔ Move' : '⟳ Turn';
    renderKeys(); drawHelpers(); attachGizmo();
  }
  const cur = () => clips.find(x => x.id === curClip);
  const curP = () => cur()?.pins.find(x => x.id === curPin);
  function setTime(t) {
    const c = cur(); if (!c) return;
    time = Math.min(c.duration, Math.max(0, t));
    extras?.mover?.pose(c.id, time);
    q('#fmTime').value = Math.round((time / c.duration) * 1000); q('#fmTimeV').textContent = time.toFixed(2) + 's';
    renderKeys(); drawHelpers(); attachGizmo();
  }

  q('#fmNew').onclick = async () => {
    if (!(await needMesh())) return;
    let name = 'Free move', k = 2; while (clips.some(c => c.name === name)) name = `Free move ${k++}`;
    const c = normalizeClip({ id: uid('move'), name, duration: 2, pins: [] });
    clips.push(c); curClip = c.id; curPin = null; time = 0;
    ensureExtras(); changed(); renderClip(); startPicking('pin');
    status('Click the scan where you want to grab it.');
  };
  q('#fmClip').onchange = () => { curClip = q('#fmClip').value || null; curPin = null; time = 0; ensureExtras(); renderClip(); };
  q('#fmName').oninput = () => { const c = cur(); if (c) { c.name = q('#fmName').value.slice(0, 60) || 'Free move'; renderClipList(); } };
  q('#fmName').onchange = () => changed();
  q('#fmDel').onclick = () => {
    const c = cur(); if (!c) return;
    extras?.mover?.pose(c.id, 0);
    clips = clips.filter(x => x.id !== c.id); curClip = clips[0]?.id || null; curPin = null; time = 0;
    changed(); renderClip(); status(`Deleted “${c.name}”.`);
  };
  q('#fmAddPin').onclick = async () => { if (!(await needMesh())) return; ensureExtras(); picking === 'pin' ? stopPicking() : startPicking('pin'); if (picking) status('Click the scan where you want to grab it.'); };
  q('#fmAddHold').onclick = async () => { if (!(await needMesh())) return; ensureExtras(); picking === 'hold' ? stopPicking() : startPicking('hold'); if (picking) status('Click an area that must stay still (the sole, the base…).'); };
  q('#fmGizmoMode').onclick = () => { gizmoMode = gizmoMode === 'translate' ? 'rotate' : 'translate'; renderClip(); };
  q('#fmPins').onclick = (e) => {
    const b = e.target.closest('[data-pin],[data-pindel]'); if (!b) return;
    const c = cur(); if (!c) return;
    if (b.dataset.pin) { curPin = b.dataset.pin; renderClip(); return; }
    c.pins = c.pins.filter(p => p.id !== b.dataset.pindel); if (curPin === b.dataset.pindel) curPin = null;
    clips = normalizeClips(clips); changed(); renderClip();
  };
  q('#fmRadius').oninput = () => { const p = curP(); if (!p) return; p.radius = size * (+q('#fmRadius').value / 200); q('#fmRadiusV').textContent = q('#fmRadius').value + '%'; drawHelpers(); };
  q('#fmSoft').oninput = () => { const p = curP(); if (!p) return; p.soft = +q('#fmSoft').value / 100; q('#fmSoftV').textContent = q('#fmSoft').value + '%'; };
  for (const id of ['#fmRadius', '#fmSoft']) q(id).onchange = () => { changed(); setTime(time); renderClip(); };
  q('#fmTime').oninput = () => { const c = cur(); if (c) setTime((+q('#fmTime').value / 1000) * c.duration); };
  q('#fmKey').onclick = () => { const p = curP(); if (!p || p.hold) { status('Pick a pin first.'); return; } const P = pinPose(p, time); setKey(p, +time.toFixed(3), P.move, P.turn); changed(); renderClip(); status(`Key at ${time.toFixed(2)}s.`); };
  q('#fmUnkey').onclick = () => { const p = curP(); if (!p) return; const n = p.keys.length; p.keys = p.keys.filter(k => Math.abs(k.t - time) > 0.05); changed(); setTime(time); renderClip(); status(n === p.keys.length ? 'No key at this time.' : 'Key removed.'); };
  q('#fmDur').onchange = () => {
    const c = cur(); if (!c) return;
    const d = Math.min(60, Math.max(0.2, +q('#fmDur').value || c.duration)), f = d / c.duration;
    for (const p of c.pins) for (const k of p.keys) k.t *= f;   // stretch the keys with it
    c.duration = d; time = Math.min(time * f, d); changed(); renderClip();
  };
  q('#fmLoop').onchange = () => { const c = cur(); if (c) { c.loop = q('#fmLoop').value; changed(); } };
  q('#fmAuto').onchange = () => { const c = cur(); if (c) { c.autoplay = q('#fmAuto').checked; changed(); } };
  q('#fmSound').onchange = () => { const c = cur(); if (c) { c.sound = q('#fmSound').value; changed(); } };
  q('#fmHome').onclick = () => setTime(0);
  q('#fmPlay').onclick = async () => {
    const c = cur(), x = ensureExtras(); if (!c || !x) return;
    tc?.detach();
    if (x.mover?.anims?.has(c.id)) { x.mover.stop(c.id); q('#fmPlay').textContent = '▶ Play'; setTime(x.mover.time.get(c.id) || 0); return; }
    if (time >= c.duration - 1e-3) x.mover.pose(c.id, 0);
    q('#fmPlay').textContent = c.loop === 'once' ? '▶ Playing…' : '■ Stop';
    await x.mover.run(c.id, 'open', { by: 'studio' });
    if (c.loop === 'once') { q('#fmPlay').textContent = '▶ Play'; time = c.duration; renderClip(); }
  };
  q('#fmRec').onclick = () => {
    const c = cur(); if (!c || !curP() || curP().hold) { status('Add or pick a pin, then Record and drag it while the time runs.'); return; }
    if (recording) { recording = false; q('#fmRec').textContent = '● Record'; changed(); renderClip(); return; }
    recording = true; q('#fmRec').textContent = '■ Stop recording'; attachGizmo();
    status('Recording — drag the pin now. The time runs in real time.');
    let last = performance.now();
    const step = (now) => {
      if (!recording) return;
      time = Math.min(c.duration, time + (now - last) / 1000); last = now;
      if (!tc?.dragging) extras?.mover?.pose(c.id, time); else onGizmo();
      q('#fmTime').value = Math.round((time / c.duration) * 1000); q('#fmTimeV').textContent = time.toFixed(2) + 's'; renderKeys();
      if (time >= c.duration) { recording = false; q('#fmRec').textContent = '● Record'; changed(); renderClip(); status('Recorded. Press Play to see it.'); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ── sounds: your own recordings ──
  function readSound(file, cb) {
    if (!file) return;
    if (file.size > MAX_SOUND_BYTES) { status(`“${file.name}” is over 1.5 MB — trim it or export it as .mp3 / .m4a.`); return; }
    if (!/^audio\//.test(file.type)) { status('That is not an audio file.'); return; }
    const r = new FileReader();
    r.onload = () => cb({ name: file.name, dataUrl: String(r.result), on: 'both', volume: 0.9 });
    r.readAsDataURL(file);
  }
  q('#fmSoundUp').onclick = () => q('#fmSoundFile').click();
  q('#fmSoundFile').onchange = () => readSound(q('#fmSoundFile').files[0], (sf) => { const c = cur(); if (!c) return; c.soundFile = sf; clips = normalizeClips(clips); changed(); renderClip(); status(c.soundFile ? `Your recording “${sf.name}” plays with this move.` : 'Could not use that recording.'); q('#fmSoundFile').value = ''; });

  // ── laces UI ──
  const curL = () => laces.find(l => l.id === curLace);
  function renderLaces() {
    q('#lcList').style.display = laces.length ? '' : 'none';
    q('#lcList').innerHTML = laces.map(l => `<option value="${esc(l.id)}"${l.id === curLace ? ' selected' : ''}>👟 ${esc(l.name)} (${l.eyelets.length} eyelets)</option>`).join('');
    const l = curL(); q('#lcEdit').style.display = l ? '' : 'none';
    if (!l) return;
    q('#lcColor').value = l.color; q('#lcTie').value = l.tie; q('#lcWidth').value = Math.round(l.width * 100); q('#lcBow').value = Math.round(l.bow * 100);
    q('#lcStart').value = l.start; q('#lcDur').value = l.duration; q('#lcTieDur').value = l.tieDuration; q('#lcAuto').checked = l.autoplay; q('#lcSound').value = l.sound;
    q('#lcSoundName').textContent = l.soundFile ? `🎙 ${l.soundFile.name} (your recording) — ` : '';
    if (l.soundFile) { const x = document.createElement('a'); x.href = '#'; x.textContent = 'remove'; x.onclick = (e) => { e.preventDefault(); delete l.soundFile; changed(); renderLaces(); }; q('#lcSoundName').appendChild(x); }
  }
  q('#lcPick').onclick = async () => { if (!(await needMesh())) return; ensureExtras(); if (picking === 'eyelet') { stopPicking(); return; } startPicking('eyelet'); status('Click the lace holes from the toe up to the top, both sides.'); };
  q('#lcUndo').onclick = () => { eyelets.pop(); q('#lcCount').textContent = `${eyelets.length} eyelets`; drawHelpers(); };
  q('#lcClear').onclick = () => { eyelets = []; q('#lcCount').textContent = '0 eyelets'; drawHelpers(); };
  q('#lcMake').onclick = async () => {
    if (eyelets.length < 4) { status('Click at least 4 eyelets (2 on each side), from the toe up.'); return; }
    if (!(await needMesh())) return;
    stopPicking();
    let name = 'Laces', k = 2; while (laces.some(l => l.name === name)) name = `Laces ${k++}`;
    const l = normalizeLaces([{ id: uid('lace'), name, eyelets, start: 'unlaced' }])[0];
    if (!l) { status('Could not make laces from those eyelets.'); return; }
    laces.push(l); curLace = l.id; eyelets = []; q('#lcCount').textContent = '0 eyelets';
    ensureExtras(); changed(); drawHelpers(); renderLaces();
    status('Laces made — lacing up and tying now. Use the buttons to play it again.');
    await extras?.run(l.id, 'lace', { by: 'studio' }); await extras?.run(l.id, 'tie', { by: 'studio' });
  };
  q('#lcList').onchange = () => { curLace = q('#lcList').value; renderLaces(); };
  root.querySelectorAll('[data-lc]').forEach(b => b.onclick = async () => {
    const l = curL(); if (!l || !ensureExtras()) return;
    const to = b.dataset.lc, rig = extras.laces.get(l.id);
    if (to === 'tie' && rig && rig.t < LACED - 1e-3) await extras.run(l.id, 'lace', { by: 'studio' });
    await extras.run(l.id, to, { by: 'studio' });
  });
  const lset = (f) => () => { const l = curL(); if (!l) return; f(l); laces = normalizeLaces(laces); changed(); renderLaces(); };
  q('#lcColor').oninput = lset(l => { l.color = q('#lcColor').value; });
  q('#lcTie').onchange = lset(l => { l.tie = q('#lcTie').value; });
  q('#lcWidth').onchange = lset(l => { l.width = +q('#lcWidth').value / 100; });
  q('#lcBow').onchange = lset(l => { l.bow = +q('#lcBow').value / 100; });
  q('#lcStart').onchange = lset(l => { l.start = q('#lcStart').value; });
  q('#lcDur').onchange = lset(l => { l.duration = +q('#lcDur').value; });
  q('#lcTieDur').onchange = lset(l => { l.tieDuration = +q('#lcTieDur').value; });
  q('#lcAuto').onchange = lset(l => { l.autoplay = q('#lcAuto').checked; });
  q('#lcSound').onchange = lset(l => { l.sound = q('#lcSound').value; });
  q('#lcSoundUp').onclick = () => q('#lcSoundFile').click();
  q('#lcSoundFile').onchange = () => readSound(q('#lcSoundFile').files[0], (sf) => { const l = curL(); if (!l) return; l.soundFile = sf; laces = normalizeLaces(laces); changed(); renderLaces(); status(`Your recording “${sf.name}” plays with the laces.`); q('#lcSoundFile').value = ''; });
  q('#lcDel').onclick = () => { const l = curL(); if (!l) return; laces = laces.filter(x => x.id !== l.id); curLace = laces[0]?.id || null; changed(); renderLaces(); status(`Deleted “${l.name}”.`); };

  // ── load / save ──
  window.addEventListener('fumoca:sparkInPlaceUpdate', () => { if (extras?.mover && !extras.mover.refreshGeometry()) extras.mover.reapply(); rest = null; });
  window.addEventListener('fumoca:fileLoaded', () => {
    tc?.detach(); extras?.dispose?.(); extras = null; extrasMesh = null; rest = null;
    const pr = window._fumocaCurrentRecord?.meta?.present || {};
    clips = normalizeClips(pr.freeMoves); laces = normalizeLaces(pr.laces);
    curClip = clips[0]?.id || null; curPin = null; curLace = laces[0]?.id || null; time = 0;
    renderClip(); renderLaces();
    if (clips.length || laces.length) setTimeout(() => { if (sparkMesh()) { ensureExtras(); renderClip(); } }, 2400);
  });

  const api = {
    getFreeMoves: () => JSON.parse(JSON.stringify(clips)),
    getLaces: () => JSON.parse(JSON.stringify(laces)),
    list: () => [...clips.map(c => ({ id: c.id, name: '✋ ' + c.name })), ...laces.map(l => ({ id: l.id, name: '👟 ' + l.name }))],
    has: (id) => clips.some(c => c.id === id) || laces.some(l => l.id === id),
    run: (id, to) => ensureExtras()?.run(id, to, { by: 'studio' }),
    get extras() { return ensureExtras(); },
    /** for scripts and tests */
    _addClip(c) { const n = normalizeClip(c); if (!n) return null; clips = [...clips.filter(x => x.id !== n.id), n]; curClip = n.id; ensureExtras(); changed(); renderClip(); return n.id; },
    _addLace(l) { const n = normalizeLaces([l])[0]; if (!n) return null; laces = [...laces.filter(x => x.id !== n.id), n]; curLace = n.id; ensureExtras(); changed(); renderLaces(); return n.id; },
    _state: () => ({ picking, eyelets: eyelets.length, curClip, curPin, time }),
    _gizmo: () => tc,
  };
  window.FumocaMotionExtrasStudio = api;
  renderClip(); renderLaces();
  return api;
}
