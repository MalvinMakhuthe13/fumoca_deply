/**
 * NIFGaussianAnimator — native animation tracks for Gaussian records.
 *
 * Tracks address splats by stable IDs, not transient render/sort order.
 * Each keyframe may animate position, log-scale and quaternion; opacity and
 * colour/SH payload remain byte-for-byte copied from the base Gaussian data.
 *
 * Record layout: [px,py,pz,sx,sy,sz,qw,qx,qy,qz,opacity,r,g,b] (14 Float32s).
 * Scale values are the renderer's stored log-scales, not world-space radii.
 *
 * This is the runtime evaluator. It deliberately does not claim that a NIF
 * file can persist these tracks yet; NIF chunk/version support is a separate
 * backwards-compatibility task.
 */
const STRIDE = 14;
const EPS = 1e-8;
const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const finite4 = v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite);
const normalizeQuat = q => {
  const n = Math.hypot(...q);
  if (n < EPS) throw new Error('Animation quaternion must be non-zero');
  return q.map(x => x / n);
};
function slerp(a, b, t) {
  let cos = a.reduce((s, x, i) => s + x * b[i], 0);
  let end = b;
  if (cos < 0) { cos = -cos; end = b.map(x => -x); }
  if (cos > 0.9995) return normalizeQuat(a.map((x, i) => x + (end[i] - x) * t));
  const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return a.map((x, i) => x * wa + end[i] * wb);
}
const lerp3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

function sample(keys, time, field, fallback) {
  const available = keys.filter(k => k[field] != null);
  if (!available.length) return fallback;
  if (time <= available[0].time) return available[0][field];
  const last = available[available.length - 1];
  if (time >= last.time) return last[field];
  let hi = 1;
  while (available[hi].time < time) hi++;
  const a = available[hi - 1], b = available[hi];
  const t = (time - a.time) / (b.time - a.time);
  return field === 'rotation' ? slerp(a[field], b[field], t) : lerp3(a[field], b[field], t);
}

export class NIFGaussianAnimator {
  constructor(gaussians, tracks, stableIds = null) {
    if (!(gaussians?.data instanceof Float32Array) || gaussians.data.length % STRIDE) {
      throw new TypeError('gaussians.data must be Float32Array records of 14 floats');
    }
    this.gaussians = gaussians;
    this.base = gaussians.data.slice();
    this.output = new Float32Array(this.base.length);
    this.count = this.base.length / STRIDE;
    this.ids = stableIds ?? Uint32Array.from({ length: this.count }, (_, i) => i);
    if (!(this.ids instanceof Uint32Array) || this.ids.length !== this.count) {
      throw new TypeError('stableIds must be a Uint32Array with one ID per Gaussian');
    }
    this.indexById = new Map();
    for (let i = 0; i < this.ids.length; i++) {
      if (this.indexById.has(this.ids[i])) throw new Error(`Duplicate stable Gaussian ID: ${this.ids[i]}`);
      this.indexById.set(this.ids[i], i);
    }
    if (!Array.isArray(tracks)) throw new TypeError('tracks must be an array');
    this.tracks = tracks.map(track => {
      if (!this.indexById.has(track?.id)) throw new Error(`Unknown Gaussian ID: ${track?.id}`);
      if (!Array.isArray(track.keyframes) || !track.keyframes.length) throw new Error('Each track needs keyframes');
      let previous = -Infinity;
      const keys = track.keyframes.map(key => {
        if (!Number.isFinite(key.time) || key.time < 0 || key.time <= previous) {
          throw new Error('Keyframe times must be finite, non-negative and strictly increasing');
        }
        previous = key.time;
        const out = { time: key.time };
        if (key.position != null) {
          if (!finite3(key.position)) throw new Error('position must be a finite xyz triple');
          out.position = key.position.slice();
        }
        if (key.scale != null) {
          if (!finite3(key.scale)) throw new Error('scale must be a finite xyz triple');
          out.scale = key.scale.slice();
        }
        if (key.rotation != null) {
          if (!finite4(key.rotation)) throw new Error('rotation must be a finite wxyz quaternion');
          out.rotation = normalizeQuat(key.rotation);
        }
        return out;
      });
      if (!keys.some(k => k.position || k.scale || k.rotation)) throw new Error('Track has no animated properties');
      return { index: this.indexById.get(track.id), keys };
    });
  }

  evaluate(time) {
    if (!Number.isFinite(time) || time < 0) throw new RangeError('Animation time must be finite and non-negative');
    this.output.set(this.base);
    for (const track of this.tracks) {
      const o = track.index * STRIDE, keys = track.keys;
      const p = sample(keys, time, 'position', this.base.slice(o, o + 3));
      const s = sample(keys, time, 'scale', this.base.slice(o + 3, o + 6));
      const q = sample(keys, time, 'rotation', this.base.slice(o + 6, o + 10));
      this.output.set(p, o);
      this.output.set(s, o + 3);
      this.output.set(q, o + 6);
    }
    this.gaussians.data = this.output;
    return this.output;
  }

  reset() {
    this.output.set(this.base);
    this.gaussians.data = this.output;
    return this.output;
  }
}
