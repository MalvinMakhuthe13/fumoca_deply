/**
 * FUMOCA Studio Initialization Bridge
 * Binds FumocaMaster to the existing Studio camera and OrbitControls.
 * One authoritative playback clock. Safe retry. No duplicate init.
 */
const FumocaStudioInit = (() => {
  let _master = null;
  let _initialized = false;
  let _cameraBound = false;
  let _retryTimer = null;

  function _getCamera() {
    return window._fumocaViewerCamera || window._fumocaViewer?.camera || null;
  }
  function _getControls() {
    return window._fumocaViewerControls || window._fumocaViewer?.controls || null;
  }

  function init() {
    if (_initialized) return { ok: true, already: true };
    _master = window.FumocaMaster;
    if (!_master) return { ok: false, reason: 'master_missing' };

    const cam = _getCamera();
    const ctrls = _getControls();
    if (!cam || !ctrls) {
      if (!_retryTimer) {
        _retryTimer = setTimeout(() => { _retryTimer = null; init(); }, 250);
      }
      function registerArticulatedObject(obj, componentMap) {
      const master = window.FumocaMaster;
      if (!master) return { ok: false, reason: 'master_missing' };
      if (!obj?.id || !obj.components) return { ok: false, reason: 'invalid_object' };
      const ids = new Set(obj.components.map(c => c.id));
      for (const c of obj.components) {
        if (c.parentId && !ids.has(c.parentId)) return { ok: false, reason: 'unknown_parent', componentId: c.id };
      }
      master.addObject(obj);
      master.setObjectBinding(obj.id, componentMap);
      const missing = obj.components.filter(c => !componentMap?.get?.(c.id)).map(c => c.id);
      return { ok: missing.length === 0, bound: obj.components.length - missing.length, missing };
    }

  return { ok: false, reason: 'camera_not_ready', retrying: true };
    }

    _master.setCameraBinding(cam, ctrls);
    _cameraBound = true;
    if (window.FumocaPhysics?.initRapier) {
      window.FumocaPhysics.initRapier().then(r => {
        if (!r.ok) console.warn('[StudioInit] Rapier unavailable, using reference backend:', r.error);
      });
    }

    const states = window.Fumoca4D?.getStates?.() || [];
    if (states.length) {
      _master.setCameraTrack(states);
      const last = states[states.length - 1];
      _master.setDuration(Math.max(0.1, last.time_offset || 10));
    }

    _initialized = true;
    window._fumocaMasterOwnsPlayback = true;
    console.log('[StudioInit] Bound to camera and controls');
    function registerArticulatedObject(obj, componentMap) {
      const master = window.FumocaMaster;
      if (!master) return { ok: false, reason: 'master_missing' };
      if (!obj?.id || !obj.components) return { ok: false, reason: 'invalid_object' };
      const ids = new Set(obj.components.map(c => c.id));
      for (const c of obj.components) {
        if (c.parentId && !ids.has(c.parentId)) return { ok: false, reason: 'unknown_parent', componentId: c.id };
      }
      master.addObject(obj);
      master.setObjectBinding(obj.id, componentMap);
      const missing = obj.components.filter(c => !componentMap?.get?.(c.id)).map(c => c.id);
      return { ok: missing.length === 0, bound: obj.components.length - missing.length, missing };
    }

  return { ok: true, cameraBound: true };
  }

  function destroy() {
    if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
    if (window.FumocaPhysics?.dispose) window.FumocaPhysics.dispose();
    if (_master) _master.pause();
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = true;
    _initialized = false;
    _cameraBound = false;
    _master = null;
    window._fumocaMasterOwnsPlayback = false;
  }

  function play() {
    if (!_initialized) init();
    if (!_master || !_cameraBound) return false;
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = false;
    window._fumocaMasterOwnsPlayback = true;
    _master.play();
    return true;
  }

  function pause() {
    if (!_master) return;
    _master.pause();
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = true;
  }

  function stop() {
    if (!_master) return;
    _master.stop();
    const ctrls = _getControls();
    if (ctrls) ctrls.enabled = true;
  }

  function scrub(time) {
    if (!_master) return null;
    return _master.evaluate(time);
  }

  function getTime() { return _master?.getTime?.() ?? 0; }
  function isPlaying() { return _master?.isPlaying?.() ?? false; }
  function isCameraBound() { return _cameraBound; }

  function registerArticulatedObject(obj, componentMap) {
      const master = window.FumocaMaster;
      if (!master) return { ok: false, reason: 'master_missing' };
      if (!obj?.id || !obj.components) return { ok: false, reason: 'invalid_object' };
      const ids = new Set(obj.components.map(c => c.id));
      for (const c of obj.components) {
        if (c.parentId && !ids.has(c.parentId)) return { ok: false, reason: 'unknown_parent', componentId: c.id };
      }
      master.addObject(obj);
      master.setObjectBinding(obj.id, componentMap);
      const missing = obj.components.filter(c => !componentMap?.get?.(c.id)).map(c => c.id);
      return { ok: missing.length === 0, bound: obj.components.length - missing.length, missing };
    }

  return {
      init, destroy, play, pause, stop, scrub, registerArticulatedObject,
    getTime, isPlaying, isCameraBound,
    isInitialized: () => _initialized,
  };
})();

window.FumocaStudioInit = FumocaStudioInit;
export default FumocaStudioInit;
