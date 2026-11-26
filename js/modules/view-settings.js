/**
 * How a published splat is viewed — for websites and embeds.
 *
 *   startView   exact camera position / target / up saved from Studio
 *   zoom        closest and farthest zoom as multiples of the start
 *               distance (no more endless zoom into or away from the model)
 *   lockZoom / lockRotate / allowPan
 *   fixed       nothing moves unless spin is on: a steady view for websites
 *   spin        turntable speed in degrees per second (0 = off), pauses
 *               while someone drags and resumes after they let go
 *
 * Works with OrbitControls and TrackballControls. URL parameters override
 * saved settings for embeds: ?spin=12&lock=1&zoomMin=0.6&zoomMax=2.5&fixed=1
 */

const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, +v)) : d);
const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.map(Number) : null);

export const DEFAULT_VIEW = Object.freeze({
  version: 1, startView: null, zoomMin: 0.35, zoomMax: 3, lockZoom: false, lockRotate: false,
  allowPan: false, fixed: false, spin: 0,
});

export function normalizeViewSettings(input) {
  if (!input || typeof input !== 'object') return null;
  const sv = input.startView;
  const startView = sv && vec(sv.position) && vec(sv.target)
    ? { position: vec(sv.position), target: vec(sv.target), up: vec(sv.up) || [0, 1, 0], fov: num(sv.fov, 10, 120, null) }
    : null;
  let zoomMin = num(input.zoomMin, 0.02, 1, DEFAULT_VIEW.zoomMin);
  let zoomMax = num(input.zoomMax, 1, 50, DEFAULT_VIEW.zoomMax);
  if (zoomMin > zoomMax) [zoomMin, zoomMax] = [zoomMax, zoomMin];
  return {
    version: 1, startView, zoomMin, zoomMax,
    lockZoom: !!input.lockZoom, lockRotate: !!input.lockRotate, allowPan: !!input.allowPan,
    fixed: !!input.fixed, spin: num(input.spin, -180, 180, 0),
  };
}

/** Embed / website overrides from the page URL. */
export function viewSettingsFromUrl(search, base = null) {
  const q = new URLSearchParams(search || '');
  const keys = ['spin', 'lock', 'fixed', 'zoomMin', 'zoomMax', 'pan', 'lockZoom', 'lockRotate'];
  if (!keys.some(k => q.has(k))) return base;
  const out = { ...(base || DEFAULT_VIEW) };
  if (q.has('spin')) out.spin = +q.get('spin');
  if (q.has('zoomMin')) out.zoomMin = +q.get('zoomMin');
  if (q.has('zoomMax')) out.zoomMax = +q.get('zoomMax');
  const flag = (k) => ['1', 'true', 'yes', ''].includes(String(q.get(k)).toLowerCase());
  if (q.has('lock')) { out.lockZoom = out.lockRotate = flag('lock'); }
  if (q.has('lockZoom')) out.lockZoom = flag('lockZoom');
  if (q.has('lockRotate')) out.lockRotate = flag('lockRotate');
  if (q.has('pan')) out.allowPan = flag('pan');
  if (q.has('fixed')) out.fixed = flag('fixed');
  return normalizeViewSettings(out);
}

export function captureView(camera, controls) {
  const t = controls?.target || { x: 0, y: 0, z: 0 };
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [t.x, t.y, t.z],
    up: [camera.up.x, camera.up.y, camera.up.z],
    fov: camera.fov,
  };
}

function setControlFlags(controls, s) {
  const zoomOn = !(s.lockZoom || s.fixed), rotateOn = !(s.lockRotate || s.fixed), panOn = s.allowPan && !s.fixed;
  if ('enableZoom' in controls) controls.enableZoom = zoomOn;
  if ('enableRotate' in controls) controls.enableRotate = rotateOn;
  if ('enablePan' in controls) controls.enablePan = panOn;
  if ('noZoom' in controls) controls.noZoom = !zoomOn;
  if ('noRotate' in controls) controls.noRotate = !rotateOn;
  if ('noPan' in controls) controls.noPan = !panOn;
  if ('noRoll' in controls) controls.noRoll = !rotateOn;
}

export class ViewController {
  constructor(THREE, camera, controls, settings, { domElement = null } = {}) {
    this.THREE = THREE; this.camera = camera; this.controls = controls;
    this.dom = domElement || controls?.domElement || null;
    this.s = normalizeViewSettings(settings) || { ...DEFAULT_VIEW };
    this.raf = 0; this.idleUntil = 0;
    this._down = () => { this.idleUntil = Infinity; };
    this._up = () => { this.idleUntil = performance.now() + 2500; };
    this.dom?.addEventListener?.('pointerdown', this._down);
    this.dom?.addEventListener?.('wheel', this._up, { passive: true });
    globalThis.addEventListener?.('pointerup', this._up);
  }

  apply() {
    const { camera, controls, s, THREE } = this;
    if (!camera || !controls) return false;
    if (s.startView) {
      camera.position.set(...s.startView.position);
      camera.up.set(...s.startView.up);
      controls.target?.set?.(...s.startView.target);
      if (s.startView.fov && camera.fov !== undefined) { camera.fov = s.startView.fov; camera.updateProjectionMatrix?.(); }
      camera.lookAt(new THREE.Vector3(...s.startView.target));
    }
    const target = controls.target || new THREE.Vector3();
    const dist = camera.position.distanceTo(target) || 1;
    this.startDistance = dist;
    controls.minDistance = dist * s.zoomMin;
    controls.maxDistance = dist * s.zoomMax;
    setControlFlags(controls, s);
    controls.update?.();
    // keep other code from undoing the framing / limits (see viewer fitSubjectInView)
    globalThis._fumocaViewSettings = { ...s, minDistance: controls.minDistance, maxDistance: controls.maxDistance };
    this.startSpin();
    return true;
  }

  startSpin() {
    cancelAnimationFrame(this.raf);
    if (!this.s.spin) return;
    const { THREE } = this;
    const axis = new THREE.Vector3(), offset = new THREE.Vector3();
    let last = performance.now();
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (now < this.idleUntil) return;
      const target = this.controls.target;
      axis.copy(this.camera.up).normalize();
      offset.copy(this.camera.position).sub(target).applyAxisAngle(axis, (this.s.spin * Math.PI / 180) * dt);
      this.camera.position.copy(target).add(offset);
      this.camera.lookAt(target);
    };
    this.raf = requestAnimationFrame(tick);
  }

  update(settings) {
    this.s = normalizeViewSettings(settings) || this.s;
    this.apply();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.dom?.removeEventListener?.('pointerdown', this._down);
    this.dom?.removeEventListener?.('wheel', this._up);
    globalThis.removeEventListener?.('pointerup', this._up);
  }
}
