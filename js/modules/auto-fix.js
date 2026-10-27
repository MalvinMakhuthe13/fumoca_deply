/**
 * FUMOCA Splat Auto-Fix + Live Camera Modes
 * ═══════════════════════════════════════════════════════════════════
 * - Guarantees splat is visible on load (re-centre / fit)
 * - Camera modes that actually change the experience in Studio
 * - Generated capture angles when PLY has no embedded cameras
 * - Save current view as a pose + fly between poses
 * ═══════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

const FumocaAutoFix = (() => {
  let _mode = 'free';
  let _cinematicRaf = 0;
  let _captureIdx = 0;
  let _debugOn = false;
  let _savedPoses = []; // user-saved camera poses for this session / record
  let _statusEl = null;
  let _boundsHelper = null;

  function _cam() {
    return window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera || null;
  }
  function _controls() {
    return window._fumocaViewerControls || window._fumocaViewer?.controls || window._fumocaControls || null;
  }
  function _scene() {
    return window._fumocaScene || window._fumocaViewer?.scene || null;
  }

  function _setStatus(msg) {
    _statusEl = _statusEl || document.getElementById('v61CameraModeStatus');
    if (_statusEl) _statusEl.textContent = msg;
    console.log('[AutoFix]', msg);
  }

  function _highlightMode(mode) {
    document.documentElement.dataset.cameraMode = mode;
    document.querySelectorAll('[data-cam-mode]').forEach((btn) => {
      const on = btn.getAttribute('data-cam-mode') === mode;
      btn.classList.toggle('active', on);
      btn.style.outline = on ? '2px solid rgba(200,255,0,.85)' : '';
      btn.style.background = on ? 'rgba(200,255,0,.12)' : '';
    });
  }

  // ── Bounds ────────────────────────────────────────────────────────
  function computeBoundsFromPositions(positions) {
    if (!positions || positions.length < 3) return null;
    let xMin = Infinity, yMin = Infinity, zMin = Infinity;
    let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
    const stride = positions.length > 300000 ? 9 : positions.length > 100000 ? 6 : 3;
    for (let i = 0; i < positions.length; i += stride) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }
    if (!Number.isFinite(xMin)) return null;
    const center = new THREE.Vector3((xMin + xMax) / 2, (yMin + yMax) / 2, (zMin + zMax) / 2);
    const size = new THREE.Vector3(xMax - xMin, yMax - yMin, zMax - zMin);
    const radius = Math.max(size.x, size.y, size.z, 0.2) / 2;
    return {
      min: { x: xMin, y: yMin, z: zMin },
      max: { x: xMax, y: yMax, z: zMax },
      center, size, radius,
    };
  }

  function _defaultBounds() {
    return {
      center: new THREE.Vector3(0, 0, 0),
      radius: 1.5,
      size: new THREE.Vector3(3, 3, 3),
      min: { x: -1.5, y: -1.5, z: -1.5 },
      max: { x: 1.5, y: 1.5, z: 1.5 },
    };
  }

  function getLiveBounds() {
    // Prefer live editor point cloud — never return null (camera panel needs center)
    try {
      if (window.S?.positions?.length) {
        const pos = window.S.positions;
        const alive = window.S.alive;
        if (alive?.length) {
          const out = [];
          for (let i = 0; i < alive.length; i++) {
            if (!alive[i]) continue;
            out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          }
          if (out.length >= 9) {
            const b = computeBoundsFromPositions(out);
            if (b?.center) return b;
          }
        }
        const b2 = computeBoundsFromPositions(pos);
        if (b2?.center) return b2;
      }
      if (window._editEngine?.getPointCloud) {
        const pc = window._editEngine.getPointCloud();
        if (pc?.positions) {
          const b = computeBoundsFromPositions(pc.positions);
          if (b?.center) return b;
        }
      }
      const renderer = window._fumocaRenderer || window._fumocaViewer;
      if (renderer?.getPositions) {
        const b = computeBoundsFromPositions(renderer.getPositions());
        if (b?.center) return b;
      }
      const rec = window._fumocaCurrentRecord;
      const bb = rec?.meta?.bounding_box || rec?.bounding_box;
      if (bb?.center) {
        return {
          min: bb.min || { x: -1, y: -1, z: -1 },
          max: bb.max || { x: 1, y: 1, z: 1 },
          center: new THREE.Vector3(bb.center.x, bb.center.y, bb.center.z),
          radius: bb.radius || 1.5,
          size: new THREE.Vector3(2, 2, 2),
        };
      }
    } catch (e) {
      console.warn('[AutoFix] getLiveBounds', e);
    }
    return _defaultBounds();
  }

  // Use robust bounds for framing when a few distant background/noise
  // splats dominate the raw min/max box. Keep the full bounds for ordinary
  // scenes; only switch when outliers inflate the fitted radius dramatically.
  function _robustCameraBounds(fallback) {
    const state = window.S;
    if (!state?.positions?.length) return fallback;
    const alive = state.alive;
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < state.positions.length / 3; i++) {
      if (alive?.length && !alive[i]) continue;
      const x = state.positions[i * 3], y = state.positions[i * 3 + 1], z = state.positions[i * 3 + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      xs.push(x); ys.push(y); zs.push(z);
    }
    if (xs.length < 100) return fallback;
    const quantile = (values, q) => {
      values.sort((a, b) => a - b);
      return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)))];
    };
    const x0 = quantile(xs, 0.01), x1 = quantile(xs, 0.99);
    const y0 = quantile(ys, 0.01), y1 = quantile(ys, 0.99);
    const z0 = quantile(zs, 0.01), z1 = quantile(zs, 0.99);
    const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const size = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
    const radius = Math.max(size.x, size.y, size.z, 0.2) / 2;
    if (!Number.isFinite(radius) || radius <= 0) return fallback;
    if (fallback?.radius && fallback.radius < radius * 3) return fallback;
    console.info('[AutoFix] Robust camera framing ignored distant outliers', {
      fullRadius: Number(fallback?.radius?.toFixed?.(2) || 0),
      robustRadius: Number(radius.toFixed(2))
    });
    return { ...fallback, center, size, radius };
  }

  // ── Force fit camera (ignores "already fitted") ───────────────────
  function forceFitCamera(bounds) {
    const cam = _cam();
    const controls = _controls();
    bounds = _robustCameraBounds(bounds || getLiveBounds());
    if (!cam || !controls || !bounds?.center) {
      _setStatus('No camera/controls — load a splat first');
      return false;
    }
    const center = bounds.center.clone ? bounds.center.clone() : new THREE.Vector3(bounds.center.x, bounds.center.y, bounds.center.z);
    const radius = Math.max(0.4, Number(bounds.radius) || 1.5);
    const dist = radius * 2.6;
    // Prefer a 3/4 elevated view
    const dir = new THREE.Vector3(0.65, 0.35, 0.7).normalize();
    cam.position.copy(center).add(dir.multiplyScalar(dist));
    if (controls.target) controls.target.copy(center);
    // Published Gaussian splats must not inherit radius-based zoom clamps.
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.update?.();
    cam.near = Math.max(0.001, radius * 0.001);
    cam.far = Math.max(200, radius * 40);
    cam.updateProjectionMatrix?.();
    window._fumocaCameraFitted = true;
    _setStatus(`Camera fitted · radius ${radius.toFixed(2)}`);
    return true;
  }

  function fixCamera(bounds) {
    // Soft path used on auto-load: still fit if not fitted yet
    if (window._fumocaCameraFitted) return false;
    return forceFitCamera(bounds);
  }

  async function run(splatRecord = {}, renderer = null, { force = false } = {}) {
    const bounds = getLiveBounds();
    if (force) return forceFitCamera(bounds);
    if (window._fumocaCameraFitted) return false;
    const ok = forceFitCamera(bounds);
    // Persist bounds into meta when possible
    if (ok && splatRecord?.id && bounds?.center && window._fumocaSupabase) {
      try {
        const bounding_box = {
          min: bounds.min,
          max: bounds.max,
          center: { x: bounds.center.x, y: bounds.center.y, z: bounds.center.z },
          radius: bounds.radius,
        };
        await window._fumocaSupabase.from('nif_files').update({
          meta: { ...(splatRecord.meta || {}), bounding_box },
        }).eq('id', splatRecord.id);
      } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent('fumoca:autoFixComplete', { detail: { bounds } }));
    return ok;
  }

  // ── Cinematic orbit loop ──────────────────────────────────────────
  function _stopCinematic() {
    if (_cinematicRaf) cancelAnimationFrame(_cinematicRaf);
    _cinematicRaf = 0;
    const controls = _controls();
    if (controls) controls.autoRotate = false;
  }

  function _startCinematic() {
    _stopCinematic();
    const cam = _cam();
    const controls = _controls();
    if (!cam || !controls) {
      _setStatus('Cinematic needs a loaded splat');
      return;
    }
    // Prefer manual orbit so it works even if OrbitControls.autoRotate is flaky
    const bounds = getLiveBounds();
    const center = bounds.center.clone ? bounds.center.clone() : new THREE.Vector3();
    if (controls.target) controls.target.copy(center);
    controls.autoRotate = false;
    controls.enableRotate = true;
    controls.enablePan = false;

    let angle = Math.atan2(cam.position.x - center.x, cam.position.z - center.z);
    const radius = cam.position.distanceTo(center) || (bounds.radius * 2.6);
    const height = cam.position.y;
    const speed = 0.35; // rad/sec — visible but calm

    const tick = (t) => {
      if (_mode !== 'cinematic') return;
      const controlsNow = _controls();
      const camNow = _cam();
      if (!camNow || !controlsNow) return;
      // keep height; orbit in XZ
      angle += speed * 0.016;
      camNow.position.x = center.x + Math.sin(angle) * radius;
      camNow.position.z = center.z + Math.cos(angle) * radius;
      camNow.position.y = height;
      if (controlsNow.target) controlsNow.target.copy(center);
      controlsNow.update?.();
      _cinematicRaf = requestAnimationFrame(tick);
    };
    _cinematicRaf = requestAnimationFrame(tick);
    _setStatus('Cinematic orbit · click Free Camera to stop');
  }

  // ── Generated capture angles when file has none ───────────────────
  function _standardAngles(bounds) {
    bounds = bounds?.center ? bounds : getLiveBounds();
    const c = bounds.center;
    const r = Math.max(0.6, (bounds.radius || 1.5) * 2.4);
    const y = c.y + bounds.radius * 0.25;
    return [
      { name: 'Front ¾', px: c.x + r * 0.7, py: y, pz: c.z + r * 0.7, tx: c.x, ty: c.y, tz: c.z },
      { name: 'Front', px: c.x, py: y, pz: c.z + r, tx: c.x, ty: c.y, tz: c.z },
      { name: 'Right', px: c.x + r, py: y, pz: c.z, tx: c.x, ty: c.y, tz: c.z },
      { name: 'Rear ¾', px: c.x - r * 0.7, py: y, pz: c.z - r * 0.7, tx: c.x, ty: c.y, tz: c.z },
      { name: 'Left', px: c.x - r, py: y, pz: c.z, tx: c.x, ty: c.y, tz: c.z },
      { name: 'Top', px: c.x, py: c.y + r * 1.2, pz: c.z + r * 0.15, tx: c.x, ty: c.y, tz: c.z },
      { name: 'Detail low', px: c.x + r * 0.55, py: c.y + bounds.radius * 0.05, pz: c.z + r * 0.55, tx: c.x, ty: c.y, tz: c.z },
    ];
  }

  function _allCaptureViews() {
    const rec = window._fumocaCurrentRecord;
    const embedded = Array.isArray(rec?.camera_views) ? rec.camera_views : [];
    const fromCamView = window.FumocaCameraView?.getCameras?.() || [];
    const mapped = fromCamView.map((c, i) => ({
      name: c.name || `Capture ${i + 1}`,
      px: c.x ?? c.px, py: c.y ?? c.py, pz: c.z ?? c.pz,
      tx: c.tx ?? 0, ty: c.ty ?? 0, tz: c.tz ?? 0,
    }));
    const generated = _standardAngles(getLiveBounds());
    return [..._savedPoses, ...embedded, ...mapped, ...generated];
  }

  function _flyToView(v, duration = 700) {
    const cam = _cam();
    const controls = _controls();
    if (!cam || !v) return;
    const endPos = new THREE.Vector3(v.px ?? v.x ?? 0, v.py ?? v.y ?? 1, v.pz ?? v.z ?? 2);
    const endTarget = new THREE.Vector3(v.tx ?? 0, v.ty ?? 0, v.tz ?? 0);
    const startPos = cam.position.clone();
    const startTarget = controls?.target?.clone?.() || new THREE.Vector3();
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      cam.position.lerpVectors(startPos, endPos, e);
      if (controls?.target?.lerpVectors) controls.target.lerpVectors(startTarget, endTarget, e);
      controls?.update?.();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function nextCaptureAngle() {
    const views = _allCaptureViews();
    if (!views.length) {
      _setStatus('No capture angles available');
      return;
    }
    _captureIdx = (_captureIdx + 1) % views.length;
    const v = views[_captureIdx];
    _flyToView(v);
    _setStatus(`Capture angle ${_captureIdx + 1}/${views.length} · ${v.name || 'view'}`);
  }

  // ── Debug overlay ─────────────────────────────────────────────────
  function _setDebug(on) {
    _debugOn = on;
    const scene = _scene();
    if (_boundsHelper) {
      scene?.remove?.(_boundsHelper);
      _boundsHelper.geometry?.dispose?.();
      _boundsHelper.material?.dispose?.();
      _boundsHelper = null;
    }
    if (!on) {
      document.documentElement.classList.remove('fumoca-debug-cam');
      _setStatus('Debug off');
      return;
    }
    document.documentElement.classList.add('fumoca-debug-cam');
    const bounds = getLiveBounds();
    try {
      const box = new THREE.Box3(
        new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
        new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z)
      );
      _boundsHelper = new THREE.Box3Helper(box, 0xc8ff00);
      scene?.add?.(_boundsHelper);
    } catch (_) {}
    // Soft stage treatment
    const vp = document.getElementById('viewport');
    if (vp) vp.style.outline = '1px dashed rgba(200,255,0,.35)';
    _setStatus(`Debug on · radius ${(bounds.radius || 0).toFixed(2)}`);
  }

  // ── Save current view as pose ─────────────────────────────────────
  function saveCurrentPose(name) {
    const cam = _cam();
    const controls = _controls();
    if (!cam) {
      _setStatus('No camera to save');
      return null;
    }
    const pose = {
      name: name || `Pose ${_savedPoses.length + 1}`,
      px: cam.position.x,
      py: cam.position.y,
      pz: cam.position.z,
      tx: controls?.target?.x || 0,
      ty: controls?.target?.y || 0,
      tz: controls?.target?.z || 0,
      id: 'pose_' + Math.random().toString(36).slice(2, 8),
    };
    _savedPoses.push(pose);
    _renderPoseList();
    _setStatus(`Saved “${pose.name}”`);
    window.dispatchEvent(new CustomEvent('fumoca:cameraPoseSaved', { detail: pose }));
    return pose;
  }

  function _renderPoseList() {
    const panel = document.getElementById('v61CameraViewPanel');
    const badge = document.getElementById('camPosBadge');
    const views = _allCaptureViews();
    if (badge) badge.textContent = String(_savedPoses.length + (window.FumocaCameraView?.getCameras?.()?.length || 0));
    if (!panel) return;

    const savedBlock = _savedPoses.length
      ? `<div style="margin-bottom:8px;font-size:11px;color:rgba(200,255,0,.75);letter-spacing:.06em;text-transform:uppercase;">Saved poses</div>
         ${_savedPoses.map((p, i) => `
           <button data-pose-id="${p.id}" class="ac-btn full" style="margin-bottom:4px;text-align:left;font-size:12px;">
             ${i + 1}. ${p.name}
           </button>`).join('')}`
      : '';

    const angles = _standardAngles(getLiveBounds());
    panel.innerHTML = `
      ${savedBlock}
      <div style="margin:8px 0 6px;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.06em;text-transform:uppercase;">Studio angles</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        ${angles.map((a, i) => `
          <button data-angle-idx="${i}" class="ac-btn" style="font-size:11px;padding:8px 6px;">${a.name}</button>
        `).join('')}
      </div>
      <button id="v61SavePoseBtn" class="ac-btn lime full" style="margin-top:10px;">💾 Save current view</button>
      <div class="hint" style="margin-top:8px;">PLY capture cameras appear here when the file includes them. Otherwise Studio angles still work.</div>
    `;

    panel.querySelectorAll('[data-pose-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pose = _savedPoses.find((p) => p.id === btn.getAttribute('data-pose-id'));
        if (pose) { _flyToView(pose); _setStatus(`Flew to ${pose.name}`); }
      });
    });
    panel.querySelectorAll('[data-angle-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-angle-idx'));
        const v = angles[idx];
        if (v) { _flyToView(v); _setStatus(v.name); }
      });
    });
    panel.querySelector('#v61SavePoseBtn')?.addEventListener('click', () => {
      const name = prompt('Name this camera pose', `Pose ${_savedPoses.length + 1}`);
      if (name == null) return;
      saveCurrentPose(name.trim() || undefined);
    });
  }

  // ── Mode switcher ─────────────────────────────────────────────────
  function _setMode(mode) {
    const controls = _controls();
    _mode = mode;
    window._fumocaCameraMode = mode;
    _highlightMode(mode);
    _stopCinematic();

    if (mode === 'free') {
      if (controls) {
        controls.enablePan = true;
        controls.enableRotate = true;
        controls.enableZoom = true;
        controls.autoRotate = false;
      }
      if (_debugOn) _setDebug(false);
      const vp = document.getElementById('viewport');
      if (vp) vp.style.outline = '';
      _setStatus('Free camera · orbit / pan / zoom');
    } else if (mode === 'cinematic') {
      if (controls) {
        controls.enablePan = false;
        controls.enableRotate = true;
        controls.autoRotate = false;
      }
      _startCinematic();
    } else if (mode === 'debug') {
      if (controls) {
        controls.enablePan = true;
        controls.autoRotate = false;
      }
      _setDebug(true);
    } else if (mode === 'capture') {
      if (controls) controls.autoRotate = false;
      nextCaptureAngle();
      _renderPoseList();
    }

    window.dispatchEvent(new CustomEvent('fumoca:cameraModeChanged', { detail: { mode } }));
  }

  function attach() {
    let _hasRun = false;
    let _running = false;
    const _try = async () => {
      if (_hasRun || _running) return;
      if (window._fumocaCameraFitted) {
        _hasRun = true;
        return;
      }
      _running = true;
      try {
        _hasRun = await run(window._fumocaCurrentRecord || {}, window._fumocaRenderer || window._fumocaViewer) === true;
      } finally {
        _running = false;
      }
    };
    window.addEventListener('fumoca:viewerReady', _try);
    window.addEventListener('fumoca:recordLoaded', _try);
    window.addEventListener('fumoca:fileLoaded', () => {
      _hasRun = false;
      _try();
      setTimeout(() => _renderPoseList(), 400);
    });
    if (window._fumocaCurrentRecord) _try();
    // Build pose UI when panel exists
    setTimeout(() => _renderPoseList(), 800);
  }

  const MODES = {
    free: () => _setMode('free'),
    cinematic: () => _setMode('cinematic'),
    debug: () => _setMode('debug'),
    capture: () => _setMode('capture'),
  };

  return {
    run: (rec, renderer) => run(rec || window._fumocaCurrentRecord, renderer, { force: true }),
    attach,
    computeBounds: computeBoundsFromPositions,
    fixCamera: forceFitCamera,
    forceFitCamera,
    camera: MODES,
    setMode: _setMode,
    nextCaptureAngle,
    saveCurrentPose,
    getMode: () => _mode,
    refreshPoses: _renderPoseList,
  };
})();

window.FumocaAutoFix = FumocaAutoFix;
FumocaAutoFix.attach();
export default FumocaAutoFix;
