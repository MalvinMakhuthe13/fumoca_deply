/**
 * FUMOCA 4D Gaussian Blending Engine v62
 * Full camera pose capture + real playback interpolation + clean loop.
 * Backward compatible with legacy viewport_anchor-only keyframes.
 */
const Fumoca4D = (() => {
  const S = {
    active: false,
    states: [],
    startTime: 0,
    audioCtx: null,
    panner: null,
    audioEl: null,
    renderer: null,
    record: null,
    paused: false,
    pauseOffset: 0,
  };

  function _getCamera() {
    return window._fumocaViewerCamera || window._fumocaViewer?.camera || null;
  }
  function _getControls() {
    return window._fumocaViewerControls || window._fumocaViewer?.controls || null;
  }
  function _vec3(obj) {
    if (!obj) return null;
    return { x: Number(obj.x) || 0, y: Number(obj.y) || 0, z: Number(obj.z) || 0 };
  }
  function _quat(obj) {
    if (!obj) return null;
    return { x: Number(obj.x) || 0, y: Number(obj.y) || 0, z: Number(obj.z) || 0, w: Number(obj.w) || 1 };
  }

  function _captureCurrentPose() {
    const cam = _getCamera();
    const ctrls = _getControls();
    if (!cam) return null;
    try { cam.updateMatrixWorld?.(true); } catch (_) {}
    try { ctrls?.update?.(); } catch (_) {}
    return {
      version: 1,
      position: _vec3(cam.position),
      quaternion: _quat(cam.quaternion),
      target: _vec3(ctrls?.target) || _vec3(cam.position),
      fov: Number(cam.fov) || 60,
      zoom: Number(cam.zoom) || 1,
    };
  }

  function getPoseFromState(state) {
    if (!state) return null;
    const va = state.viewport_anchor || {};
    if (va.pose && va.pose.version >= 1 && va.pose.position) return va.pose;
    if (va.wx != null || va.wy != null || va.wz != null) {
      const pt = { x: Number(va.wx) || 0, y: Number(va.wy) || 0, z: Number(va.wz) || 0 };
      return { version: 0, position: pt, quaternion: null, target: pt, fov: 60, zoom: 1, legacy: true };
    }
    return null;
  }

  function _lerpVec(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  function _slerpQuat(q1, q2, t) {
    if (window.THREE && window.THREE.Quaternion) {
      const qa = new THREE.Quaternion(q1.x, q1.y, q1.z, q1.w);
      const qb = new THREE.Quaternion(q2.x, q2.y, q2.z, q2.w);
      const out = new THREE.Quaternion();
      out.slerpQuaternions(qa, qb, t);
      return { x: out.x, y: out.y, z: out.z, w: out.w };
    }
    let x = q1.x + (q2.x - q1.x) * t;
    let y = q1.y + (q2.y - q1.y) * t;
    let z = q1.z + (q2.z - q1.z) * t;
    let w = q1.w + (q2.w - q1.w) * t;
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  }

  async function init(splatRecord, rendererInstance) {
    S.record = splatRecord;
    S.renderer = rendererInstance;
    const sb = window._fumocaSupabase;
    if (!sb || !splatRecord?.id) return false;

    let states = null;
    try {
      const { data, error } = await sb.from('splat_motion_states').select('*').eq('splat_id', splatRecord.id).order('time_offset', { ascending: true });
      if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.info('[4D] splat_motion_states not found');
        return false;
      }
      states = data;
    } catch (e) {
      console.info('[4D] Motion states unavailable:', e.message);
      return false;
    }

    if (!states || states.length < 2) {
      console.log('[4D] Fewer than 2 motion states — 3D mode');
      S.states = states || [];
      return false;
    }

    S.states = states;
    S.active = true;
    S.paused = false;
    S.pauseOffset = 0;
    S.startTime = performance.now();
    console.log(`%c[4D] Activated — ${states.length} keyframes`, 'color:#c8ff00;font-weight:800');
    requestAnimationFrame(_blendLoop);
    if (splatRecord.ambient_audio_url) _initSpatialAudio(splatRecord);
    window.dispatchEvent(new CustomEvent('fumoca:4dActivated', { detail: { splatId: splatRecord.id, states: states.length } }));
    return true;
  }

  function _blendLoop(ts) {
    if (!S.active || S.paused) return;
    if (!S.states.length) return;

    const now = ts - S.pauseOffset;
    const elapsed = (now - S.startTime) / 1000;
    const last = S.states[S.states.length - 1];
    const totalDur = Math.max(0.001, last.time_offset || 1);
    const loopTime = elapsed % totalDur;

    let idx1 = 0, idx2 = 1, span = 1, localT = 0;

    if (S.states.length === 1) {
      idx1 = idx2 = 0;
      localT = 0;
    } else {
      let found = false;
      for (let i = 0; i < S.states.length - 1; i++) {
        const t1 = S.states[i].time_offset || 0;
        const t2 = S.states[i + 1].time_offset || 0;
        if (loopTime >= t1 && loopTime <= t2) {
          idx1 = i; idx2 = i + 1;
          span = Math.max(0.001, t2 - t1);
          localT = (loopTime - t1) / span;
          found = true;
          break;
        }
      }
      if (!found) {
        idx1 = S.states.length - 1;
        idx2 = 0;
        const t1 = last.time_offset || 0;
        const gap = Math.max(0.001, totalDur - t1 + (S.states[0].time_offset || 0));
        span = gap;
        localT = Math.max(0, Math.min(1, (loopTime - t1) / span));
      }
    }

    const kf1 = S.states[idx1];
    const kf2 = S.states[idx2];
    const t = 0.5 - 0.5 * Math.cos(Math.max(0, Math.min(1, localT)) * Math.PI);

    if (kf1.viewport_anchor && kf2.viewport_anchor) {
      const va1 = kf1.viewport_anchor, va2 = kf2.viewport_anchor;
      const bx = (va1.x || 50) + ((va2.x || 50) - (va1.x || 50)) * t;
      const by = (va1.y || 42) + ((va2.y || 42) - (va1.y || 42)) * t;
      document.documentElement.style.setProperty('--focus-x', `${bx.toFixed(2)}%`);
      document.documentElement.style.setProperty('--focus-y', `${by.toFixed(2)}%`);
    }

    const pose1 = getPoseFromState(kf1);
    const pose2 = getPoseFromState(kf2);
    const cam = _getCamera();
    const ctrls = _getControls();

    if (cam && pose1 && pose2 && pose1.position && pose2.position) {
      const pos = _lerpVec(pose1.position, pose2.position, t);
      cam.position.set(pos.x, pos.y, pos.z);
      if (ctrls?.target && pose1.target && pose2.target) {
        const tgt = _lerpVec(pose1.target, pose2.target, t);
        ctrls.target.set(tgt.x, tgt.y, tgt.z);
        ctrls.update();
      }
      if (pose1.quaternion && pose2.quaternion) {
        const q = _slerpQuat(pose1.quaternion, pose2.quaternion, t);
        cam.quaternion.set(q.x, q.y, q.z, q.w);
      }
      if (Number.isFinite(pose1.fov) && Number.isFinite(pose2.fov)) cam.fov = pose1.fov + (pose2.fov - pose1.fov) * t;
      if (Number.isFinite(pose1.zoom) && Number.isFinite(pose2.zoom)) cam.zoom = pose1.zoom + (pose2.zoom - pose1.zoom) * t;
      cam.updateProjectionMatrix?.();
    }

    if (S.renderer && typeof S.renderer.updateGaussians === 'function' && kf1.pose_data && kf2.pose_data) {
      const g1 = kf1.pose_data, g2 = kf2.pose_data;
      if (Array.isArray(g1) && Array.isArray(g2) && g1.length === g2.length) {
        S.renderer.updateGaussians(g1.map((v, i) => v + (g2[i] - v) * t));
      }
    }

    if (S.panner) _updateSpatialAudio();
    requestAnimationFrame(_blendLoop);
  }

  function _initSpatialAudio(record) {
    try {
      S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      S.audioEl = new Audio(record.ambient_audio_url);
      S.audioEl.loop = record.ambient_audio_loop !== false;
      S.audioEl.volume = record.ambient_audio_volume || 0.35;
      const src = S.audioCtx.createMediaElementSource(S.audioEl);
      S.panner = S.audioCtx.createPanner();
      S.panner.panningModel = 'HRTF';
      S.panner.distanceModel = 'inverse';
      S.panner.refDistance = 1;
      S.panner.maxDistance = 50;
      src.connect(S.panner).connect(S.audioCtx.destination);
      S.audioEl.play().catch(() => {});
    } catch (e) {
      console.warn('[4D] Spatial audio init failed:', e);
    }
  }

  function _updateSpatialAudio() {
    const cam = _getCamera();
    if (!cam || !S.panner) return;
    try {
      S.panner.positionX.value = cam.position.x;
      S.panner.positionY.value = cam.position.y;
      S.panner.positionZ.value = cam.position.z;
    } catch (_) {}
  }

  async function captureKeyframe(label) {
    if (!S.record?.id) return null;
    const sb = window._fumocaSupabase;
    const cam = _getCamera();
    const ctrls = _getControls();
    const timeOff = S.states.length ? (S.states[S.states.length - 1].time_offset || 0) + 2.0 : 0;
    const pose = _captureCurrentPose();
    const anchor = {
      x: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-x')) || 50,
      y: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-y')) || 42,
      wx: ctrls?.target?.x ?? cam?.position?.x ?? 0,
      wy: ctrls?.target?.y ?? cam?.position?.y ?? 0,
      wz: ctrls?.target?.z ?? cam?.position?.z ?? 0,
    };
    if (pose) anchor.pose = pose;

    const { data, error } = await sb.from('splat_motion_states').insert({
      splat_id: S.record.id,
      step_label: label || `Keyframe ${S.states.length + 1}`,
      time_offset: timeOff,
      viewport_anchor: anchor,
      pose_data: null,
    }).select().single();

    if (error) { console.error('[4D] Keyframe save failed:', error); return null; }
    S.states.push(data);
    await sb.from('nif_files').update({ meta: { ...(S.record.meta || {}), has_4d: true } }).eq('id', S.record.id);
    return data;
  }

  async function updateKeyframePose(index) {
    const st = S.states[index];
    if (!st?.id || !window._fumocaSupabase) return null;
    const pose = _captureCurrentPose();
    if (!pose) return null;
    const va = { ...(st.viewport_anchor || {}), pose };
    const { data, error } = await window._fumocaSupabase.from('splat_motion_states').update({ viewport_anchor: va }).eq('id', st.id).select().single();
    if (error) return null;
    S.states[index] = data;
    return data;
  }

  async function renameKeyframe(index, newLabel) {
    const st = S.states[index];
    if (!st?.id || !newLabel) return null;
    const { data, error } = await window._fumocaSupabase.from('splat_motion_states').update({ step_label: newLabel }).eq('id', st.id).select().single();
    if (error) return null;
    S.states[index] = data;
    return data;
  }

  async function setKeyframeTime(index, timeOffset) {
    const st = S.states[index];
    if (!st?.id || !Number.isFinite(timeOffset)) return null;
    const { data, error } = await window._fumocaSupabase.from('splat_motion_states').update({ time_offset: Math.max(0, timeOffset) }).eq('id', st.id).select().single();
    if (error) return null;
    S.states[index] = data;
    S.states.sort((a, b) => (a.time_offset || 0) - (b.time_offset || 0));
    return data;
  }

  async function deleteKeyframe(index) {
    const st = S.states[index];
    if (!st?.id) return false;
    const { error } = await window._fumocaSupabase.from('splat_motion_states').delete().eq('id', st.id);
    if (error) return false;
    S.states.splice(index, 1);
    return true;
  }

  async function autoGenerateFromVideo(record) {
    const MT = window.FumocaMotionTracking || window._fumocaMotionTracking;
    if (!MT?.autoGenerateAndSaveSteps) return null;
    const result = await MT.autoGenerateAndSaveSteps(record);
    if (result?.steps) S.states = result.steps;
    return result;
  }

  function toggle4D() {
    S.active = !S.active;
    if (S.active) { S.paused = false; S.startTime = performance.now() - S.pauseOffset; requestAnimationFrame(_blendLoop); }
  }
  function pause() { if (S.active && !S.paused) { S.paused = true; S.pauseOffset = performance.now() - S.startTime; } }
  function resume() { if (S.active && S.paused) { S.paused = false; S.startTime = performance.now() - S.pauseOffset; requestAnimationFrame(_blendLoop); } }
  function restart() { S.pauseOffset = 0; S.startTime = performance.now(); S.paused = false; S.active = true; requestAnimationFrame(_blendLoop); }
  function stop() { S.active = false; S.paused = false; S.pauseOffset = 0; }

  return {
    init, captureKeyframe, autoGenerateFromVideo, getPoseFromState,
    updateKeyframePose, renameKeyframe, setKeyframeTime, deleteKeyframe,
    toggle4D, pause, resume, restart, stop,
    isActive: () => S.active && !S.paused,
    getStates: () => S.states.slice(),
    dispose: () => { S.active = false; S.audioEl?.pause(); S.audioCtx?.close(); },
  };
})();

window.Fumoca4D = Fumoca4D;
export default Fumoca4D;
