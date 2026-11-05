/**
 * FUMOCA Adaptive Presentation Engine (APE)
 *
 * Phase 1: responsive stage measurement and camera-aspect synchronization.
 * This module deliberately does not touch Gaussian data, renderer internals,
 * reconstruction jobs, camera pose, or user interaction controls.
 *
 * It observes the actual viewer container (not the browser window), which is
 * essential for embedded viewers, split layouts, and responsive product pages.
 */
const APE_VERSION = '0.1.0';

const stage = document.getElementById('stage');
const getHost = () => document.getElementById('stageHost') || stage;
const params = new URLSearchParams(window.location.search);

const state = {
  version: APE_VERSION,
  width: 0,
  height: 0,
  aspect: 0,
  mode: params.get('embed') === '1' ? 'embed' : (params.get('public') === '1' ? 'public' : 'viewer'),
  camera: null,
  controls: null,
  observer: null,
  lastResizeAt: 0,
};

function syncCameraAspect() {
  const camera = state.camera || window._fumocaViewerCamera;
  if (!camera || !state.aspect || !Number.isFinite(state.aspect)) return;
  if (Math.abs((camera.aspect || 0) - state.aspect) < 0.0001) return;
  camera.aspect = state.aspect;
  camera.updateProjectionMatrix?.();
}

function measure() {
  const host = getHost();
  if (!host) return;

  const rect = host.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 2 || height < 2) return;

  const changed = width !== state.width || height !== state.height;
  state.width = width;
  state.height = height;
  state.aspect = width / height;
  state.lastResizeAt = performance.now();

  // Keep the stage and render surfaces constrained by their real embed box.
  // Renderer-specific ResizeObservers remain responsible for backing buffers.
  host.style.minWidth = '0';
  host.style.maxWidth = '100%';
  host.style.boxSizing = 'border-box';

  host.querySelectorAll('canvas').forEach((canvas) => {
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
  });

  syncCameraAspect();

  if (changed) {
    window.dispatchEvent(new CustomEvent('fumoca:presentationResize', {
      detail: {
        width: state.width,
        height: state.height,
        aspect: state.aspect,
        mode: state.mode,
        version: APE_VERSION,
      },
    }));
  }
}

function attachCamera(event) {
  const detail = event?.detail || {};
  if (detail.camera) state.camera = detail.camera;
  if (detail.controls) state.controls = detail.controls;
  syncCameraAspect();
}

function start() {
  if (!stage) {
    console.warn('[FUMOCA APE] Viewer stage not found; engine not attached.');
    return;
  }

  const host = getHost();
  if (typeof ResizeObserver !== 'undefined') {
    state.observer = new ResizeObserver(measure);
    state.observer.observe(host);
    if (stage !== host) state.observer.observe(stage);
  }

  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('fumoca:viewerReady', attachCamera);
  window.addEventListener('fumoca:recordLoaded', measure);
  window.addEventListener('orientationchange', () => requestAnimationFrame(measure), { passive: true });

  // Viewer renderers can mount after this module; attach to their ready event.
  if (window._fumocaViewerCamera) state.camera = window._fumocaViewerCamera;
  if (window._fumocaViewerControls) state.controls = window._fumocaViewerControls;

  requestAnimationFrame(measure);
}

window.FumocaPresentation = Object.freeze({
  version: APE_VERSION,
  getState: () => ({
    version: state.version,
    width: state.width,
    height: state.height,
    aspect: state.aspect,
    mode: state.mode,
  }),
  refresh: measure,
});

start();
console.info('[FUMOCA APE] Responsive presentation layer ready', APE_VERSION);
