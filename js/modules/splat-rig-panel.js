/**
 * Studio "Rig" tab: put a skeleton inside the splat, pose it, animate it.
 * Everything runs on the CPU (no AI, no server GPU). The rig and its motion
 * are saved with the NIF and play back in the public viewer.
 */
import * as THREE from 'three';
import { TEMPLATES, PRESETS_FOR, presetClip, normalizeClip, sampleClip, solvePose, posedJoints, qFromEulerDeg, qIdentity } from './splat-rig.js';
import { SplatRigDriver, fitTemplate, uprightFrame, poseToLocal, normalizeRigState, readRest } from './splat-rig-driver.js';

const EPS = 1e-6;
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
function rotVec(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountSplatRigPanel(container, { onStatus } = {}) {
  if (!container) return null;
  container.innerHTML = `
    <div class="section" id="rigSection">
      <div class="sec-head"><span class="sec-label">Skeleton · rig</span><span class="sec-badge">CPU</span></div>
      <div class="sec-body" style="padding:10px">
        <div class="hint">Put bones inside the splat, then pose or animate it. Each splat follows the nearest bones, so arms, heads and tails bend smoothly. Needs Photoreal (Spark) on.</div>
        <div class="ctrl-row" style="margin-top:8px"><span class="ctrl-label">Body type</span></div>
        <select id="rigTemplate" class="ac-select" style="width:100%">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select>
        <button type="button" class="ac-btn lime full" id="rigFit" style="margin-top:6px">Add skeleton</button>
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="rigShowBones" checked> Show bones</label>
      </div>
    </div>
    <div class="section" id="rigBonesSection" style="display:none">
      <div class="sec-head"><span class="sec-label">Bones</span></div>
      <div class="sec-body" style="padding:10px">
        <select id="rigBone" class="ac-select" style="width:100%"></select>
        <div class="hint" style="margin-top:6px">Place the joint where the bone starts (its pivot):</div>
        <div id="rigJoint"></div>
        <div class="hint" style="margin-top:6px">Pose (degrees):</div>
        <div id="rigPose"></div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn" id="rigResetBone" style="flex:1">Reset bone</button>
          <button type="button" class="ac-btn" id="rigResetAll" style="flex:1">Reset pose</button>
        </div>
      </div>
    </div>
    <div class="section" id="rigMotionSection" style="display:none">
      <div class="sec-head"><span class="sec-label">Motion</span></div>
      <div class="sec-body" style="padding:10px">
        <div style="display:flex;gap:6px"><select id="rigPreset" class="ac-select" style="flex:1"></select><button type="button" class="ac-btn" id="rigUsePreset">Use</button></div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="ac-btn lime" id="rigPlay" style="flex:1">▶ Play</button>
          <button type="button" class="ac-btn" id="rigKey" style="flex:1" title="Save the current pose as a keyframe at this time">◆ Add key</button>
          <button type="button" class="ac-btn" id="rigClear" style="flex:1">Clear</button>
        </div>
        <div class="ctrl-row" style="margin-top:6px"><span class="ctrl-label">Time</span><span class="ctrl-val" id="rigTimeVal">0.00 s</span></div>
        <input type="range" id="rigTime" min="0" max="2" step="0.01" value="0" style="width:100%">
        <div class="ctrl-row"><span class="ctrl-label">Length</span><span class="ctrl-val" id="rigDurVal">2.0 s</span></div>
        <input type="range" id="rigDur" min="0.4" max="12" step="0.1" value="2" style="width:100%">
        <div class="ctrl-row"><span class="ctrl-label">Speed</span><span class="ctrl-val" id="rigSpeedVal">1.0×</span></div>
        <input type="range" id="rigSpeed" min="0.1" max="3" step="0.1" value="1" style="width:100%">
        <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px"><input type="checkbox" id="rigAutoplay" checked> Play in the published viewer</label>
        <button type="button" class="ac-btn full" id="rigRemove" style="margin-top:8px">Remove skeleton</button>
      </div>
    </div>
    <div class="hint" id="rigStatus" role="status" style="margin:8px 10px">Load a splat to start.</div>`;

  const q = (s) => container.querySelector(s);
  const status = (m) => { q('#rigStatus').textContent = m; onStatus?.(m); };

  let rig = null, clip = null, speed = 1, autoplay = true, time = 0;
  let driver = null, overlay = null, bounds = null, selected = 0;
  const manual = {};          // bone → [ex, ey, ez] degrees (upright frame)
  let weightTimer = 0;

  const sparkMesh = () => window.FumocaSparkGaussian?.isEnabled?.() ? window.FumocaSparkGaussian.getMesh?.() : null;
  const manualPose = () => Object.fromEntries(Object.entries(manual).map(([b, e]) => [b, qFromEulerDeg(...e)]));
  const currentPose = () => ({ ...(clip ? sampleClip(clip, time) : {}), ...manualPose() });

  function uprightBounds(rest, frame) {
    const n = rest.count, step = Math.max(1, Math.floor(n / 40000));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i += step) {
      const p = rotVec(frame, [rest.positions[i * 3], rest.positions[i * 3 + 1], rest.positions[i * 3 + 2]]);
      for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
    }
    return { min, max };
  }

  // ── overlay (child of the Spark mesh → same local space as the bones) ──
  function drawOverlay() {
    const mesh = driver?.mesh;
    if (!rig || !mesh || !q('#rigShowBones').checked) { if (overlay) overlay.visible = false; return; }
    if (!overlay) {
      overlay = new THREE.Group(); overlay.name = 'fumoca-rig-overlay';
      const lm = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
      const pm = new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true });
      overlay.add(new THREE.LineSegments(new THREE.BufferGeometry(), lm), new THREE.Points(new THREE.BufferGeometry(), pm));
      overlay.renderOrder = 999; overlay.children.forEach(c => { c.renderOrder = 999; c.frustumCulled = false; });
    }
    if (overlay.parent !== mesh) { overlay.parent?.remove(overlay); mesh.add(overlay); }
    overlay.visible = true;
    const joints = posedJoints(rig, solvePose(rig, poseToLocal(currentPose(), rig.frame)));
    const lp = [], lc = [], pp = [], pc = [];
    joints.forEach((j, i) => {
      const c = i === selected ? [1, 0.85, 0.1] : [0.78, 1, 0];
      lp.push(...j.head, ...j.tail); lc.push(...c, ...c);
      pp.push(...j.head); pc.push(...(i === selected ? [1, 0.3, 0.2] : [1, 1, 1]));
    });
    const [lines, points] = overlay.children;
    lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    points.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
  }

  // Spark rebuilds its mesh after every edit; follow it and keep the pose.
  function ensureDriver({ rebind = false, rest: given = null } = {}) {
    const mesh = sparkMesh();
    if (!mesh || !rig) return null;
    if (driver && driver.mesh === mesh && !rebind) return driver;
    const wasPlaying = driver?.playing;
    if (driver && driver.mesh === mesh) { try { driver.reset(); } catch (_) {} }
    driver?.stop();
    const rest = given || (driver && driver.mesh === mesh ? driver.rest : readRest(mesh));
    if (!rest) return null;
    driver = new SplatRigDriver(THREE, mesh, rig, { rest });
    driver.onFrame = (t) => { time = t % (clip?.duration || 1); syncTime(); drawOverlay(); };
    driver.onError = (e) => status('Playback stopped: ' + (e?.message || e));
    driver.manualPose = manualPose();
    if (clip) driver.setClip(clip, speed);
    driver.time = time;
    if (wasPlaying) driver.play(); else apply();
    return driver;
  }

  function apply() {
    if (!driver) return;
    try { driver.applyPose(currentPose()); } catch (e) { status(e.message); }
    drawOverlay();
  }

  function changed() {
    window.dispatchEvent(new CustomEvent('fumoca:rigChange', { detail: getState() }));
  }

  // ── UI building ──
  function sliderRow(id, label, min, max, step, value, fmt) {
    return `<div class="ctrl-row"><span class="ctrl-label">${label}</span><span class="ctrl-val" id="${id}Val">${fmt(value)}</span></div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%">`;
  }

  function renderBoneControls() {
    if (!rig) return;
    const bone = rig.bones[selected];
    const head = rotVec(rig.frame, bone.head);
    const span = [0, 1, 2].map(k => (bounds.max[k] - bounds.min[k]) || 1);
    q('#rigJoint').innerHTML = ['X', 'Y', 'Z'].map((a, k) => sliderRow('rigJ' + a, a, (bounds.min[k] - span[k] * 0.1).toFixed(4), (bounds.max[k] + span[k] * 0.1).toFixed(4), (span[k] / 400).toFixed(5), head[k].toFixed(4), v => (+v).toFixed(3))).join('');
    const e = manual[bone.name] || [0, 0, 0];
    q('#rigPose').innerHTML = [['X', 'tilt'], ['Y', 'turn'], ['Z', 'swing']].map(([a, l], k) => sliderRow('rigP' + a, `${a} · ${l}`, -180, 180, 1, e[k], v => Math.round(v) + '°')).join('');
    ['X', 'Y', 'Z'].forEach((a, k) => {
      q('#rigJ' + a).addEventListener('input', (ev) => moveJoint(k, +ev.target.value));
      q('#rigP' + a).addEventListener('input', (ev) => {
        const cur = manual[bone.name] || [0, 0, 0];
        cur[k] = +ev.target.value; manual[bone.name] = cur;
        q('#rigP' + a + 'Val').textContent = Math.round(cur[k]) + '°';
        if (driver) { driver.manualPose = manualPose(); if (!driver.playing) apply(); }
      });
    });
  }

  function renderAll() {
    const on = !!rig;
    q('#rigBonesSection').style.display = on ? '' : 'none';
    q('#rigMotionSection').style.display = on ? '' : 'none';
    q('#rigFit').textContent = on ? 'Refit skeleton' : 'Add skeleton';
    if (!on) return;
    q('#rigBone').innerHTML = rig.bones.map((b, i) => `<option value="${i}"${i === selected ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
    const presets = PRESETS_FOR[rig.template] || ['spin'];
    q('#rigPreset').innerHTML = presets.map(p => `<option value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join('');
    q('#rigSpeed').value = speed; q('#rigSpeedVal').textContent = speed.toFixed(1) + '×';
    q('#rigAutoplay').checked = autoplay;
    syncDuration();
    renderBoneControls();
  }

  function syncTime() {
    q('#rigTime').value = time; q('#rigTimeVal').textContent = time.toFixed(2) + ' s';
  }
  function syncDuration() {
    const d = clip?.duration || +q('#rigDur').value || 2;
    q('#rigDur').value = d; q('#rigDurVal').textContent = d.toFixed(1) + ' s'; q('#rigTime').max = d;
    q('#rigPlay').disabled = !clip;
  }

  // Move every bone end that sits on the selected joint, so connected bones stay connected.
  function moveJoint(axis, value) {
    const bone = rig.bones[selected];
    const old = bone.head.slice();
    const up = rotVec(rig.frame, old); up[axis] = value;
    const next = rotVec(conj(rig.frame), up);
    const same = (p) => Math.abs(p[0] - old[0]) + Math.abs(p[1] - old[1]) + Math.abs(p[2] - old[2]) < EPS * 10;
    for (const b of rig.bones) { if (same(b.head)) b.head = next.slice(); if (same(b.tail)) b.tail = next.slice(); }
    q('#rigJ' + 'XYZ'[axis] + 'Val').textContent = value.toFixed(3);
    drawOverlay();
    clearTimeout(weightTimer);
    weightTimer = setTimeout(() => { ensureDriver({ rebind: true }); changed(); status('Skin updated.'); }, 300);
  }

  // ── actions ──
  function fit() {
    const mesh = sparkMesh();
    if (!mesh) { status('Turn on Photoreal (Spark) first — the rig moves the photoreal splats.'); return; }
    const rest = readRest(mesh);
    if (!rest) { status('The splat is still loading. Try again in a moment.'); return; }
    driver?.reset(); driver = null;
    const frame = uprightFrame(THREE, mesh);
    rig = fitTemplate(q('#rigTemplate').value, rest, frame);
    bounds = uprightBounds(rest, frame);
    clip = null; time = 0; selected = 0;
    for (const k of Object.keys(manual)) delete manual[k];
    const t0 = performance.now();
    ensureDriver({ rest });
    renderAll(); apply(); changed();
    status(`Skeleton added: ${rig.bones.length} bones, ${rest.count.toLocaleString()} splats skinned in ${Math.round(performance.now() - t0)} ms. Drag the joint sliders to line the bones up with the body.`);
  }

  function togglePlay() {
    const d = ensureDriver();
    if (!d || !clip) return;
    if (d.playing) { d.stop(); q('#rigPlay').textContent = '▶ Play'; status('Paused.'); return; }
    d.setClip(clip, speed); d.time = time; d.manualPose = manualPose(); d.play();
    q('#rigPlay').textContent = '❚❚ Pause';
    status(d.lastFrameMs > 30 ? 'Playing (large scan — frames are skipped to stay smooth).' : 'Playing.');
  }

  function addKey() {
    if (!rig) return;
    const duration = clip?.duration || +q('#rigDur').value || 2;
    const base = clip || { name: 'Custom', duration, loop: true, tracks: {} };
    const pose = currentPose();
    const tracks = { ...base.tracks };
    const bones = new Set([...Object.keys(manual), ...Object.keys(tracks)]);
    if (!bones.size) { status('Pose a bone first, then add a key.'); return; }
    for (const name of bones) {
      const keys = (tracks[name] || []).filter(k => Math.abs(k.t - time) > 1e-3);
      if (!keys.length && time > 0) keys.push({ t: 0, q: qIdentity(), ease: 'ease-in-out' });
      keys.push({ t: time, q: pose[name] || qIdentity(), ease: 'ease-in-out' });
      tracks[name] = keys;
    }
    clip = normalizeClip({ ...base, name: base.name === 'Custom' ? 'Custom' : base.name + ' (edited)', tracks }, rig);
    for (const k of Object.keys(manual)) delete manual[k];
    if (driver) { driver.manualPose = {}; driver.setClip(clip, speed); }
    renderAll(); apply(); changed();
    status(`Key added at ${time.toFixed(2)} s.`);
  }

  q('#rigFit').addEventListener('click', fit);
  q('#rigShowBones').addEventListener('change', drawOverlay);
  q('#rigBone').addEventListener('change', (e) => { selected = +e.target.value; renderBoneControls(); drawOverlay(); });
  q('#rigResetBone').addEventListener('click', () => { delete manual[rig.bones[selected].name]; renderBoneControls(); if (driver) driver.manualPose = manualPose(); apply(); });
  q('#rigResetAll').addEventListener('click', () => { for (const k of Object.keys(manual)) delete manual[k]; renderBoneControls(); if (driver) driver.manualPose = {}; apply(); });
  q('#rigUsePreset').addEventListener('click', () => {
    clip = normalizeClip(presetClip(q('#rigPreset').value, rig), rig);
    time = 0; for (const k of Object.keys(manual)) delete manual[k];
    renderAll(); ensureDriver(); driver?.setClip(clip, speed);
    if (!driver?.playing) togglePlay();
    changed();
  });
  q('#rigPlay').addEventListener('click', togglePlay);
  q('#rigKey').addEventListener('click', addKey);
  q('#rigClear').addEventListener('click', () => {
    driver?.stop(); clip = null; time = 0; q('#rigPlay').textContent = '▶ Play';
    renderAll(); apply(); changed(); status('Motion cleared.');
  });
  q('#rigTime').addEventListener('input', (e) => { time = +e.target.value; if (driver) driver.time = time; syncTime(); if (!driver?.playing) apply(); });
  q('#rigDur').addEventListener('input', (e) => {
    const d = +e.target.value; q('#rigDurVal').textContent = d.toFixed(1) + ' s';
    if (clip) {
      const f = d / clip.duration;
      clip = normalizeClip({ ...clip, duration: d, tracks: Object.fromEntries(Object.entries(clip.tracks).map(([b, ks]) => [b, ks.map(k => ({ ...k, t: k.t * f }))])) }, rig);
      driver?.setClip(clip, speed); time = Math.min(time, d);
    }
    q('#rigTime').max = d; syncTime();
  });
  q('#rigDur').addEventListener('change', changed);
  q('#rigSpeed').addEventListener('input', (e) => { speed = +e.target.value; q('#rigSpeedVal').textContent = speed.toFixed(1) + '×'; if (driver) driver.speed = speed; });
  q('#rigSpeed').addEventListener('change', changed);
  q('#rigAutoplay').addEventListener('change', (e) => { autoplay = e.target.checked; changed(); });
  q('#rigRemove').addEventListener('click', () => {
    driver?.reset(); driver = null; rig = null; clip = null;
    overlay?.parent?.remove(overlay); overlay = null;
    renderAll(); changed(); status('Skeleton removed; the splat is back to its original shape.');
  });

  // Follow Spark mesh swaps (edits rebuild the mesh).
  const follow = setInterval(() => {
    if (!rig) return;
    const mesh = sparkMesh();
    if (mesh && driver && mesh !== driver.mesh && mesh.initialized !== undefined) {
      Promise.resolve(mesh.initialized).then(() => { try { ensureDriver(); status('Rig re-attached after edit.'); } catch (e) { status(e.message); } });
    }
  }, 700);

  // ── persistence ──
  function getState() {
    if (!rig) return null;
    return { version: 1, rig: { ...rig, bones: rig.bones.map(b => ({ ...b })) }, clip, speed, autoplay, splatCount: driver?.rest?.count ?? null };
  }

  async function setState(saved) {
    const st = normalizeRigState(saved);
    if (!st) return false;
    const mesh = sparkMesh();
    if (!mesh) { status('A skeleton is saved with this splat — turn on Photoreal to see it move.'); return false; }
    if (mesh.initialized) await mesh.initialized;
    const rest = readRest(mesh);
    if (!rest) return false;
    driver?.reset(); driver = null;
    rig = st.rig; clip = st.clip; speed = st.speed; autoplay = st.clip ? st.autoplay : true; time = 0; selected = 0;
    bounds = uprightBounds(rest, rig.frame);
    ensureDriver({ rest });
    renderAll(); apply();
    status(`Skeleton restored (${rig.bones.length} bones${clip ? ', motion: ' + clip.name : ''}).`);
    return true;
  }

  window.addEventListener('fumoca:fileLoaded', () => {
    driver?.stop(); driver = null; rig = null; clip = null; overlay?.parent?.remove(overlay); overlay = null; renderAll();
    const saved = window._fumocaCurrentRecord?.meta?.present?.rig;
    if (saved) {
      let tries = 0;
      const attempt = () => setState(saved).then(ok => { if (!ok && ++tries < 10 && !rig) setTimeout(attempt, 1500); }).catch(e => status(e.message));
      setTimeout(attempt, 1500);
    }
    else status('Pick a body type and add a skeleton.');
  });

  const api = { getState, setState, fit, get driver() { return driver; }, dispose() { clearInterval(follow); driver?.dispose(); } };
  window.FumocaRig = api;
  return api;
}
