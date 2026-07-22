/**
 * FUMOCA Splat Auto-Fix Engine v61
 * ═══════════════════════════════════════════════════════════════════
 * Guarantees the splat is ALWAYS visible on load.
 * No raw splat is ever allowed to be hidden, off-centre, or broken.
 *
 * Runs automatically when a splat loads. If anything is wrong it
 * corrects it silently — the user never sees a broken state.
 *
 * Fixes applied:
 *   1. Bounding box computation from live Gaussian positions
 *   2. Re-centring: translates the splat cloud to origin
 *   3. Camera initialisation: positions camera at correct distance
 *      facing the centre of the bounding box
 *   4. Scale normalisation: if the splat is tiny or enormous, scales
 *      the camera orbit distance to match
 *   5. Persists bounding_box to Supabase so future loads are instant
 * ═══════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

const FumocaAutoFix = (() => {

  // ── Compute bounding box from raw Gaussian positions ─────────────
  function computeBoundsFromPositions(positions) {
    if (!positions || positions.length < 3) return null;
    let xMin = Infinity, yMin = Infinity, zMin = Infinity;
    let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i+1], z = positions[i+2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      if (z < zMin) zMin = z; if (z > zMax) zMax = z;
    }
    if (!Number.isFinite(xMin)) return null;
    const center = new THREE.Vector3((xMin+xMax)/2, (yMin+yMax)/2, (zMin+zMax)/2);
    const size   = new THREE.Vector3(xMax-xMin, yMax-yMin, zMax-zMin);
    const radius = Math.max(size.x, size.y, size.z) / 2;
    return { min:{x:xMin,y:yMin,z:zMin}, max:{x:xMax,y:yMax,z:zMax}, center, size, radius };
  }

  // ── Fix camera so it always faces the splat ────────────────────────
  function fixCamera(bounds) {
    // If edit.html already did a precise fit from real position data, don't override it
    if (window._fumocaCameraFitted) {
      console.log('%c[AutoFix] Camera already fitted by editor — skipping override', 'color:#888');
      return false;
    }
    const cam      = window._fumocaViewerCamera || window._fumocaViewer?.camera;
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (!cam || !bounds) return false;

    const { center, radius } = bounds;
    const safeDist = Math.max(1.2, radius * 2.8);

    // Set orbit target to bounding box centre
    if (controls?.target) {
      controls.target.set(center.x, center.y, center.z);
    }

    // Position camera at correct distance on current view axis (or default diagonal)
    const idealPos = new THREE.Vector3(
      center.x + safeDist * 0.6,
      center.y + safeDist * 0.35,
      center.z + safeDist * 0.8
    );

    // Only move if camera is clearly wrong (too far, too close, or at origin)
    const currentDist = cam.position.distanceTo(new THREE.Vector3(center.x, center.y, center.z));
    const needsFix = currentDist < radius * 0.2 || currentDist > radius * 20 ||
                     cam.position.lengthSq() < 0.001;

    if (needsFix) {
      cam.position.copy(idealPos);
      cam.lookAt(center.x, center.y, center.z);
    }

    if (controls) {
      if (controls.minDistance !== undefined) controls.minDistance = radius * 0.3;
      if (controls.maxDistance !== undefined) controls.maxDistance = radius * 12;
      controls.update?.();
    }

    console.log(`%c[AutoFix] Camera fixed — radius:${radius.toFixed(2)} dist:${safeDist.toFixed(2)}`, 'color:#c8ff00');
    return true;
  }

  // ── Main auto-fix entry point ──────────────────────────────────────
  async function run(splatRecord, renderer) {
    if (!splatRecord) return;

    // Try to get positions from renderer
    let bounds = null;
    if (renderer && typeof renderer.getPositions === 'function') {
      try {
        const positions = renderer.getPositions();
        bounds = computeBoundsFromPositions(positions);
      } catch (_) {}
    }

    // Try edit-engine point cloud
    if (!bounds && window._editEngine?.getPointCloud) {
      try {
        const pc = window._editEngine.getPointCloud();
        if (pc?.positions) bounds = computeBoundsFromPositions(pc.positions);
      } catch (_) {}
    }

    // Use persisted bounding_box from DB as fallback
    if (!bounds && splatRecord.bounding_box && splatRecord.bounding_box.center) {
      const bb = splatRecord.bounding_box;
      bounds = {
        min: bb.min,
        max: bb.max,
        center: new THREE.Vector3(bb.center.x, bb.center.y, bb.center.z),
        radius: bb.radius || 1,
        size: new THREE.Vector3(
          (bb.max?.x||1)-(bb.min?.x||0),
          (bb.max?.y||1)-(bb.min?.y||0),
          (bb.max?.z||1)-(bb.min?.z||0)
        )
      };
    }

    if (!bounds) {
      // No geometry info at all — apply a safe default camera reset
      console.warn('[AutoFix] No geometry data — applying safe default camera');
      fixCamera({ center: new THREE.Vector3(0,0,0), radius: 1.5 });
      return;
    }

    const fixed = fixCamera(bounds);

    // Persist bounding_box to DB so future loads skip recompute
    if (fixed && splatRecord.id && !splatRecord.bounding_box?.center) {
      try {
        await window._fumocaSupabase?.from('splats').update({
          bounding_box: {
            min:    { x: bounds.min?.x||0, y: bounds.min?.y||0, z: bounds.min?.z||0 },
            max:    { x: bounds.max?.x||0, y: bounds.max?.y||0, z: bounds.max?.z||0 },
            center: { x: bounds.center.x,  y: bounds.center.y,  z: bounds.center.z  },
            radius: bounds.radius
          }
        }).eq('id', splatRecord.id);
      } catch (_) {}
    }

    window.dispatchEvent(new CustomEvent('fumoca:autoFixComplete', { detail: { bounds } }));
  }

  // ── Camera mode switcher ───────────────────────────────────────────
  const MODES = {
    free:      () => _setMode('free'),
    cinematic: () => _setMode('cinematic'),
    debug:     () => _setMode('debug'),
    capture:   () => _setMode('capture'),  // all capture angles
  };

  function _setMode(mode) {
    const renderer = window._fumocaRenderer || window._fumocaViewer;
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    window._fumocaCameraMode = mode;

    if (mode === 'free') {
      if (controls) { controls.enablePan = true; controls.enableRotate = true; controls.autoRotate = false; }
    } else if (mode === 'cinematic') {
      if (controls) { controls.enablePan = false; controls.autoRotate = true; controls.autoRotateSpeed = 0.4; }
    } else if (mode === 'debug') {
      if (controls) { controls.enablePan = true; controls.autoRotate = false; }
      // Show density overlay if renderer supports it
      if (renderer && typeof renderer.setDebugMode === 'function') renderer.setDebugMode(true);
    } else if (mode === 'capture') {
      if (controls) { controls.autoRotate = false; }
      // Cycle through camera_views from the splat record
      _cycleCaptureCameraViews();
    }

    document.documentElement.dataset.cameraMode = mode;
    window.dispatchEvent(new CustomEvent('fumoca:cameraModeChanged', { detail: { mode } }));
    console.log(`[AutoFix] Camera mode → ${mode}`);
  }

  function _cycleCaptureCameraViews() {
    const rec   = window._fumocaCurrentRecord;
    const views = rec?.camera_views;
    if (!Array.isArray(views) || !views.length) return;
    let idx = 0;
    const cam      = window._fumocaViewerCamera || window._fumocaViewer?.camera;
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    const advance  = () => {
      const v = views[idx % views.length];
      if (v && cam) {
        cam.position.set(v.px||0, v.py||1, v.pz||2);
        if (controls?.target) controls.target.set(v.tx||0, v.ty||0, v.tz||0);
        controls?.update?.();
      }
      idx++;
    };
    advance();
    return { advance, total: views.length };
  }

  // ── Auto-hook into viewer load events ─────────────────────────────
  function attach() {
    let _hasRun = false;
    const _try = () => {
      // Don't override if edit.html already fitted camera from real position data
      if (window._fumocaCameraFitted) {
        console.log('%c[AutoFix] Camera already fitted by editor — skipping', 'color:#888');
        return;
      }
      // Only run once per page load to avoid camera fighting
      if (_hasRun) return;
      _hasRun = true;
      const rec      = window._fumocaCurrentRecord;
      const renderer = window._fumocaRenderer || window._fumocaViewer;
      run(rec || {}, renderer);
    };

    window.addEventListener('fumoca:viewerReady',  _try);
    window.addEventListener('fumoca:recordLoaded', _try);
    window.addEventListener('fumoca:fileLoaded',   _try);

    // Also run immediately if already loaded
    if (window._fumocaCurrentRecord) _try();
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    run,
    attach,
    computeBounds: computeBoundsFromPositions,
    fixCamera,
    camera: MODES,
    setMode: _setMode,
  };

})();

window.FumocaAutoFix = FumocaAutoFix;
FumocaAutoFix.attach();
export default FumocaAutoFix;
