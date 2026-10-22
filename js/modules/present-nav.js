/**
 * FUMOCA Present — Matterport-style navigation hotspots
 * ─────────────────────────────────────────────────────
 * Numbered discs + labels that fly the camera in with a sensible
 * approach path (not a hard cut). Works with existing hotspot-pro
 * world anchors (wx,wy,wz) and camera-engine when available.
 *
 * Usage:
 *   import { initPresentNav, setNavStops, flyToStop } from './present-nav.js';
 *   initPresentNav({ onArrive });
 *   setNavStops([{ id, label, wx, wy, wz, zoom, lookAt }]);
 */

import * as THREE from 'three';

const DEFAULT_DURATION = 1100;
let stops = [];
let activeId = null;
let layer = null;
let animating = false;
let onArrive = null;
let onChange = null;
let rafProj = 0;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getCamera() {
  return window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera;
}

function getControls() {
  return window._fumocaViewerControls || window._fumocaViewer?.controls || window._fumocaControls;
}

function ensureLayer() {
  if (layer) return layer;
  layer = document.getElementById('presentNavLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'presentNavLayer';
    layer.className = 'pn-layer';
    const host =
      document.getElementById('stage') ||
      document.getElementById('viewport') ||
      document.getElementById('stageHost') ||
      document.body;
    host.appendChild(layer);
  }
  return layer;
}

function project(wx, wy, wz) {
  const cam = getCamera();
  if (!cam) return null;
  try {
    cam.updateMatrixWorld?.(true);
    const v = new THREE.Vector3(+wx, +wy, +wz).project(cam);
    if (v.z > 1) return { behind: true };
    return {
      x: (v.x * 0.5 + 0.5) * 100,
      y: (-v.y * 0.5 + 0.5) * 100,
      behind: false,
    };
  } catch {
    return null;
  }
}

/**
 * Matterport-like approach:
 * 1) Soft pan target toward hotspot
 * 2) Move camera along view ray closer (zoom feel)
 * 3) Optional slight rise for "walk in"
 */
export function flyToStop(stop, opts = {}) {
  if (!stop || animating) return Promise.resolve(false);

  // Prefer camera-engine if host provides a full path system
  try {
    if (window._fumocaCameraEngine?.flyToHotspot) {
      const ok = window._fumocaCameraEngine.flyToHotspot({
        ...stop,
        zoom: stop.zoom || 1.25,
        flyOnActivate: true,
      });
      if (ok) {
        activeId = stop.id;
        markActive();
        onArrive?.(stop);
        return Promise.resolve(true);
      }
    }
  } catch (_) {}

  const cam = getCamera();
  const controls = getControls();
  if (!cam || !controls) return Promise.resolve(false);
  if (![stop.wx, stop.wy, stop.wz].every((n) => Number.isFinite(n))) {
    return Promise.resolve(false);
  }

  animating = true;
  activeId = stop.id;
  markActive();

  const target = new THREE.Vector3(stop.wx, stop.wy, stop.wz);
  const startPos = cam.position.clone();
  const startTarget = controls.target?.clone?.() || new THREE.Vector3();
  const zoom = Math.max(1.05, Math.min(2.2, stop.zoom || 1.35));

  // Keep current viewing direction, shorten distance for "zoom in"
  const viewDir = startPos.clone().sub(startTarget).normalize();
  const startDist = Math.max(0.4, startPos.distanceTo(startTarget));
  const endDist = Math.max(0.28, startDist / zoom);

  // Optional lookAt override
  const endTarget = stop.lookAt
    ? new THREE.Vector3(stop.lookAt[0], stop.lookAt[1], stop.lookAt[2])
    : target.clone();

  // Approach slightly from above for a natural walk-in
  const rise = stop.rise != null ? stop.rise : Math.min(0.35, endDist * 0.08);
  const endPos = endTarget
    .clone()
    .add(viewDir.clone().multiplyScalar(endDist))
    .add(new THREE.Vector3(0, rise, 0));

  // Mid-point: move target first, then close in (feels less like a zoom punch)
  const midTarget = startTarget.clone().lerp(endTarget, 0.55);
  const midPos = startPos.clone().lerp(endPos, 0.4);

  const duration = opts.duration || stop.duration || DEFAULT_DURATION;
  const t0 = performance.now();

  return new Promise((resolve) => {
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = easeInOutCubic(p);

      // Two-segment ease: 0–0.45 target bias, 0.45–1 approach
      if (e < 0.45) {
        const u = e / 0.45;
        cam.position.lerpVectors(startPos, midPos, u);
        if (controls.target?.lerpVectors) {
          controls.target.lerpVectors(startTarget, midTarget, u);
        }
      } else {
        const u = (e - 0.45) / 0.55;
        cam.position.lerpVectors(midPos, endPos, u);
        if (controls.target?.lerpVectors) {
          controls.target.lerpVectors(midTarget, endTarget, u);
        }
      }

      if (typeof stop.fov === 'number' && cam.fov != null) {
        cam.fov = THREE.MathUtils.lerp(cam.fov, stop.fov, 0.08);
        cam.updateProjectionMatrix?.();
      }

      controls.update?.();

      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        animating = false;
        // Pulse label
        pulseLabel(stop.id);
        onArrive?.(stop);
        resolve(true);
      }
    };
    requestAnimationFrame(tick);
  });
}

function pulseLabel(id) {
  const el = layer?.querySelector(`[data-stop-id="${id}"]`);
  if (!el) return;
  el.classList.remove('pn-pulse');
  void el.offsetWidth;
  el.classList.add('pn-pulse');
}

function markActive() {
  if (!layer) return;
  layer.querySelectorAll('.pn-stop').forEach((el) => {
    el.classList.toggle('active', el.dataset.stopId === activeId);
  });
}

function buildMarker(stop, index) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pn-stop';
  el.dataset.stopId = stop.id;
  el.innerHTML = `
    <span class="pn-disc">${stop.number != null ? stop.number : index + 1}</span>
    <span class="pn-label">${escapeHtml(stop.label || 'View')}</span>
  `;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    flyToStop(stop);
  });
  return el;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rebuild() {
  const root = ensureLayer();
  root.innerHTML = '';
  stops.forEach((s, i) => root.appendChild(buildMarker(s, i)));
  markActive();
  projectLoop();
}

function projectLoop() {
  if (rafProj) return;
  const loop = () => {
    rafProj = 0;
    if (!layer) return;
    stops.forEach((stop) => {
      const el = layer.querySelector(`[data-stop-id="${stop.id}"]`);
      if (!el) return;
      if (Number.isFinite(stop.wx)) {
        const p = project(stop.wx, stop.wy, stop.wz);
        if (!p || p.behind) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          return;
        }
        el.style.left = p.x + '%';
        el.style.top = p.y + '%';
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      } else if (Number.isFinite(stop.sx)) {
        el.style.left = stop.sx + '%';
        el.style.top = stop.sy + '%';
        el.style.opacity = '1';
        el.style.pointerEvents = 'auto';
      }
    });
    rafProj = requestAnimationFrame(loop);
  };
  rafProj = requestAnimationFrame(loop);
}

export function initPresentNav(opts = {}) {
  onArrive = opts.onArrive || null;
  onChange = opts.onChange || null;
  ensureLayer();
  projectLoop();
  return api;
}

export function setNavStops(list = []) {
  stops = (list || []).map((s, i) => ({
    id: s.id || 'nav_' + Math.random().toString(36).slice(2, 8),
    label: s.label || `Stop ${i + 1}`,
    number: s.number != null ? s.number : i + 1,
    wx: s.wx,
    wy: s.wy,
    wz: s.wz,
    sx: s.sx,
    sy: s.sy,
    zoom: s.zoom,
    fov: s.fov,
    rise: s.rise,
    lookAt: s.lookAt,
    duration: s.duration,
  }));
  rebuild();
  onChange?.(exportStops());
}

export function addNavStop(partial = {}) {
  const stop = {
    id: partial.id || 'nav_' + Math.random().toString(36).slice(2, 8),
    label: partial.label || 'View',
    number: partial.number != null ? partial.number : stops.length + 1,
    wx: partial.wx,
    wy: partial.wy,
    wz: partial.wz,
    sx: partial.sx ?? 50,
    sy: partial.sy ?? 50,
    zoom: partial.zoom || 1.35,
    fov: partial.fov,
    rise: partial.rise,
    lookAt: partial.lookAt,
    duration: partial.duration,
  };
  stops.push(stop);
  rebuild();
  onChange?.(exportStops());
  return stop;
}

export function exportStops() {
  return stops.map((s) => ({ ...s }));
}

export function importStops(list) {
  setNavStops(list);
}

/** Convert hotspot-pro records that have fly intent into nav stops */
export function stopsFromHotspots(hotspots = []) {
  return (hotspots || [])
    .filter((h) => h.flyOnActivate !== false && (Number.isFinite(h.wx) || Number.isFinite(h.x)))
    .map((h, i) => ({
      id: h.id || 'hs_' + i,
      label: h.title || h.label || `Stop ${i + 1}`,
      number: i + 1,
      wx: h.wx,
      wy: h.wy,
      wz: h.wz,
      sx: h.x,
      sy: h.y,
      zoom: h.zoom || 1.3,
    }));
}

const api = {
  initPresentNav,
  setNavStops,
  addNavStop,
  flyToStop,
  exportStops,
  importStops,
  stopsFromHotspots,
};

export default api;

if (typeof window !== 'undefined') {
  window.FumocaPresentNav = api;
}
