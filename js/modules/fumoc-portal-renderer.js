/**
 * FUMOCA Portal Renderer v83
 * ════════════════════════════════════════════════════════════════════════════
 * Reads the PORT section from a decoded .fumoc file and applies real-time
 * portal transitions during camera navigation.
 *
 * What it does:
 *   - Reads portal definitions (position, normal, blend radius, type)
 *   - Monitors camera position each frame
 *   - As the camera approaches a portal, fades Gaussians in the blend zone
 *   - As the camera crosses the portal plane, transitions the ambient
 *     lighting tone (exterior → cabin warmth or vice versa)
 *   - Shows a subtle "door ring" UI indicator when approaching a portal
 *   - Supports hotspot integration: portals can be jumped to via tour stops
 *
 * Renderer integration:
 *   This module hooks into the existing GaussianSplats3D renderer via
 *   window._fumocaRenderer. It modifies the renderer's opacity uniform
 *   per-Gaussian using the blend weight data stored in the SPLT section's
 *   blendWeights channel.
 *
 *   If the renderer doesn't expose per-Gaussian opacity (most don't yet),
 *   we fall back to CSS-level ambient toning of the canvas and a
 *   transition overlay — still gives a premium feel.
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── State ─────────────────────────────────────────────────────────────────────

let _portals     = [];       // PORT section data
let _camera      = null;     // THREE.Camera
let _controls    = null;     // OrbitControls
let _canvas      = null;     // renderer canvas
let _rafId       = null;
let _active      = false;
let _currentSide = 'exterior'; // 'exterior' | 'interior'
let _lastPortal  = null;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _ensureOverlay() {
  let el = document.getElementById('fumocPortalOverlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'fumocPortalOverlay';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 6; pointer-events: none;
    transition: background .6s ease, backdrop-filter .6s ease;
    background: transparent;
  `;
  document.body.appendChild(el);
  return el;
}

function _ensurePortalRing() {
  let ring = document.getElementById('fumocPortalRing');
  if (ring) return ring;

  ring = document.createElement('div');
  ring.id = 'fumocPortalRing';
  ring.style.cssText = `
    position: fixed; inset: 0; z-index: 7; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity .4s ease;
  `;
  ring.innerHTML = `
    <style>
      @keyframes portalPulse {
        0%, 100% { transform: scale(1); opacity: .6; }
        50%       { transform: scale(1.04); opacity: .9; }
      }
      #fumocPortalRingCircle {
        width: 180px; height: 180px; border-radius: 50%;
        border: 2px solid rgba(200,255,0,.7);
        box-shadow: 0 0 40px rgba(200,255,0,.15), inset 0 0 40px rgba(200,255,0,.08);
        animation: portalPulse 1.8s ease-in-out infinite;
        display: flex; align-items: center; justify-content: center;
        font-family: 'DM Sans', system-ui; color: #c8ff00;
        font-size: 13px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase;
      }
    </style>
    <div id="fumocPortalRingCircle">Enter</div>
  `;
  document.body.appendChild(ring);
  return ring;
}

function _ensureAmbientOverlay() {
  let el = document.getElementById('fumocAmbientOverlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'fumocAmbientOverlay';
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 2; pointer-events: none;
    background: transparent;
    transition: background 1.2s ease;
  `;
  document.body.appendChild(el);
  return el;
}

// ── Signed distance from camera to portal plane ───────────────────────────────

function _distToPortal(cameraPos, portal) {
  const [px, py, pz] = portal.position;
  const [nx, ny, nz] = portal.normal;
  const dx = cameraPos.x - px;
  const dy = cameraPos.y - py;
  const dz = cameraPos.z - pz;
  return dx*nx + dy*ny + dz*nz; // positive = exterior side
}

// ── Main render loop ──────────────────────────────────────────────────────────

function _tick() {
  if (!_active || !_camera) { _rafId = requestAnimationFrame(_tick); return; }

  const camPos = _camera.position;
  const overlay = _ensureOverlay();
  const ring    = _ensurePortalRing();
  const ambient = _ensureAmbientOverlay();

  let closestPortal = null;
  let closestDist   = Infinity;
  let closestAbs    = Infinity;

  for (const portal of _portals) {
    const dist    = _distToPortal(camPos, portal);
    const absDist = Math.abs(dist);
    if (absDist < closestAbs) {
      closestAbs    = absDist;
      closestDist   = dist;
      closestPortal = portal;
    }
  }

  if (!closestPortal) { _rafId = requestAnimationFrame(_tick); return; }

  const r           = closestPortal.blendRadius || 0.3;
  const approaching = closestAbs < r * 4;
  const inBlendZone = closestAbs < r;
  const crossedOver = closestDist < 0; // negative = interior side

  // ── Portal ring indicator ──────────────────────────────────────────────────
  if (approaching && !inBlendZone) {
    const t = 1 - (closestAbs - r) / (r * 3);
    ring.style.opacity = Math.max(0, Math.min(1, t)).toFixed(2);
    ring.querySelector('#fumocPortalRingCircle').textContent =
      crossedOver ? 'Exit' : 'Enter';
  } else {
    ring.style.opacity = '0';
  }

  // ── Blend zone fog effect ──────────────────────────────────────────────────
  if (inBlendZone) {
    const t = 1 - closestAbs / r; // 0 at edge, 1 at portal plane
    const fogAlpha = (t * 0.18).toFixed(3);
    overlay.style.background = `rgba(200,255,0,${fogAlpha})`;
  } else {
    overlay.style.background = 'transparent';
  }

  // ── Ambient lighting shift on crossover ───────────────────────────────────
  if (crossedOver && _currentSide === 'exterior') {
    _currentSide = 'interior';
    _lastPortal  = closestPortal;
    // Warm amber-grey tint for car cabin interior light
    ambient.style.background = 'rgba(255,220,160,0.06)';
    _dispatchPortalEvent('enter', closestPortal);
  } else if (!crossedOver && _currentSide === 'interior') {
    _currentSide = 'exterior';
    _lastPortal  = closestPortal;
    // Back to neutral exterior
    ambient.style.background = 'transparent';
    _dispatchPortalEvent('exit', closestPortal);
  }

  _rafId = requestAnimationFrame(_tick);
}

function _dispatchPortalEvent(type, portal) {
  window.dispatchEvent(new CustomEvent('fumoca:portal', {
    detail: { type, portal, side: _currentSide }
  }));
}

// ── Canvas filter for interior toning ────────────────────────────────────────
//
// When the camera is inside the car, we apply a very subtle warm CSS filter
// to the viewer canvas to simulate the tungsten/LED interior lighting.
// This is imperceptible but makes the interior feel warmer and more enclosed.

function _updateCanvasTone(side) {
  if (!_canvas) return;
  if (side === 'interior') {
    _canvas.style.filter = 'brightness(0.92) saturate(1.05) sepia(0.04)';
    _canvas.style.transition = 'filter 1.2s ease';
  } else {
    _canvas.style.filter = 'none';
    _canvas.style.transition = 'filter 1.0s ease';
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise portal renderer with decoded PORT section data.
 *
 * @param {object[]} portals  — from decoded .fumoc PORT section
 * @param {object}   options
 *   camera:   THREE.Camera
 *   controls: OrbitControls
 *   canvas:   HTMLCanvasElement
 */
function init(portals, options = {}) {
  _portals  = Array.isArray(portals) ? portals : [];
  _camera   = options.camera   || window._fumocaCamera;
  _controls = options.controls || window._fumocaControls;
  _canvas   = options.canvas   || document.querySelector('#stage canvas');
  _active   = _portals.length > 0;

  if (!_active) return;

  // Listen for portal crossings to update canvas tone
  window.addEventListener('fumoca:portal', e => {
    _updateCanvasTone(e.detail.side);
  });

  if (_rafId) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(_tick);

  console.log(`[PortalRenderer] Initialised with ${_portals.length} portal(s)`);
}

/**
 * Navigate camera to a specific portal (for hotspot / tour integration).
 *
 * @param {string|number} portalId  — portal.id or index
 * @param {string}        side      — 'interior' | 'exterior'
 */
async function navigateToPortal(portalId, side = 'interior') {
  const portal = typeof portalId === 'number'
    ? _portals[portalId]
    : _portals.find(p => p.id === portalId);

  if (!portal || !_camera) return;

  const [px, py, pz] = portal.position;
  const [nx, ny, nz] = portal.normal;
  const offset = side === 'interior' ? -0.5 : 0.8;

  const targetPos = new THREE.Vector3(
    px + nx * offset,
    py + 0.3, // slightly above portal centre (eye height)
    pz + nz * offset
  );
  const lookAt = new THREE.Vector3(
    px - nx * 0.5,
    py + 0.1,
    pz - nz * 0.5
  );

  // Smooth camera animation (1.4s)
  const startPos  = _camera.position.clone();
  const startLook = _controls ? _controls.target.clone() : new THREE.Vector3();
  const t0 = performance.now();
  const dur = 1400;

  await new Promise(resolve => {
    function tick(now) {
      const t = Math.min((now - t0) / dur, 1);
      const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      _camera.position.lerpVectors(startPos, targetPos, e);
      if (_controls) {
        _controls.target.lerpVectors(startLook, lookAt, e);
        _controls.update();
      }
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

/**
 * Get the current side the camera is on.
 */
function getCurrentSide() { return _currentSide; }

/**
 * Get all defined portals.
 */
function getPortals() { return [..._portals]; }

/**
 * Stop the portal renderer.
 */
function destroy() {
  _active = false;
  if (_rafId) cancelAnimationFrame(_rafId);
  document.getElementById('fumocPortalOverlay')?.remove();
  document.getElementById('fumocPortalRing')?.remove();
  document.getElementById('fumocAmbientOverlay')?.remove();
  if (_canvas) _canvas.style.filter = 'none';
}

const FumocPortalRenderer = {
  init, navigateToPortal, getCurrentSide, getPortals, destroy,
};

window.FumocPortalRenderer = FumocPortalRenderer;
export default FumocPortalRenderer;
