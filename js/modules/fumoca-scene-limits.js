/**
 * FUMOCA Scene Limits Controller v86
 * ════════════════════════════════════════════════════════════════════════════
 * Makes camera boundaries feel intentional rather than broken.
 *
 * Three behaviours at a scene limit:
 *
 *   1. VIGNETTE — a soft darkening at the screen edges appears as the
 *      camera approaches the boundary. The closer to the limit, the
 *      darker and wider the vignette. Tells the viewer: "you're reaching
 *      the edge of what was captured."
 *
 *   2. SPRING-BACK — if the camera crosses the limit, it gently springs
 *      back into bounds. Not a hard stop — a gentle elastic return, like
 *      iOS scroll bounce. Feels intentional, not broken.
 *
 *   3. LIMIT TOAST — the first time the viewer hits a limit, a one-line
 *      message appears: "Edge of scene — captured from this direction."
 *      It fades after 2 seconds. Never shown again in that session.
 *
 * Works for:
 *   - Single-image reconstructions (v84 scene reconstructor)
 *   - Bounded vehicle/property tours (don't want viewer going underground)
 *   - Ad format pause points (viewer shouldn't orbit past the back of a
 *     product into nothingness)
 *   - Any .fumoc with a SCNE section containing scene_limits
 *
 * Limits format (from SCNE section or manual):
 *   {
 *     minX, maxX,   — horizontal bounds in world units
 *     minY, maxY,   — vertical bounds
 *     minZ, maxZ,   — depth bounds
 *     softZone: 0.3 — fraction of range where vignette starts (default 0.2)
 *   }
 *
 * Also enforces a minimum and maximum camera distance from the look-at
 * target (prevents zooming into the void or pulling back to infinity).
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── State ─────────────────────────────────────────────────────────────────────

const _s = {
  active:       false,
  limits:       null,   // { minX, maxX, minY, maxY, minZ, maxZ, softZone }
  camera:       null,
  controls:     null,
  minDist:      0.1,    // minimum orbit distance from target
  maxDist:      50.0,   // maximum orbit distance
  springStrength: 0.12, // how quickly the spring pulls back (0–1)
  toastShown:   false,
  rafId:        null,
  vignette:     null,   // DOM element
  toast:        null,   // DOM element
  toastTimer:   null,
};

// ── DOM ───────────────────────────────────────────────────────────────────────

function _ensureVignette() {
  if (_s.vignette) return _s.vignette;
  const el = document.createElement('div');
  el.id = 'fumocaSceneLimitVignette';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 8; pointer-events: none;
    background: radial-gradient(ellipse at center,
      transparent 40%, rgba(0,0,0,0) 40%);
    opacity: 0; transition: opacity .2s ease;
  `;
  document.body.appendChild(el);
  _s.vignette = el;
  return el;
}

function _ensureToast() {
  if (_s.toast) return _s.toast;
  const el = document.createElement('div');
  el.id = 'fumocaSceneLimitToast';
  el.style.cssText = `
    position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
    z-index: 201; background: rgba(5,7,11,.88);
    border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(12px);
    border-radius: 999px; padding: 8px 18px;
    font-family: 'DM Sans', system-ui; font-size: 12px; font-weight: 600;
    color: rgba(255,255,255,.7); white-space: nowrap;
    opacity: 0; transition: opacity .3s ease; pointer-events: none;
  `;
  el.textContent = 'Edge of captured scene';
  document.body.appendChild(el);
  _s.toast = el;
  return el;
}

// ── Boundary math ─────────────────────────────────────────────────────────────

/**
 * How close is the camera to its nearest limit? Returns 0–1.
 * 0 = comfortably inside, 1 = exactly at or past a limit.
 */
function _proximityToLimit(pos, limits) {
  const soft = limits.softZone ?? 0.2;
  let maxProx = 0;

  const axes = [
    [pos.x, limits.minX, limits.maxX],
    [pos.y, limits.minY, limits.maxY],
    [pos.z, limits.minZ, limits.maxZ],
  ];

  for (const [v, lo, hi] of axes) {
    if (lo === undefined || hi === undefined) continue;
    const range = hi - lo;
    if (range <= 0) continue;
    const softRange = range * soft;

    // Distance inside from each wall
    const distFromLo = v - lo;
    const distFromHi = hi - v;
    const minDist    = Math.min(distFromLo, distFromHi);

    if (minDist <= 0) {
      // Past the limit
      maxProx = 1;
    } else if (minDist < softRange) {
      // In the soft zone
      maxProx = Math.max(maxProx, 1 - minDist / softRange);
    }
  }

  return Math.max(0, Math.min(1, maxProx));
}

/**
 * Clamp a position to the limits. Returns new clamped position.
 */
function _clampToLimits(pos, limits) {
  return new THREE.Vector3(
    limits.minX !== undefined ? Math.max(limits.minX, Math.min(limits.maxX, pos.x)) : pos.x,
    limits.minY !== undefined ? Math.max(limits.minY, Math.min(limits.maxY, pos.y)) : pos.y,
    limits.minZ !== undefined ? Math.max(limits.minZ, Math.min(limits.maxZ, pos.z)) : pos.z,
  );
}

// ── Spring-back ───────────────────────────────────────────────────────────────

function _applySpringBack(camera, limits) {
  const pos     = camera.position;
  const clamped = _clampToLimits(pos, limits);

  const delta = new THREE.Vector3().subVectors(clamped, pos);
  const dist  = delta.length();

  if (dist < 0.001) return false; // already inside

  // Spring: move toward clamped position
  camera.position.addScaledVector(delta, _s.springStrength);
  return dist > 0.01; // still springing back?
}

// ── Distance enforcement ──────────────────────────────────────────────────────

function _enforceDistance(camera, controls) {
  if (!controls) return;
  const target = controls.target;
  const dist   = camera.position.distanceTo(target);

  if (dist < _s.minDist) {
    // Too close — push back
    const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
    camera.position.copy(target).addScaledVector(dir, _s.minDist);
    controls.update();
  } else if (dist > _s.maxDist) {
    // Too far — pull in
    const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
    camera.position.copy(target).addScaledVector(dir, _s.maxDist);
    controls.update();
  }
}

// ── Vignette update ───────────────────────────────────────────────────────────

function _updateVignette(proximity) {
  const el = _s.vignette;
  if (!el) return;

  if (proximity < 0.01) {
    el.style.opacity = '0';
    return;
  }

  // Vignette intensity scales with proximity
  const alpha      = proximity * 0.75;           // max 75% opacity
  const innerStop  = Math.max(10, 60 - proximity * 50); // shrinks as limit nears

  el.style.background = `radial-gradient(ellipse at center,
    transparent ${innerStop}%,
    rgba(0,0,0,${alpha.toFixed(2)}) 100%)`;
  el.style.opacity = '1';
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function _showToast(msg) {
  if (_s.toastShown) return;
  _s.toastShown = true;

  const el = _ensureToast();
  el.textContent = msg || 'Edge of captured scene';
  el.style.opacity = '1';

  clearTimeout(_s.toastTimer);
  _s.toastTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, 2500);
}

// ── Main tick ─────────────────────────────────────────────────────────────────

function _tick() {
  if (!_s.active || !_s.camera) {
    _s.rafId = requestAnimationFrame(_tick);
    return;
  }

  const cam     = _s.camera;
  const limits  = _s.limits;
  const ctrl    = _s.controls;

  // Enforce orbit distance
  _enforceDistance(cam, ctrl);

  if (limits) {
    const prox = _proximityToLimit(cam.position, limits);

    // Update vignette
    _updateVignette(prox);

    // Spring back if past limits
    const pastLimit = prox >= 1;
    if (pastLimit) {
      const stillSpringing = _applySpringBack(cam, limits);
      if (stillSpringing && !_s.toastShown) {
        _showToast(_s.limitMessage || 'Edge of captured scene');
      }
      if (ctrl) ctrl.update();
    }
  }

  _s.rafId = requestAnimationFrame(_tick);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise the scene limits controller.
 *
 * @param {object} options
 *   camera:       THREE.Camera
 *   controls:     OrbitControls
 *   limits:       { minX, maxX, minY, maxY, minZ, maxZ, softZone }
 *   minDist:      number   — minimum orbit distance (default 0.1)
 *   maxDist:      number   — maximum orbit distance (default 50)
 *   limitMessage: string   — toast message when limit is hit
 */
function init(options = {}) {
  _s.camera   = options.camera   || window._fumocaCamera;
  _s.controls = options.controls || window._fumocaControls;
  _s.limits   = options.limits   || null;
  _s.minDist  = options.minDist  ?? 0.1;
  _s.maxDist  = options.maxDist  ?? 50;
  _s.limitMessage = options.limitMessage || 'Edge of captured scene';
  _s.active   = true;
  _s.toastShown = false;

  _ensureVignette();
  _ensureToast();

  if (_s.rafId) cancelAnimationFrame(_s.rafId);
  _s.rafId = requestAnimationFrame(_tick);
}

/**
 * Load limits from a decoded SCNE section.
 */
function fromSceneMeta(sceneMeta, options = {}) {
  if (!sceneMeta?.scene_limits) return;

  const limits = { ...sceneMeta.scene_limits, softZone: 0.2 };

  // For single-image reconstructions, also restrict distance
  const depthScale = sceneMeta.depth_scale_m || 8;
  const minDist    = options.minDist ?? 0.05;
  const maxDist    = options.maxDist ?? depthScale * 0.9;

  const msg = sceneMeta.source_type === 'movie_frame'
    ? 'Edge of captured frame'
    : sceneMeta.source_type === 'cctv'
    ? 'Edge of camera view'
    : sceneMeta.source_type === 'historical'
    ? 'Edge of historical image'
    : 'Edge of captured scene';

  init({
    camera:       options.camera   || window._fumocaCamera,
    controls:     options.controls || window._fumocaControls,
    limits,
    minDist,
    maxDist,
    limitMessage: msg,
  });
}

/**
 * Update limits dynamically (e.g. when a 4D frame changes).
 */
function setLimits(limits) {
  _s.limits     = limits;
  _s.toastShown = false; // allow toast again for new scene
}

/**
 * Temporarily disable (e.g. during programmatic camera animation).
 */
function disable() { _s.active = false; }
function enable()  { _s.active = true; _s.toastShown = false; }

/**
 * Stop entirely and clean up.
 */
function destroy() {
  _s.active = false;
  if (_s.rafId) cancelAnimationFrame(_s.rafId);
  _s.vignette?.remove(); _s.vignette = null;
  _s.toast?.remove();    _s.toast    = null;
}

const FumocaSceneLimits = {
  init, fromSceneMeta, setLimits, disable, enable, destroy,
};

window.FumocaSceneLimits = FumocaSceneLimits;
export default FumocaSceneLimits;
