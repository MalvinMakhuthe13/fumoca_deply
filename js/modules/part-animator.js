/**
 * Moving parts for Gaussian splats — car doors, bonnets and boots, house
 * doors, can lids, bottle caps, a reclining couch back… CPU only, no AI.
 *
 * A part is a region of the scan (a box in the splat's own coordinates, so
 * it works on any copy of the file) plus a motion:
 *   hinge  rotate about an axis through a pivot        (doors, lids, recline)
 *   slide  move along a direction                      (drawers, sliding doors)
 *   twist  rotate about an axis and lift along it      (bottle caps, jar lids)
 *
 * Parts animate smoothly and in place in the live Spark mesh (setSplat),
 * open ↔ closed with easing — no swapping whole files.
 */
import { readRest, refreshRestGeometry } from './splat-rig-driver.js';

const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
const EASE = {
  'ease-in-out': t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  linear: t => t,
  'ease-out': t => 1 - (1 - t) ** 3,
  spring: t => 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-5 * t),   // a little overshoot, like a sprung door
};

export function normalizePart(p) {
  if (!p || typeof p !== 'object') return null;
  const box = p.box;
  if (!box || !finite3(box.min) || !finite3(box.max)) return null;
  const min = box.min.map((v, i) => Math.min(v, box.max[i])), max = box.max.map((v, i) => Math.max(v, box.min[i]));
  const m = p.motion || {};
  const type = ['hinge', 'slide', 'twist', 'lift'].includes(m.type) ? m.type : 'hinge';
  const axis = finite3(m.axis) && Math.hypot(...m.axis) > 1e-9 ? m.axis.map(v => v / Math.hypot(...m.axis)) : [0, 1, 0];
  const pivot = finite3(m.pivot) ? m.pivot.slice() : min.map((v, i) => (v + max[i]) / 2);
  return {
    id: String(p.id || 'part_' + Math.random().toString(36).slice(2, 8)).replace(/[^\w-]/g, '').slice(0, 40),
    name: String(p.name || 'Part').slice(0, 60),
    box: { min, max },
    motion: {
      type, axis, pivot,
      angle: num(m.angle, -720, 720, type === 'twist' ? -360 : 70),
      distance: num(m.distance, -100, 100, 0),
      lift: num(m.lift, -100, 100, 0),
      duration: num(m.duration, 0.1, 20, 1.2),
      ease: EASE[m.ease] ? m.ease : 'ease-in-out',
    },
    startOpen: !!p.startOpen,
    // on the published page: only when clicked, open once, or keep opening and closing
    autoplay: ['none', 'once', 'loop'].includes(p.autoplay) ? p.autoplay : 'none',
    hold: num(p.hold, 0, 30, 1.2),
    delay: num(p.delay, 0, 60, 0),
  };
}

export function normalizeParts(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, 32).map(normalizePart).filter(p => p && !seen.has(p.id) && seen.add(p.id));
}

function axisAngleQuat(axis, rad) {
  const s = Math.sin(rad / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
}
function qMul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Rigid transform of a part at openness t (0 closed … 1 open). */
export function partTransform(part, t) {
  const m = part.motion;
  if (m.type === 'slide') {
    const d = m.distance * t;
    return { q: [0, 0, 0, 1], apply: (p) => [p[0] + m.axis[0] * d, p[1] + m.axis[1] * d, p[2] + m.axis[2] * d] };
  }
  if (m.type === 'lift') {
    // a pot lid: rises along the axis and tips a little about a level axis
    const up = m.axis, side = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    let tilt = [up[1] * side[2] - up[2] * side[1], up[2] * side[0] - up[0] * side[2], up[0] * side[1] - up[1] * side[0]];
    const tl = Math.hypot(...tilt) || 1; tilt = tilt.map(v => v / tl);
    const q = axisAngleQuat(tilt, (m.angle * Math.PI / 180) * t), d = m.lift * t;
    return {
      q,
      apply: (p) => {
        const r = rotate(q, [p[0] - m.pivot[0], p[1] - m.pivot[1], p[2] - m.pivot[2]]);
        return [r[0] + m.pivot[0] + up[0] * d, r[1] + m.pivot[1] + up[1] * d, r[2] + m.pivot[2] + up[2] * d];
      },
    };
  }
  const q = axisAngleQuat(m.axis, (m.angle * Math.PI / 180) * t);
  const lift = m.type === 'twist' ? m.lift * t : 0;
  return {
    q,
    apply: (p) => {
      const r = rotate(q, [p[0] - m.pivot[0], p[1] - m.pivot[1], p[2] - m.pivot[2]]);
      return [r[0] + m.pivot[0] + m.axis[0] * lift, r[1] + m.pivot[1] + m.axis[1] * lift, r[2] + m.pivot[2] + m.axis[2] * lift];
    },
  };
}

/** Splat indices inside a part's box. */
export function partMembers(positions, count, part) {
  const { min, max } = part.box, out = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]) out.push(i);
  }
  return Int32Array.from(out);
}

/**
 * Suggest a hinge for a box: the pivot sits on the chosen edge, the axis runs
 * along it. side: left | right | top | bottom | front | back (y up, x right,
 * z towards the default camera).
 */
export function suggestHinge(box, side = 'left') {
  const { min, max } = box, c = min.map((v, i) => (v + max[i]) / 2);
  const spans = max.map((v, i) => v - min[i]);
  // the part's thin axis (a door is thin in one direction)
  const thin = spans.indexOf(Math.min(...spans));
  switch (side) {
    case 'right': return { pivot: [max[0], c[1], c[2]], axis: [0, 1, 0] };
    case 'top': return { pivot: [c[0], max[1], c[2]], axis: thin === 2 ? [1, 0, 0] : [0, 0, 1] };
    case 'bottom': return { pivot: [c[0], min[1], c[2]], axis: thin === 2 ? [1, 0, 0] : [0, 0, 1] };
    case 'front': return { pivot: [c[0], c[1], max[2]], axis: [0, 1, 0] };
    case 'back': return { pivot: [c[0], c[1], min[2]], axis: [0, 1, 0] };
    case 'center': return { pivot: c, axis: [0, 1, 0] };
    case 'left':
    default: return { pivot: [min[0], c[1], c[2]], axis: [0, 1, 0] };
  }
}

export class PartAnimator {
  constructor(THREE, mesh, parts = []) {
    this.THREE = THREE; this.mesh = mesh;
    this.rest = readRest(mesh);
    if (!this.rest) throw new Error('Splat is not ready for moving parts yet.');
    this.parts = new Map();
    this.anims = new Map();
    // where every splat is now (parts moved) — lighting and the shadow use it
    this.posed = Float32Array.from(this.rest.positions);
    (globalThis._fumocaPartAnimatorByMesh ||= new WeakMap()).set(mesh, this);
    this._v = { c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), col: new THREE.Color() };
    this.setParts(parts);
    this._onLit = () => this.reapply();
    globalThis.addEventListener?.('fumoca:lightingApplied', this._onLit);
  }

  setParts(parts) {
    const next = new Map();
    for (const p of normalizeParts(parts)) {
      const prev = this.parts.get(p.id);
      next.set(p.id, { part: p, members: partMembers(this.rest.positions, this.rest.count, p), t: prev ? prev.t : (p.startOpen ? 1 : 0) });
    }
    // splats that left a part go back to rest
    for (const [id, old] of this.parts) if (!next.has(id) && old.t) this._write(old.members, null);
    this.parts = next;
    this.reapply();
  }

  list() { return [...this.parts.values()].map(e => ({ id: e.part.id, name: e.part.name, open: e.t > 0.5, members: e.members.length })); }

  _colors() {
    const lit = globalThis._fumocaLightingByMesh?.get?.(this.mesh);
    return lit?.settings?.enabled && lit.lit?.length === this.rest.colors.length ? lit.lit : this.rest.colors;
  }

  _write(members, part, t = 0) {
    const splats = this.mesh.packedSplats || this.mesh.splats;
    if (!splats?.setSplat) throw new Error('This Spark build cannot move splats in place.');
    const r = this.rest, C = this._colors(), { c, s, q, col } = this._v;
    const tf = part && t ? partTransform(part, t) : null;
    for (const i of members) {
      const p = [r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]];
      const np = tf ? tf.apply(p) : p;
      let rq = [r.rotations[i * 4 + 1], r.rotations[i * 4 + 2], r.rotations[i * 4 + 3], r.rotations[i * 4]];
      if (tf) rq = qMul(tf.q, rq);
      c.set(np[0], np[1], np[2]);
      this.posed[i * 3] = np[0]; this.posed[i * 3 + 1] = np[1]; this.posed[i * 3 + 2] = np[2];
      s.set(r.scales[i * 3], r.scales[i * 3 + 1], r.scales[i * 3 + 2]);
      q.set(rq[0], rq[1], rq[2], rq[3]);
      col.setRGB(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      splats.setSplat(i, c, s, q, r.opacity[i], col);
    }
    splats.needsUpdate = true;
    this.mesh.updateVersion?.();
  }

  /** Put a part at openness t immediately. */
  set(id, t) {
    const e = this.parts.get(id);
    if (!e) return false;
    e.t = Math.min(1, Math.max(0, t));
    this._write(e.members, e.part, e.t);
    return true;
  }

  reapply() { for (const e of this.parts.values()) if (e.t) this._write(e.members, e.part, e.t); }

  /** Parts that are (partly) open: their splats and turn — for relighting. */
  openTransforms() {
    const out = [];
    for (const e of this.parts.values()) if (e.t > 1e-4) out.push({ members: e.members, q: partTransform(e.part, e.t).q });
    return out;
  }
  get moving() { return this.anims.size > 0; }

  /** Animate to open (1), closed (0) or 'toggle'. Resolves when it arrives. */
  run(id, to = 'toggle', { by = 'auto' } = {}) {
    const e = this.parts.get(id);
    if (!e) return Promise.resolve(false);
    const target = to === 'toggle' ? (e.t > 0.5 ? 0 : 1) : (to === 'open' || to === 1 || to === true ? 1 : 0);
    cancelAnimationFrame(this.anims.get(id) || 0);
    const from = e.t, dur = e.part.motion.duration * 1000 * Math.max(0.15, Math.abs(target - from));
    const ease = EASE[e.part.motion.ease];
    const t0 = performance.now();
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:partMove', { detail: { id, to: target ? 'open' : 'closed', by } }));
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / Math.max(1, dur));
        e.t = from + (target - from) * ease(k);
        this._write(e.members, e.part, e.t);
        globalThis.dispatchEvent?.(new CustomEvent('fumoca:partFrame', { detail: { mesh: this.mesh } }));
        if (k < 1) this.anims.set(id, requestAnimationFrame(step));
        else {
          e.t = target; this._write(e.members, e.part, e.t); this.anims.delete(id);
          globalThis.dispatchEvent?.(new CustomEvent('fumoca:partSettled', { detail: { mesh: this.mesh, id } }));
          resolve(true);
        }
      };
      this.anims.set(id, requestAnimationFrame(step));
    });
  }

  closeAll() { return Promise.all([...this.parts.keys()].map(id => this.run(id, 'close'))); }

  /** After an in-place edit: new geometry, parts re-found in their boxes. */
  refreshGeometry() {
    if (this.anims.size || [...this.parts.values()].some(e => e.t)) return false;   // not while a part is open
    if (!refreshRestGeometry(this.rest, this.mesh)) return false;
    this.posed = Float32Array.from(this.rest.positions);
    this.setParts([...this.parts.values()].map(e => e.part));
    return true;
  }

  dispose() {
    this.stopAutoplay?.();
    for (const id of this.anims.keys()) cancelAnimationFrame(this.anims.get(id));
    for (const e of this.parts.values()) if (e.t) this._write(e.members, null);
    globalThis.removeEventListener?.('fumoca:lightingApplied', this._onLit);
  }
}

/** Public viewer: moving parts saved in Studio, driven by hotspots. */
export async function restorePartsOnViewer(THREE, mesh, saved) {
  const parts = normalizeParts(saved);
  if (!parts.length || !mesh) return null;
  if (mesh.initialized) await mesh.initialized;
  const a = new PartAnimator(THREE, mesh, parts);
  a.stopAutoplay = startPartAutoplay(a);
  return a;
}

/**
 * Parts set to play on their own: open once, or keep opening and closing
 * (a bin lid, a pot lid, a laptop…). A visitor's click takes over that part.
 * Returns a stop function.
 */
export function startPartAutoplay(animator, { only = null } = {}) {
  let stopped = false;
  const timers = [];
  const wait = (s) => new Promise(r => timers.push(setTimeout(r, s * 1000)));
  const taken = new Set();
  const onMove = (e) => { if (e.detail?.by === 'visitor') taken.add(e.detail.id); };
  globalThis.addEventListener?.('fumoca:partMove', onMove);
  for (const e of animator.parts.values()) {
    const p = e.part;
    if (p.autoplay === 'none' || (only && !only.includes(p.id))) continue;
    (async () => {
      await wait(p.delay + 0.6);
      do {
        if (stopped || taken.has(p.id)) return;
        await animator.run(p.id, 'open');
        if (p.autoplay === 'once' || stopped || taken.has(p.id)) return;
        await wait(p.hold);
        if (stopped || taken.has(p.id)) return;
        await animator.run(p.id, 'close');
        await wait(p.hold);
      } while (!stopped);
    })();
  }
  return () => { stopped = true; timers.forEach(clearTimeout); globalThis.removeEventListener?.('fumoca:partMove', onMove); };
}
