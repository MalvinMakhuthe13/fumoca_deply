/**
 * FUMOCA Density Boost v92
 * ════════════════════════════════════════════════════════════════════════════
 * Eliminates the "transparent when zoomed close" problem on Gaussian splats.
 *
 * Why this happens:
 *   At distance, hundreds of overlapping Gaussians fill every screen pixel.
 *   As the camera approaches, the screen-space footprint of each Gaussian
 *   shrinks faster than the inter-Gaussian gap shrinks. Gaps become
 *   visible. The splat appears sparse and ghostly at close range.
 *
 * The fix (this module):
 *   Dynamically scale up each Gaussian's footprint as the camera approaches.
 *   At normal viewing distance: footprint × 1.0 (unchanged).
 *   At close range:             footprint × up to 2.5 (solid coverage).
 *   The transition is smooth and follows an inverse-distance curve.
 *
 * What this module does NOT do:
 *   - Modify the .fumoc file (zero data changes — it's a renderer setting)
 *   - Affect performance noticeably (one extra uniform update per frame)
 *   - Break existing splats (additive — works on every .fumoc ever made)
 *
 * Implementation:
 *   Hooks into the existing GaussianRenderer (gaussian-renderer.js) by
 *   updating its `ptScale` uniform every frame based on camera-to-scene
 *   distance. The renderer already multiplies per-Gaussian sizes by
 *   `ptScale`, so this just modulates that multiplier dynamically.
 *
 * Distance computation:
 *   1. Compute scene centroid from existing splat bounds (cached on load)
 *   2. Each frame: distance = |camera.position - centroid|
 *   3. Boost factor = 1 + max(0, (refDist - distance) / refDist) × 1.5
 *      where refDist is the "normal" viewing distance (auto-calibrated).
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const _state = {
  active:           false,
  centroid:         { x: 0, y: 0, z: 0 },
  refDistance:      5.0,          // auto-calibrated from scene size
  baseScale:        1.0,          // user's preferred base scale
  maxBoost:         2.5,          // maximum multiplier at point-blank range
  rampStart:        0.6,          // boost begins at 60% of refDistance
  smoothedBoost:    1.0,          // running average for smooth transitions
  smoothFactor:     0.18,         // 0=no smoothing, 1=instant
  rafId:            null,
  cameraRef:        null,
  rendererRef:      null,
};

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Calibrate from a loaded splat — sets the centroid and reference distance.
 * Called automatically on fumoca:viewerReady.
 */
function calibrate({ centroid, sceneRadius } = {}) {
  if (centroid) _state.centroid = centroid;

  if (sceneRadius) {
    // Reference distance = approx 1.5× scene radius — typical "comfortable" view
    _state.refDistance = sceneRadius * 1.5;
  } else {
    // Estimate from camera position if unknown
    const cam = _state.cameraRef;
    if (cam) {
      const dx = cam.position.x - _state.centroid.x;
      const dy = cam.position.y - _state.centroid.y;
      const dz = cam.position.z - _state.centroid.z;
      _state.refDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
  }

  console.log(`[DensityBoost] Calibrated: refDistance=${_state.refDistance.toFixed(2)}, centroid=(${_state.centroid.x.toFixed(1)},${_state.centroid.y.toFixed(1)},${_state.centroid.z.toFixed(1)})`);
}

// ── Per-frame update ──────────────────────────────────────────────────────────

function _tick() {
  if (!_state.active) {
    _state.rafId = requestAnimationFrame(_tick);
    return;
  }

  const cam = _state.cameraRef;
  const r   = _state.rendererRef;
  if (!cam || !r) {
    _state.rafId = requestAnimationFrame(_tick);
    return;
  }

  // Distance from camera to scene centroid
  const dx = cam.position.x - _state.centroid.x;
  const dy = cam.position.y - _state.centroid.y;
  const dz = cam.position.z - _state.centroid.z;
  const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

  // Compute target boost
  // At distance >= refDistance: boost = 1.0
  // At distance == 0:           boost = maxBoost
  // Smooth ramp from rampStart × refDistance down to 0
  const rampDist = _state.refDistance * _state.rampStart;
  let target = 1.0;
  if (dist < rampDist) {
    const t = 1.0 - Math.max(0, dist / rampDist);
    // Smoothstep curve (3t² - 2t³) for natural easing
    const eased = t * t * (3 - 2 * t);
    target = 1.0 + (_state.maxBoost - 1.0) * eased;
  }

  // Smooth toward target
  _state.smoothedBoost += (target - _state.smoothedBoost) * _state.smoothFactor;

  // Apply to renderer's ptScale uniform (compounded with user base)
  const finalScale = _state.baseScale * _state.smoothedBoost;
  if (r.material?.uniforms?.uSharpness) {
    // Lower sharpness slightly when boosting — keeps edges natural
    const sharpnessAdj = 0.72 / _state.smoothedBoost;
    r.material.uniforms.uSharpness.value = Math.max(0.55, sharpnessAdj);
  }
  if (r._renderer && typeof r.setPointScale === 'function') {
    r.setPointScale(finalScale);
  } else if (window.S) {
    window.S.ptScale = finalScale;
  }

  _state.rafId = requestAnimationFrame(_tick);
}

// ── Public API ────────────────────────────────────────────────────────────────

function start({ camera, renderer, baseScale } = {}) {
  _state.cameraRef   = camera   || window._fumocaCamera;
  _state.rendererRef = renderer || window._fumocaRenderer;
  if (baseScale != null) _state.baseScale = baseScale;
  _state.active = true;

  if (!_state.rafId) _state.rafId = requestAnimationFrame(_tick);
  console.log('[DensityBoost] started');
}

function stop() {
  _state.active = false;
}

function setBaseScale(s) { _state.baseScale = s; }
function setMaxBoost(v)  { _state.maxBoost = Math.max(1.0, Math.min(4.0, v)); }
function setRampStart(v) { _state.rampStart = Math.max(0.2, Math.min(1.0, v)); }

function disable()  { _state.active = false; }
function enable()   { _state.active = true; }
function getState() { return { ..._state }; }

const FumocDensityBoost = {
  calibrate, start, stop, setBaseScale, setMaxBoost, setRampStart,
  disable, enable, getState,
};

// Auto-bootstrap when viewer is ready
window.addEventListener('fumoca:viewerReady', e => {
  // Compute centroid + scene radius from gaussians if available
  const g = window._fumocaCurrentGaussians;
  if (g && g.N > 0) {
    let sumX = 0, sumY = 0, sumZ = 0;
    let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
    let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
    const stride = Math.max(1, Math.floor(g.N / 5000));
    let n = 0;
    for (let i = 0; i < g.N; i += stride) {
      sumX += g.posX[i]; sumY += g.posY[i]; sumZ += g.posZ[i];
      if (g.posX[i] < mnX) mnX = g.posX[i]; if (g.posX[i] > mxX) mxX = g.posX[i];
      if (g.posY[i] < mnY) mnY = g.posY[i]; if (g.posY[i] > mxY) mxY = g.posY[i];
      if (g.posZ[i] < mnZ) mnZ = g.posZ[i]; if (g.posZ[i] > mxZ) mxZ = g.posZ[i];
      n++;
    }
    const cx = sumX / n, cy = sumY / n, cz = sumZ / n;
    const rx = (mxX - mnX) * 0.5, ry = (mxY - mnY) * 0.5, rz = (mxZ - mnZ) * 0.5;
    const sceneRadius = Math.sqrt(rx*rx + ry*ry + rz*rz);
    calibrate({ centroid: { x: cx, y: cy, z: cz }, sceneRadius });
  }

  start({
    camera:   window._fumocaCamera,
    renderer: window._fumocaRenderer,
  });
});

window.FumocDensityBoost = FumocDensityBoost;
export default FumocDensityBoost;
