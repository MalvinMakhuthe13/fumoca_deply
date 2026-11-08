/**
 * FUMOCA Adaptive Presentation Engine (APE)
 *
 * Phase 1: responsive stage measurement and camera-aspect synchronization.
 * Phase 2: named presentation profiles and aspect-aware subject framing.
 *
 * This layer does not modify Gaussian data, renderer internals, or reconstruction
 * jobs. It observes the actual viewer container for embedded and split layouts.
 */
const APE_VERSION = '0.2.0';

const stage = document.getElementById('stage');
const getHost = () => document.getElementById('stageHost') || stage;
const params = new URLSearchParams(window.location.search);

const PROFILE_PRESETS = Object.freeze({
  product: Object.freeze({ label: 'Product', padding: 1.12 }),
  automotive: Object.freeze({ label: 'Automotive', padding: 1.16 }),
  realEstate: Object.freeze({ label: 'Real Estate', padding: 1.22 }),
  portrait: Object.freeze({ label: 'Portrait', padding: 1.12 }),
  immersive: Object.freeze({ label: 'Immersive', padding: 1.04 }),
  default: Object.freeze({ label: 'Default', padding: 1.18 }),
});

function normalizeProfileName(name) {
  const value = String(name || 'default').trim();
  if (PROFILE_PRESETS[value]) return value;
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, '');
  return Object.keys(PROFILE_PRESETS).find((key) => key.toLowerCase() === normalized) || 'default';
}

function clampPadding(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(2.5, number)) : fallback;
}

const initialProfile = normalizeProfileName(params.get('profile'));
const state = {
  version: APE_VERSION,
  width: 0,
  height: 0,
  aspect: 0,
  mode: params.get('embed') === '1' ? 'embed' : (params.get('public') === '1' ? 'public' : 'viewer'),
  profileName: initialProfile,
  profile: { ...PROFILE_PRESETS[initialProfile] },
  camera: null,
  controls: null,
  observer: null,
  lastResizeAt: 0,
};

function syncCameraAspect() {
  const camera = window._fumocaViewerCamera || state.camera;
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
        profile: state.profileName,
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

  if (window._fumocaViewerCamera) state.camera = window._fumocaViewerCamera;
  if (window._fumocaViewerControls) state.controls = window._fumocaViewerControls;
  requestAnimationFrame(measure);
}

function setProfile(name, options = {}) {
  const profileName = normalizeProfileName(name);
  const preset = PROFILE_PRESETS[profileName];
  const previous = state.profileName;
  state.profileName = profileName;
  state.profile = {
    label: preset.label,
    padding: clampPadding(options.padding, preset.padding),
  };

  if (previous !== profileName || options.padding !== undefined) {
    window.dispatchEvent(new CustomEvent('fumoca:presentationProfileChange', {
      detail: { name: state.profileName, ...state.profile, version: APE_VERSION },
    }));
  }
  return getProfile();
}

function getProfile() {
  return { name: state.profileName, ...state.profile };
}

function fitSphere(center, radius, options = {}) {
  const camera = window._fumocaViewerCamera || state.camera;
  const controls = window._fumocaViewerControls || state.controls;
  if (!camera?.position || !controls?.target || !center) return false;

  const cx = Number(center.x), cy = Number(center.y), cz = Number(center.z);
  const r = Math.max(Number(radius) || 0, 0.0001);
  if (![cx, cy, cz, r].every(Number.isFinite)) return false;

  const host = getHost();
  const rect = host?.getBoundingClientRect?.();
  const aspect = Math.max(0.01, rect?.width && rect?.height ? rect.width / rect.height : state.aspect || camera.aspect || 1);
  const verticalFov = THREE_FOV(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const limitingFov = Math.max(0.01, Math.min(verticalFov, horizontalFov));
  const padding = clampPadding(options.padding, state.profile.padding);
  const distance = (r / Math.sin(limitingFov / 2)) * padding;

  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  let dx = px - cx, dy = py - cy, dz = pz - cz;
  let length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length < 1e-6) {
    dx = 0; dy = 0; dz = 1; length = 1;
  }
  const scale = distance / length;
  controls.target.set(cx, cy, cz);
  camera.position.set(cx + dx * scale, cy + dy * scale, cz + dz * scale);
  camera.lookAt?.(cx, cy, cz);
  camera.updateMatrixWorld?.(true);
  camera.updateProjectionMatrix?.();
  controls.update?.();

  window.dispatchEvent(new CustomEvent('fumoca:presentationFramed', {
    detail: {
      center: { x: cx, y: cy, z: cz },
      radius: r,
      distance,
      aspect,
      padding,
      profile: state.profileName,
      version: APE_VERSION,
    },
  }));
  return true;
}

function THREE_FOV(degrees) {
  const value = Number(degrees);
  return (Math.max(1, Math.min(179, Number.isFinite(value) ? value : 50)) * Math.PI) / 180;
}

window.FumocaPresentation = Object.freeze({
  version: APE_VERSION,
  getState: () => ({
    version: state.version,
    width: state.width,
    height: state.height,
    aspect: state.aspect,
    mode: state.mode,
    profile: getProfile(),
  }),
  getProfile,
  setProfile,
  getProfiles: () => Object.entries(PROFILE_PRESETS).map(([name, profile]) => ({ name, ...profile })),
  refresh: measure,
  fitSphere,
});

start();
console.info('[FUMOCA APE] Adaptive presentation layer ready', APE_VERSION, state.profileName);
