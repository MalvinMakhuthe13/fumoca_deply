/**
 * Free move — animate any area of a scan as you please, with no part to make
 * first. Drop a pin on the surface, drag or turn it, and the splats around it
 * follow with a soft falloff (a shoe tongue flexing, a strap swinging, a
 * cushion pressing in, a flag waving). Each pin keeps its own keyframes on a
 * shared timeline; "hold" pins keep an area still. CPU only, no AI.
 *
 * Writes in place to the live Spark mesh (setSplat), the same way moving
 * parts do, and plays in the published viewer.
 */
import { readRest, refreshRestGeometry } from './splat-rig-driver.js';
import { normalizeSoundFile, SOUNDS } from './part-animator.js';

const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(+x));
const clamp = (v, lo, hi, d) => (v !== null && v !== '' && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const LOOPS = ['once', 'loop', 'bounce'];
const MAX_PINS = 24, MAX_KEYS = 240;

function normalizeKey(k, duration) {
  if (!k || typeof k !== 'object') return null;
  return {
    t: clamp(k.t, 0, duration, 0),
    move: finite3(k.move) ? k.move.map(Number) : [0, 0, 0],
    turn: finite3(k.turn) ? k.turn.map(v => clamp(v, -720, 720, 0)) : [0, 0, 0],
  };
}

export function normalizePin(p, duration = 2) {
  if (!p || typeof p !== 'object' || !finite3(p.at)) return null;
  const keys = (Array.isArray(p.keys) ? p.keys : []).map(k => normalizeKey(k, duration)).filter(Boolean)
    .sort((a, b) => a.t - b.t).slice(0, MAX_KEYS);
  // one key per moment
  const uniq = [];
  for (const k of keys) if (!uniq.length || k.t - uniq[uniq.length - 1].t > 1e-4) uniq.push(k); else uniq[uniq.length - 1] = k;
  return {
    id: String(p.id || 'pin_' + Math.random().toString(36).slice(2, 8)).slice(0, 40),
    at: p.at.map(Number),
    radius: clamp(p.radius, 1e-5, 1e6, 0.1),
    soft: clamp(p.soft, 0, 1, 0.6),
    hold: !!p.hold,
    keys: p.hold ? [] : uniq,
  };
}

export function normalizeClip(c) {
  if (!c || typeof c !== 'object') return null;
  const duration = clamp(c.duration, 0.2, 60, 2);
  const pins = (Array.isArray(c.pins) ? c.pins : []).map(p => normalizePin(p, duration)).filter(Boolean).slice(0, MAX_PINS);
  const sf = normalizeSoundFile(c.soundFile);
  return {
    id: String(c.id || 'move_' + Date.now().toString(36)).slice(0, 40),
    name: String(c.name || 'Free move').replace(/[<>]/g, '').slice(0, 60),
    duration,
    loop: LOOPS.includes(c.loop) ? c.loop : 'once',
    autoplay: !!c.autoplay,
    delay: clamp(c.delay, 0, 30, 0.5),
    sound: SOUNDS.includes(c.sound) ? c.sound : 'none',
    ...(sf ? { soundFile: sf } : {}),
    pins,
  };
}
export function normalizeClips(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(normalizeClip).filter(c => c && !seen.has(c.id) && seen.add(c.id)).slice(0, 40);
}

/** Catmull-Rom through the keys, so a hand-made path flows instead of jerking. */
function cr(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
/** A pin's move [x,y,z] and turn [deg x,y,z] at time t. */
export function pinPose(pin, t) {
  const k = pin.keys;
  if (!k.length) return { move: [0, 0, 0], turn: [0, 0, 0] };
  if (k.length === 1 || t <= k[0].t) return { move: k[0].move.slice(), turn: k[0].turn.slice() };
  if (t >= k[k.length - 1].t) { const l = k[k.length - 1]; return { move: l.move.slice(), turn: l.turn.slice() }; }
  let i = 0; while (i < k.length - 2 && t > k[i + 1].t) i++;
  const a = k[Math.max(0, i - 1)], b = k[i], c = k[i + 1], d = k[Math.min(k.length - 1, i + 2)];
  const u = (t - b.t) / Math.max(1e-6, c.t - b.t);
  const f = (key) => [0, 1, 2].map(j => cr(a[key][j], b[key][j], c[key][j], d[key][j], u));
  return { move: f('move'), turn: f('turn') };
}

const D2R = Math.PI / 180;
/** Euler degrees (XYZ order) → quaternion [x,y,z,w]. */
export function eulerQuat([ax, ay, az]) {
  const [cx, sx] = [Math.cos(ax * D2R / 2), Math.sin(ax * D2R / 2)];
  const [cy, sy] = [Math.cos(ay * D2R / 2), Math.sin(ay * D2R / 2)];
  const [cz, sz] = [Math.cos(az * D2R / 2), Math.sin(az * D2R / 2)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}
function qrot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

/** Soft brush: full strength inside, smooth fade to nothing at the radius. */
export function falloff(d, radius, soft) {
  if (d >= radius) return 0;
  const inner = radius * (1 - soft);
  if (d <= inner) return 1;
  const u = (d - inner) / Math.max(1e-9, radius - inner);
  return 1 - u * u * (3 - 2 * u);
}

/** Splats each pin reaches, with weights — found once per pin shape. */
export function pinReach(positions, count, pins) {
  const touched = new Map();
  pins.forEach((p, k) => {
    const [ax, ay, az] = p.at, r = p.radius, r2 = r * r;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 3] - ax, dy = positions[i * 3 + 1] - ay, dz = positions[i * 3 + 2] - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r2) continue;
      const w = falloff(Math.sqrt(d2), r, p.soft);
      if (w <= 0) continue;
      let row = touched.get(i); if (!row) touched.set(i, row = new Float32Array(pins.length));
      row[k] = w;
    }
  });
  const idx = Uint32Array.from([...touched.keys()].sort((a, b) => a - b));
  const W = new Float32Array(idx.length * pins.length);
  idx.forEach((i, n) => W.set(touched.get(i), n * pins.length));
  return { idx, W, n: pins.length };
}

/**
 * Where one splat goes: each moving pin pulls it by its weight (turning about
 * the pin), overlapping pins share, and hold pins keep their area still.
 * Returns [x,y,z] and a turn quaternion for the splat.
 */
export function deformPoint(p, weights, pins, poses) {
  let dx = 0, dy = 0, dz = 0, sum = 0, hold = 0;
  let qx = 0, qy = 0, qz = 0, qw = 0;
  for (let k = 0; k < pins.length; k++) {
    const w = weights[k]; if (!w) continue;
    sum += w;
    if (pins[k].hold) { hold = Math.max(hold, w); continue; }
    const P = poses[k], a = pins[k].at;
    const r = qrot(P.q, [p[0] - a[0], p[1] - a[1], p[2] - a[2]]);
    dx += w * (r[0] + a[0] + P.move[0] - p[0]); dy += w * (r[1] + a[1] + P.move[1] - p[1]); dz += w * (r[2] + a[2] + P.move[2] - p[2]);
    const s = P.q[3] < 0 ? -1 : 1;   // same hemisphere before blending
    qx += w * s * P.q[0]; qy += w * s * P.q[1]; qz += w * s * P.q[2]; qw += w * s * P.q[3];
  }
  const k = (1 - hold) / Math.max(1, sum);
  const moving = sum - (hold ? weights.reduce((a, w, j) => a + (pins[j].hold ? w : 0), 0) : 0);
  qw += Math.max(0, 1 - moving);                // weak pull: mostly unturned
  let ql = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= ql; qy /= ql; qz /= ql; qw /= ql;
  if (hold) { qx *= 1 - hold; qy *= 1 - hold; qz *= 1 - hold; qw = qw * (1 - hold) + hold; ql = Math.hypot(qx, qy, qz, qw) || 1; qx /= ql; qy /= ql; qz /= ql; qw /= ql; }
  const q = [qx, qy, qz, qw];
  return { p: [p[0] + dx * k, p[1] + dy * k, p[2] + dz * k], q };
}

export class FreeMover {
  constructor(THREE, mesh, clips = []) {
    this.THREE = THREE; this.mesh = mesh;
    this.rest = readRest(mesh);
    if (!this.rest) throw new Error('Splat is not ready for free move yet.');
    this.clips = new Map(); this.reach = new Map(); this.time = new Map(); this.anims = new Map();
    this._v = { c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), col: new THREE.Color() };
    this.setClips(clips);
    // moving parts rewrite their splats: put free moves back on top
    this._onFrame = (e) => { if (!e.detail?.mesh || e.detail.mesh === mesh) this.reapply(); };
    globalThis.addEventListener?.('fumoca:partSettled', this._onFrame);
    globalThis.addEventListener?.('fumoca:lightingApplied', this._onFrame);
  }

  setClips(list) {
    const next = new Map();
    for (const c of normalizeClips(list)) next.set(c.id, c);
    // clips that went away (or lost reach) go back to rest first
    for (const [id, old] of this.clips) {
      const nc = next.get(id), key = nc ? reachKey(nc) : null;
      if (!nc || key !== this.reach.get(id)?.key) { if (this.time.get(id)) this._writeRest(this.reach.get(id)?.idx); this.reach.delete(id); }
      if (!nc) this.time.delete(id);
    }
    this.clips = next;
    for (const c of next.values()) {
      const key = reachKey(c);
      if (this.reach.get(c.id)?.key !== key) this.reach.set(c.id, { key, ...pinReach(this.rest.positions, this.rest.count, c.pins) });
    }
    this.reapply();
  }

  list() { return [...this.clips.values()].map(c => ({ id: c.id, name: c.name, kind: 'free' })); }
  has(id) { return this.clips.has(id); }
  reachCount(id) { return this.reach.get(id)?.idx?.length || 0; }

  _base() {
    const pa = globalThis._fumocaPartAnimatorByMesh?.get?.(this.mesh);
    return pa?.posed?.length === this.rest.positions.length ? pa.posed : this.rest.positions;
  }
  _colors() {
    const lit = globalThis._fumocaLightingByMesh?.get?.(this.mesh);
    return lit?.settings?.enabled && lit.lit?.length === this.rest.colors.length ? lit.lit : this.rest.colors;
  }
  _splats() {
    const s = this.mesh.packedSplats || this.mesh.splats;
    if (!s?.setSplat) throw new Error('This Spark build cannot move splats in place.');
    return s;
  }
  _put(splats, i, x, y, z, q) {
    const r = this.rest, C = this._colors(), { c, s, q: Q, col } = this._v;
    let rq = [r.rotations[i * 4 + 1], r.rotations[i * 4 + 2], r.rotations[i * 4 + 3], r.rotations[i * 4]];
    if (q) rq = qmul(q, rq);
    c.set(x, y, z); s.set(r.scales[i * 3], r.scales[i * 3 + 1], r.scales[i * 3 + 2]);
    Q.set(rq[0], rq[1], rq[2], rq[3]); col.setRGB(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
    splats.setSplat(i, c, s, Q, r.opacity[i], col);
  }
  _writeRest(idx) {
    if (!idx?.length) return;
    const splats = this._splats(), B = this._base();
    for (const i of idx) this._put(splats, i, B[i * 3], B[i * 3 + 1], B[i * 3 + 2], null);
    splats.needsUpdate = true; this.mesh.updateVersion?.();
  }

  /** Put a clip at time t (seconds) right now. */
  pose(id, t) {
    const c = this.clips.get(id), R = this.reach.get(id);
    if (!c || !R) return false;
    t = Math.min(c.duration, Math.max(0, t));
    this.time.set(id, t);
    if (!R.idx.length) return true;
    const poses = c.pins.map(p => { const P = pinPose(p, t); return { move: P.move, q: eulerQuat(P.turn) }; });
    const splats = this._splats(), B = this._base(), n = R.n, w = new Float32Array(n);
    for (let m = 0; m < R.idx.length; m++) {
      const i = R.idx[m];
      for (let k = 0; k < n; k++) w[k] = R.W[m * n + k];
      const out = deformPoint([B[i * 3], B[i * 3 + 1], B[i * 3 + 2]], w, c.pins, poses);
      this._put(splats, i, out.p[0], out.p[1], out.p[2], out.q);
    }
    splats.needsUpdate = true; this.mesh.updateVersion?.();
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:partFrame', { detail: { mesh: this.mesh, free: true } }));
    return true;
  }
  reapply() { for (const [id, t] of this.time) if (this.clips.has(id)) this.pose(id, t); }

  stop(id) { cancelAnimationFrame(this.anims.get(id) || 0); this.anims.delete(id); }
  get moving() { return this.anims.size > 0; }

  /** Play forward ('open'), back to the start ('close'), or toggle. Loops keep going until toggled off. */
  run(id, to = 'toggle', { by = 'auto' } = {}) {
    const c = this.clips.get(id);
    if (!c) return Promise.resolve(false);
    const now = this.time.get(id) || 0, playing = this.anims.has(id);
    if (playing && c.loop !== 'once') { this.stop(id); return this.run(id, 'close', { by }); }   // stop a loop: ease back home
    const forward = to === 'toggle' ? now < c.duration / 2 : (to === 'open' || to === 1 || to === true);
    this.stop(id);
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:partMove', { detail: { id, to: forward ? 'open' : 'closed', by, part: { id, sound: c.sound, soundFile: c.soundFile }, mesh: this.mesh, THREE: this.THREE, from: now / c.duration, duration: c.duration } }));
    const loops = forward && c.loop !== 'once';
    return new Promise((resolve) => {
      let last = performance.now(), t = now, dir = forward ? 1 : -1;
      const step = (ts) => {
        const dt = Math.min(0.25, (ts - last) / 1000); last = ts;
        t += dt * dir;
        if (loops) {
          if (c.loop === 'loop' && t >= c.duration) t -= c.duration;
          if (c.loop === 'bounce' && (t >= c.duration || t <= 0)) { dir = -dir; t = Math.min(c.duration, Math.max(0, t)); }
        }
        const end = !loops && (forward ? t >= c.duration : t <= 0);
        if (end) t = forward ? c.duration : 0;
        this.pose(id, t);
        if (end) { this.anims.delete(id); if (!forward) this.time.delete(id); globalThis.dispatchEvent?.(new CustomEvent('fumoca:partSettled', { detail: { mesh: this.mesh, id, free: true } })); resolve(true); }
        else this.anims.set(id, requestAnimationFrame(step));
      };
      this.anims.set(id, requestAnimationFrame(step));
      if (loops) resolve(true);
    });
  }

  /** After an edit rewrote the splats: take new geometry if the count is the same. */
  refreshGeometry() {
    if (!refreshRestGeometry(this.rest, this.mesh)) return false;
    this.reach.clear(); this.setClips([...this.clips.values()]);
    return true;
  }

  dispose() {
    for (const id of [...this.anims.keys()]) this.stop(id);
    for (const [id, t] of this.time) if (t) try { this._writeRest(this.reach.get(id)?.idx); } catch (_) {}
    this.time.clear();
    globalThis.removeEventListener?.('fumoca:partSettled', this._onFrame);
    globalThis.removeEventListener?.('fumoca:lightingApplied', this._onFrame);
  }
}
function reachKey(c) { return JSON.stringify(c.pins.map(p => [p.at, p.radius, p.soft, p.hold])); }
