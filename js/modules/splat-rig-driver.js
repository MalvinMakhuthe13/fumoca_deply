/**
 * Drives a Spark SplatMesh from a splat rig (Studio and public viewer).
 *
 * The rest state is read from the mesh itself (forEachSplat) so the rig works
 * on whatever Spark is showing, and each frame only splats bound to bones
 * that actually moved are rewritten with setSplat. CPU only.
 *
 * Coordinates: bones live in the mesh's local space. `rig.frame` is the
 * rotation from local space to an upright frame (y up) used to fit templates
 * and to express poses, so presets like "walk" swing the right way however
 * the scan is oriented.
 */
import { computeWeights, solvePose, skin, sampleClip, sampleRoot, normalizeRig, normalizeClip, qMul, qNormalize, rigFromTemplate } from './splat-rig.js';

const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
function rotVec(q, v) { // q * v * q^-1
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Read rest data out of a Spark mesh. Returns plain typed arrays. */
export function readRest(mesh) {
  const splats = mesh?.packedSplats || mesh?.splats;
  if (!splats?.forEachSplat) return null;
  const n = splats.numSplats ?? splats.count ?? 0;
  let cap = n > 0 ? n : 1024;
  let positions = new Float32Array(cap * 3), rotations = new Float32Array(cap * 4), scales = new Float32Array(cap * 3);
  let opacity = new Float32Array(cap), colors = new Float32Array(cap * 3);
  let count = 0;
  const grow = () => {
    cap *= 2;
    const g = (a, k) => { const b = new Float32Array(cap * k); b.set(a); return b; };
    positions = g(positions, 3); rotations = g(rotations, 4); scales = g(scales, 3); opacity = g(opacity, 1); colors = g(colors, 3);
  };
  splats.forEachSplat((index, center, scale, quat, alpha, color) => {
    while (index >= cap) grow();
    positions[index * 3] = center.x; positions[index * 3 + 1] = center.y; positions[index * 3 + 2] = center.z;
    // Gaussian rotation kept as [w,x,y,z] (FUMOCA / PLY order)
    rotations[index * 4] = quat?.w ?? 1; rotations[index * 4 + 1] = quat?.x ?? 0; rotations[index * 4 + 2] = quat?.y ?? 0; rotations[index * 4 + 3] = quat?.z ?? 0;
    scales[index * 3] = scale?.x ?? 0.01; scales[index * 3 + 1] = scale?.y ?? 0.01; scales[index * 3 + 2] = scale?.z ?? 0.01;
    opacity[index] = alpha ?? 1;
    colors[index * 3] = color?.r ?? 1; colors[index * 3 + 1] = color?.g ?? 1; colors[index * 3 + 2] = color?.b ?? 1;
    if (index + 1 > count) count = index + 1;
  });
  if (!count) return null;
  return { count, positions, rotations, scales, opacity, colors };
}

/** Rotation part of an object's world matrix as [x,y,z,w] (local → world). */
export function uprightFrame(THREE, mesh) {
  if (!mesh?.matrixWorld || !THREE) return [0, 0, 0, 1];
  mesh.updateMatrixWorld?.(true);
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  mesh.matrixWorld.decompose(p, q, s);
  return qNormalize([q.x, q.y, q.z, q.w]);
}

/** Fit a template rig to rest points, using an upright frame for proportions. */
export function fitTemplate(name, rest, frame = [0, 0, 0, 1]) {
  // robust 2–98% bounds in the upright frame
  const n = rest.count, step = Math.max(1, Math.floor(n / 60000));
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < n; i += step) {
    const p = rotVec(frame, [rest.positions[i * 3], rest.positions[i * 3 + 1], rest.positions[i * 3 + 2]]);
    xs.push(p[0]); ys.push(p[1]); zs.push(p[2]);
  }
  const q = (a, f) => { a.sort((u, v) => u - v); return a[Math.min(a.length - 1, Math.floor(f * a.length))]; };
  const bounds = { min: [q(xs, 0.02), q(ys, 0.02), q(zs, 0.02)], max: [q(xs, 0.98), q(ys, 0.98), q(zs, 0.98)] };
  const rig = rigFromTemplate(name, bounds);
  const inv = conj(frame);
  rig.bones.forEach(b => { b.head = rotVec(inv, b.head); b.tail = rotVec(inv, b.tail); });
  rig.frame = frame;
  return rig;
}

/** Convert an upright-frame pose to local space: q_local = F⁻¹ q F. */
export function poseToLocal(pose, frame) {
  if (!frame || (frame[0] === 0 && frame[1] === 0 && frame[2] === 0)) return pose;
  const inv = conj(frame), out = {};
  for (const [k, q] of Object.entries(pose)) out[k] = k.startsWith('__') ? q : qMul(qMul(inv, q), frame);
  return out;
}

export function normalizeRigState(input) {
  if (!input || typeof input !== 'object') return null;
  const rig = normalizeRig(input.rig);
  if (!rig) return null;
  const f = input.rig?.frame;
  rig.frame = Array.isArray(f) && f.length === 4 && f.every(Number.isFinite) ? qNormalize(f) : [0, 0, 0, 1];
  const clip = input.clip ? normalizeClip(input.clip, rig) : null;
  const speed = Math.min(4, Math.max(0.1, Number(input.speed) || 1));
  return { version: 1, rig, clip, speed, autoplay: input.autoplay !== false && !!clip, ground: input.ground !== false, splatCount: Number.isInteger(input.splatCount) ? input.splatCount : null };
}

export class SplatRigDriver {
  constructor(THREE, mesh, rig, { rest = null } = {}) {
    this.THREE = THREE; this.mesh = mesh; this.rig = rig;
    this.rest = rest || readRest(mesh);
    if (!this.rest) throw new Error('This splat cannot be read for rigging yet.');
    this.weights = computeWeights(this.rest.positions, this.rest.count, rig);
    this.out = { positions: new Float32Array(this.rest.count * 3), rotations: new Float32Array(this.rest.count * 4) };
    this.prevMats = null;
    this._v = { c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), col: new THREE.Color() };
    this.clip = null; this.speed = 1; this.time = 0; this.playing = false; this._raf = 0; this._last = 0;
    this.manualPose = {};
    this.manualRoot = [0, 0, 0];       // whole-object offset (upright frame)
    this.groundCollision = false;      // keep the posed splat from sinking through the floor
    this.lastFrameMs = 0;
    // a small sample for fast floor checks
    const n = this.rest.count, step = Math.max(1, Math.floor(n / 3000));
    this._probe = [];
    for (let i = 0; i < n; i += step) this._probe.push(i);
    const f = this.rig.frame || [0, 0, 0, 1];
    this._restFloor = Math.min(...this._probe.map(i => rotVec(f, [this.rest.positions[i * 3], this.rest.positions[i * 3 + 1], this.rest.positions[i * 3 + 2]])[1]));
  }

  /** Lowest point (upright frame) of the probe splats under a solved pose. */
  _posedFloor(solved) {
    const f = this.rig.frame || [0, 0, 0, 1], W = this.weights, P = this.rest.positions;
    let min = Infinity;
    for (const i of this._probe) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) {
        const w = W.weights[i * 4 + k]; if (!w) continue;
        const m = solved.mats[W.indices[i * 4 + k]];
        const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
        x += w * (m[0] * px + m[1] * py + m[2] * pz + m[9]);
        y += w * (m[3] * px + m[4] * py + m[5] * pz + m[10]);
        z += w * (m[6] * px + m[7] * py + m[8] * pz + m[11]);
      }
      const up = rotVec(f, [x, y, z])[1];
      if (up < min) min = up;
    }
    return min;
  }

  /** Apply a pose given in the upright frame. Returns number of splats rewritten. */
  applyPose(pose = {}) {
    const t0 = performance.now();
    const local = poseToLocal(pose, this.rig.frame);
    const f = this.rig.frame || [0, 0, 0, 1], inv = conj(f);
    const rootUp = (pose.__root || [0, 0, 0]).map((v, i) => v + this.manualRoot[i]);
    let solved = solvePose(this.rig, local, rotVec(inv, rootUp));
    if (this.groundCollision) {
      const lift = this._restFloor - this._posedFloor(solved);
      // only push up out of the floor; jumps (root above ground) are left alone
      if (lift > 1e-6) solved = solvePose(this.rig, local, rotVec(inv, [rootUp[0], rootUp[1] + lift, rootUp[2]]));
      this.lastLift = Math.max(0, lift);
    }
    const B = this.rig.bones.length;
    const changed = new Uint8Array(B);
    let any = false;
    for (let b = 0; b < B; b++) {
      const m = solved.mats[b], p = this.prevMats?.[b];
      if (!p) { changed[b] = 1; any = true; continue; }
      for (let k = 0; k < 12; k++) if (Math.abs(m[k] - p[k]) > 1e-7) { changed[b] = 1; any = true; break; }
    }
    this.prevMats = solved.mats;
    if (!any) return 0;
    skin(this.rest, this.rest.count, this.weights, solved, this.out);
    const splats = this.mesh.packedSplats || this.mesh.splats;
    if (!splats?.setSplat) throw new Error('This Spark build cannot update splats in place.');
    const { c, s, q, col } = this._v, r = this.rest, o = this.out, W = this.weights;
    // If the splat is lit (Look tab), keep writing the lit colours.
    const lit = globalThis._fumocaLightingByMesh?.get?.(this.mesh);
    const C = lit?.settings?.enabled && lit.lit?.length === r.colors.length ? lit.lit : r.colors;
    let written = 0;
    for (let i = 0; i < r.count; i++) {
      const j = i * 4;
      if (!(changed[W.indices[j]] && W.weights[j]) && !(changed[W.indices[j + 1]] && W.weights[j + 1]) &&
          !(changed[W.indices[j + 2]] && W.weights[j + 2]) && !(changed[W.indices[j + 3]] && W.weights[j + 3])) continue;
      c.set(o.positions[i * 3], o.positions[i * 3 + 1], o.positions[i * 3 + 2]);
      s.set(r.scales[i * 3], r.scales[i * 3 + 1], r.scales[i * 3 + 2]);
      q.set(o.rotations[j + 1], o.rotations[j + 2], o.rotations[j + 3], o.rotations[j]);
      col.setRGB(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      splats.setSplat(i, c, s, q, r.opacity[i], col);
      written++;
    }
    if (written) {
      splats.needsUpdate = true;
      this.mesh.needsUpdate = true;
      this.mesh.updateVersion?.();
    }
    this.lastFrameMs = performance.now() - t0;
    return written;
  }

  setClip(clip, speed = 1) { this.clip = clip; this.speed = speed; }

  play() {
    if (this.playing || !this.clip) return;
    this.playing = true; this._last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this._last) / 1000);
      // Big scans: don't try to rewrite every frame if a frame costs more than the budget.
      if (this.lastFrameMs > 24 && now - this._last < this.lastFrameMs * 1.5) return;
      this._last = now;
      this.time += dt * this.speed;
      try { this.applyPose({ ...sampleClip(this.clip, this.time), ...this.manualPose, __root: sampleRoot(this.clip, this.time) }); }
      catch (e) { this.stop(); console.warn('[FUMOCA] rig playback stopped', e); this.onError?.(e); }
      this.onFrame?.(this.time);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() { this.playing = false; cancelAnimationFrame(this._raf); }

  /** Put every splat back exactly where it was. */
  reset() {
    this.stop();
    this.prevMats = null;
    this.applyPose({});
    this.prevMats = null;
  }

  dispose() { try { this.reset(); } catch (_) {} this.rest = null; this.out = null; }
}

/** Public viewer: restore a saved rig + clip and loop it. */
export async function restoreRigOnViewer(THREE, mesh, saved) {
  const state = normalizeRigState(saved);
  if (!state?.clip || !mesh) return null;
  if (mesh.initialized) await mesh.initialized;
  const driver = new SplatRigDriver(THREE, mesh, state.rig);
  // Weights are recomputed from this mesh's own splats, so a re-ordered or
  // re-compressed published copy still follows the same bones.
  driver.setClip(state.clip, state.speed);
  driver.groundCollision = state.ground;
  if (state.autoplay) driver.play();
  return driver;
}
