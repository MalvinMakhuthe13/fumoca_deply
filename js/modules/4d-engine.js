/**
 * FUMOCA 4D Gaussian Blending Engine v61
 * ═════════════════════════════════════════════════════════════════
 * Real temporal interpolation between Gaussian motion states.
 * Works with any splat loaded in the existing FUMOCA viewer.
 *
 * Features:
 *   - Full camera pose capture (position, quaternion, target, fov, zoom)
 *   - Backward-compatible viewport_anchor storage
 *   - Smooth sine-eased interpolation
 *   - Spatial HRTF audio that follows the camera
 *   - Capture current pose as a keyframe
 *   - Plugs into the existing motion_states table
 * ═════════════════════════════════════════════════════════════════
 */

const Fumoca4D = (() => {

  // ── State ───────────────────────────────────────────────────────────
  const S = {
    active:      false,
    states:      [],      // from splat_motion_states table
    startTime:   0,
    audioCtx:    null,
    panner:      null,
    audioEl:     null,
    renderer:    null,
    record:      null,
  };

  // ── Helpers ─────────────────────────────────────────────────────────
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
    return {
      x: Number(obj.x) || 0,
      y: Number(obj.y) || 0,
      z: Number(obj.z) || 0,
      w: Number(obj.w) || 1
    };
  }

  /**
   * Capture the live camera + OrbitControls pose.
   * Returns a versioned pose object or null if no camera is available.
   */
  function _captureCurrentPose() {
    const cam = _getCamera();
    const ctrls = _getControls();
    if (!cam) return null;

    // Ensure matrices are current
    try { cam.updateMatrixWorld?.(true); } catch (_) {}
    try { ctrls?.update?.(); } catch (_) {}

    return {
      version: 1,
      position: _vec3(cam.position),
      quaternion: _quat(cam.quaternion),
      target: _vec3(ctrls?.target) || _vec3(cam.position),
      fov: Number(cam.fov) || 60,
      zoom: Number(cam.zoom) || 1
    };
  }

  /**
   * Extract a usable pose from a stored keyframe (new or legacy).
   * Legacy records only have viewport_anchor.wx/wy/wz.
   */
  function getPoseFromState(state) {
    if (!state) return null;
    const va = state.viewport_anchor || {};
    if (va.pose && va.pose.version >= 1 && va.pose.position) {
      return va.pose;
    }
    // Legacy fallback: treat the stored world point as both position and target
    if (va.wx != null || va.wy != null || va.wz != null) {
      const pt = { x: Number(va.wx) || 0, y: Number(va.wy) || 0, z: Number(va.wz) || 0 };
      return {
        version: 0,
        position: pt,
        quaternion: null,
        target: pt,
        fov: 60,
        zoom: 1,
        legacy: true
      };
    }
    return null;
  }

  // ── Init ─────────────────────────────────────────────────────────────
  async function init(splatRecord, rendererInstance) {
    S.record   = splatRecord;
    S.renderer = rendererInstance;

    const sb = window._fumocaSupabase;
    if (!sb || !splatRecord?.id) return false;

    let states = null;
    try {
      const { data, error } = await sb
        .from('splat_motion_states')
        .select('*')
        .eq('splat_id', splatRecord.id)
        .order('time_offset', { ascending: true });
      if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
        console.info('[4D] splat_motion_states not found — run V68_FULL_SCHEMA.sql');
        return false;
      }
      states = data;
    } catch(e) {
      console.info('[4D] Motion states unavailable:', e.message);
      return false;
    }

    if (!states || states.length < 2) {
      console.log('[4D] No motion states — staying in 3D mode');
      return false;
    }

    S.states    = states;
    S.active    = true;
    S.startTime = performance.now();

    console.log(`%c[4D] Activated — ${states.length} keyframes`, 'color:#c8ff00;font-weight:800');

    requestAnimationFrame(_blendLoop);

    if (splatRecord.ambient_audio_url) _initSpatialAudio(splatRecord);

    window.dispatchEvent(new CustomEvent('fumoca:4dActivated', {
      detail: { splatId: splatRecord.id, states: states.length }
    }));

    return true;
  }

  // ── Blend loop ────────────────────────────────────────────────────────
  function _blendLoop(ts) {
    if (!S.active) return;

    const elapsed   = (ts - S.startTime) / 1000;
    const totalDur  = S.states[S.states.length - 1].time_offset || 1;
    const loopTime  = elapsed % totalDur;

    // Find surrounding keyframes
    let idx1 = 0, idx2 = 1;
    for (let i = 0; i < S.states.length - 1; i++) {
      if (loopTime >= S.states[i].time_offset && loopTime <= S.states[i + 1].time_offset) {
        idx1 = i; idx2 = i + 1; break;
      }
    }

    const kf1 = S.states[idx1];
    const kf2 = S.states[idx2];
    const span = (kf2.time_offset - kf1.time_offset) || 1;
    const tRaw = (loopTime - kf1.time_offset) / span;
    const t    = 0.5 - 0.5 * Math.cos(tRaw * Math.PI); // sine ease

    // Push viewport anchor blend to camera controls (legacy CSS focus)
    if (kf1.viewport_anchor && kf2.viewport_anchor) {
      const va1 = kf1.viewport_anchor;
      const va2 = kf2.viewport_anchor;
      const blendedX = (va1.x || 50) + ((va2.x || 50) - (va1.x || 50)) * t;
      const blendedY = (va1.y || 42) + ((va2.y || 42) - (va1.y || 42)) * t;
      document.documentElement.style.setProperty('--focus-x', `${blendedX.toFixed(2)}%`);
      document.documentElement.style.setProperty('--focus-y', `${blendedY.toFixed(2)}%`);
    }

    // If renderer exposes updateGaussians, use it (advanced integration)
    if (S.renderer && typeof S.renderer.updateGaussians === 'function' &&
        kf1.pose_data && kf2.pose_data) {
      const g1 = kf1.pose_data;
      const g2 = kf2.pose_data;
      if (Array.isArray(g1) && Array.isArray(g2) && g1.length === g2.length) {
        const blended = g1.map((v, i) => v + (g2[i] - v) * t);
        S.renderer.updateGaussians(blended);
      }
    }

    if (S.panner) _updateSpatialAudio();

    requestAnimationFrame(_blendLoop);
  }

  // ── Spatial audio ────────────────────────────────────────────────────────
  function _initSpatialAudio(record) {
    try {
      S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      S.audioEl  = new Audio(record.ambient_audio_url);
      S.audioEl.loop   = record.ambient_audio_loop !== false;
      S.audioEl.volume = record.ambient_audio_volume || 0.35;
      const src = S.audioCtx.createMediaElementSource(S.audioEl);
      S.panner  = S.audioCtx.createPanner();
      S.panner.panningModel  = 'HRTF';
      S.panner.distanceModel = 'inverse';
      S.panner.refDistance   = 1;
      S.panner.maxDistance   = 50;
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

  // ── Capture current pose as a new keyframe ─────────────────────
  async function captureKeyframe(label) {
    if (!S.record?.id) return null;

    const sb      = window._fumocaSupabase;
    const cam     = _getCamera();
    const ctrls   = _getControls();
    const timeOff = S.states.length
      ? (S.states[S.states.length - 1].time_offset || 0) + 2.0
      : 0;

    const pose = _captureCurrentPose();

    const anchor = {
      x: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-x')) || 50,
      y: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--focus-y')) || 42,
      wx: ctrls?.target?.x ?? cam?.position?.x ?? 0,
      wy: ctrls?.target?.y ?? cam?.position?.y ?? 0,
      wz: ctrls?.target?.z ?? cam?.position?.z ?? 0,
    };

    // Store full camera pose inside viewport_anchor for backward compatibility.
    // Old keyframes simply lack the .pose field and continue to work.
    if (pose) {
      anchor.pose = pose;
    }

    const { data, error } = await sb.from('splat_motion_states').insert({
      splat_id:        S.record.id,
      step_label:      label || `Keyframe ${S.states.length + 1}`,
      time_offset:     timeOff,
      viewport_anchor: anchor,
      pose_data:       null, // reserved for future Gaussian temporal states
    }).select().single();

    if (error) { console.error('[4D] Keyframe save failed:', error); return null; }
    S.states.push(data);
    console.log(`%c[4D] Keyframe "${data.step_label}" saved at t=${timeOff}s (pose v${pose?.version || 0})`, 'color:#c8ff00');

    // Mark splat as having 4D data
    await sb.from('nif_files')
      .update({ meta: { ...(S.record.meta || {}), has_4d: true } })
      .eq('id', S.record.id);

    return data;
  }

  // ── Auto-generate from motion tracking ─────────────────────────
  async function autoGenerateFromVideo(record) {
    const MT = window.FumocaMotionTracking || window._fumocaMotionTracking;
    if (!MT?.autoGenerateAndSaveSteps) {
      console.warn('[4D] FumocaMotionTracking not available');
      return null;
    }
    const result = await MT.autoGenerateAndSaveSteps(record);
    if (result?.steps) {
      S.states = result.steps;
      console.log(`%c[4D] Auto-generated ${result.steps.length} keyframes`, 'color:#c8ff00;font-weight:800');
    }
    return result;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  return {
    init,
    captureKeyframe,
    autoGenerateFromVideo,
    getPoseFromState,
    toggle4D:  () => { S.active = !S.active; if (S.active) { S.startTime = performance.now(); requestAnimationFrame(_blendLoop); } },
    isActive:  () => S.active,
    getStates: () => S.states.slice(),
    dispose:   () => { S.active = false; S.audioEl?.pause(); S.audioCtx?.close(); },
  };

})();

window.Fumoca4D = Fumoca4D;
export default Fumoca4D;
