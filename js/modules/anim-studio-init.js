/**
 * FUMOCA Studio Initialization Bridge
 * Binds FumocaMaster to the existing Studio camera, OrbitControls, and timeline.
 * One authoritative playback clock. No competing RAF.
 * Preserves manual camera interaction after pause.
 */
const FumocaStudioInit = (() => {
  let _master = null;
  let _initialized = false;

  function init() {
    if (_initialized) return true;
    _master = window.FumocaMaster;
    if (!_master) {
      console.warn('[StudioInit] FumocaMaster not loaded');
      return false;
    }
    const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
    const ctrls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (cam && ctrls) {
      _master.setCameraBinding(cam, ctrls);
    }
    const states = window.Fumoca4D?.getStates?.() || [];
    if (states.length) {
      _master.setCameraTrack(states);
      const last = states[states.length - 1];
      _master.setDuration(Math.max(0.1, last.time_offset || 10));
    }
    _initialized = true;
    console.log('[StudioInit] Bound to camera and controls');
    return true;
  }

  function destroy() {
    if (_master) _master.pause();
    _initialized = false;
    _master = null;
  }

  function play() {
    if (!_master) return;
    const ctrls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (ctrls) ctrls.enabled = false;
    _master.play();
  }

  function pause() {
    if (!_master) return;
    _master.pause();
    const ctrls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (ctrls) ctrls.enabled = true;
  }

  function stop() {
    if (!_master) return;
    _master.stop();
    const ctrls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (ctrls) ctrls.enabled = true;
  }

  function scrub(time) {
    if (!_master) return null;
    return _master.evaluate(time);
  }

  function getTime() {
    return _master?.getTime?.() ?? 0;
  }

  function isPlaying() {
    return _master?.isPlaying?.() ?? false;
  }

  return {
    init, destroy, play, pause, stop, scrub,
    getTime, isPlaying,
    isInitialized: () => _initialized,
  };
})();

window.FumocaStudioInit = FumocaStudioInit;
export default FumocaStudioInit;
