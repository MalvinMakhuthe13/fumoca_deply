/**
 * FUMOCA Camera View Panel v1
 * ══════════════════════════════════════════════════════
 * Shows camera capture positions extracted from PLY files.
 * Lets users fly to any capture position during editing.
 * ══════════════════════════════════════════════════════
 */

const FumocaCameraView = (() => {
  let _cameras = [];
  let _currentIdx = -1;
  let _panel = null;

  // ── Load cameras from validation result ───────────────
  function loadCameras(cameras) {
    _cameras = cameras || [];
    _render();
    if (_cameras.length > 0) {
      console.log(`%c[CameraView] ${_cameras.length} capture positions loaded`, 'color:#c8ff00');
    }
  }

  // ── Fly to a specific camera position ─────────────────
  function flyTo(idx) {
    if (idx < 0 || idx >= _cameras.length) return;
    const cam = _cameras[idx];
    const threeCam = window._fumocaViewerCamera;
    const controls = window._fumocaViewerControls;
    if (!threeCam || !cam) return;

    _currentIdx = idx;

    // Smooth lerp to camera position (no THREE dependency — uses raw position object)
    const startX = threeCam.position.x, startY = threeCam.position.y, startZ = threeCam.position.z;
    const duration = 600;
    const start = performance.now();

    function tick() {
      const t = Math.min(1, (performance.now() - start) / duration);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      threeCam.position.x = startX + (cam.x - startX) * ease;
      threeCam.position.y = startY + (cam.y - startY) * ease;
      threeCam.position.z = startZ + (cam.z - startZ) * ease;
      if (controls?.target) {
        threeCam.lookAt(controls.target.x, controls.target.y, controls.target.z);
      }
      controls?.update?.();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    _render();
    window.dispatchEvent(new CustomEvent('fumoca:cameraViewChanged', { detail: { idx, camera: cam } }));
  }

  // ── Next / prev camera ─────────────────────────────────
  function next() { flyTo((_currentIdx + 1) % _cameras.length); }
  function prev() { flyTo((_currentIdx - 1 + _cameras.length) % _cameras.length); }

  // ── Build the camera panel UI ─────────────────────────
  function buildUI(containerId) {
    _panel = document.getElementById(containerId);
    if (!_panel) return;
    _render();
  }

  function _render() {
    if (!_panel) return;
    if (_cameras.length === 0) {
      _panel.innerHTML = `
        <div style="color:var(--muted,#666);font-size:12px;text-align:center;padding:20px 0;line-height:1.6;">
          No camera positions in this file.<br>
          <span style="font-size:11px;opacity:.6;">Embed cameras when exporting from Polycam, Luma, or COLMAP.</span>
        </div>`;
      return;
    }

    _panel.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <button onclick="window.FumocaCameraView.prev()" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:12px;">◀ Prev</button>
        <div style="flex:2;text-align:center;padding:7px;font-size:12px;color:var(--cyan,#0ef);font-weight:700;">
          ${_currentIdx >= 0 ? `Cam ${_currentIdx + 1} / ${_cameras.length}` : `${_cameras.length} positions`}
        </div>
        <button onclick="window.FumocaCameraView.next()" style="flex:1;padding:7px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:12px;">Next ▶</button>
      </div>
      <div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
        ${_cameras.map((c, i) => `
          <button onclick="window.FumocaCameraView.flyTo(${i})"
            style="text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:11px;font-family:monospace;
                   background:${i === _currentIdx ? 'rgba(200,255,0,.14)' : 'rgba(255,255,255,.04)'};
                   border:1px solid ${i === _currentIdx ? 'rgba(200,255,0,.4)' : 'rgba(255,255,255,.08)'};
                   color:${i === _currentIdx ? '#c8ff00' : '#ccc'};">
            📷 Cam ${i+1} &nbsp;
            <span style="opacity:.6;">(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})</span>
          </button>`).join('')}
      </div>`;
  }

  return { loadCameras, flyTo, next, prev, buildUI, getCameras: () => _cameras };
})();

window.FumocaCameraView = FumocaCameraView;
export default FumocaCameraView;
