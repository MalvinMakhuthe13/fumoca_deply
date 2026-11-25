/**
 * Gentle camera motion for living photos (Studio preview and public viewer).
 * Moves the camera a little around its resting view while it keeps looking
 * at the same target, which is what makes a one-photo scene feel 3D.
 * Stops as soon as someone touches the view and resumes after they let go.
 */
import { motionAt, normalizeLivingState } from './living-photo.js';

export class LivingMotion {
  constructor(THREE, camera, controls, state) {
    this.THREE = THREE; this.camera = camera; this.controls = controls;
    this.state = normalizeLivingState(state) || { enabled: true, motion: 'drift', amount: 0.5, period: 8 };
    this.t = 0; this.raf = 0; this.running = false; this.paused = false; this.resumeTimer = 0;
    this._onStart = () => this.pause();
    this._onEnd = () => { clearTimeout(this.resumeTimer); this.resumeTimer = setTimeout(() => this.resume(), 3500); };
    controls?.addEventListener?.('start', this._onStart);
    controls?.addEventListener?.('end', this._onEnd);
  }

  captureRest() {
    const { THREE, camera, controls } = this;
    this.restPos = camera.position.clone();
    this.target = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
    const fwd = this.target.clone().sub(this.restPos);
    this.dist = fwd.length() || 1;
    fwd.normalize();
    const up = camera.up.clone().normalize();
    this.right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    this.up = new THREE.Vector3().crossVectors(this.right, fwd).normalize();
    this.fwd = fwd;
  }

  setState(state) {
    const s = normalizeLivingState(state);
    if (s) this.state = s;
  }

  apply() {
    const o = motionAt(this.state.motion, this.t, { amount: this.state.amount, period: this.state.period });
    const d = this.dist;
    const p = this.restPos.clone()
      .addScaledVector(this.right, o.x * d)
      .addScaledVector(this.up, o.y * d)
      .addScaledVector(this.fwd, -o.z * d);
    this.camera.position.copy(p);
    this.camera.lookAt(this.target);
    this.controls?.update?.();
  }

  start() {
    if (this.running) return;
    this.captureRest();
    this.running = true; this.paused = false;
    let last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (this.paused) return;
      this.t += dt;
      this.apply();
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    clearTimeout(this.resumeTimer);
  }

  resume() {
    if (!this.running) return;
    this.captureRest();       // continue from wherever the person left the view
    this.t = 0;
    this.paused = false;
  }

  stop({ restore = true } = {}) {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.resumeTimer);
    if (restore && this.restPos && !this.paused) {
      this.camera.position.copy(this.restPos);
      this.camera.lookAt(this.target);
      this.controls?.update?.();
    }
  }

  dispose() {
    this.stop({ restore: false });
    this.controls?.removeEventListener?.('start', this._onStart);
    this.controls?.removeEventListener?.('end', this._onEnd);
  }
}

/**
 * Put the camera where the photo was taken from, close enough that the photo
 * fills the screen ("cover") with a small margin for the drift.
 * view = { near, range, fovY, aspect } in the splat's own coordinates.
 */
export function frameLivingPhoto(THREE, camera, controls, mesh, view) {
  if (!camera || !mesh || !view) return false;
  const near = Number(view.near) || 1, range = Number(view.range) || 0.5;
  const fovY = (Number(view.fovY) || 45) * Math.PI / 180, aspectP = Number(view.aspect) || 4 / 3;
  const tanPv = Math.tan(fovY / 2), tanPh = tanPv * aspectP;
  const F = (camera.fov || 50) * Math.PI / 180, aspectC = camera.aspect || 16 / 9;
  const tanCv = Math.tan(F / 2), tanCh = tanCv * aspectC;
  const D = Math.min(tanPv / tanCv, tanPh / tanCh) * near * 0.9;
  mesh.updateMatrixWorld?.(true);
  const pos = mesh.localToWorld(new THREE.Vector3(0, 0, -near + D));
  const target = mesh.localToWorld(new THREE.Vector3(0, 0, -(near + range * 0.5)));
  camera.position.copy(pos);
  if (controls?.target) controls.target.copy(target);
  camera.lookAt(target);
  camera.updateProjectionMatrix?.();
  controls?.update?.();
  return true;
}

/** Public viewer: start the saved motion on the published scene. */
export function startLivingMotionOnViewer(THREE, saved) {
  const state = normalizeLivingState(saved);
  const camera = window._fumocaViewerCamera, controls = window._fumocaViewerControls;
  if (!state || !camera) return null;
  if (saved?.view && window._fumocaPublishedSparkMesh) {
    frameLivingPhoto(THREE, camera, controls, window._fumocaPublishedSparkMesh, saved.view);
  }
  const m = new LivingMotion(THREE, camera, controls, state);
  m.start();
  return m;
}
