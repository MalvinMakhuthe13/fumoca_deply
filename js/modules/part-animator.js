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
import { pickTransform, pickPhases, strandPull, findStrands, regionMembers, normalizeRegion, makeUtensil, poseUtensil, UTENSILS } from './food-pick.js';

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
  const type = ['hinge', 'slide', 'twist', 'lift', 'pick', 'path'].includes(m.type) ? m.type : 'hinge';
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
      // a zip pull running along the seam: the points it travels through
      ...(type === 'path' ? { points: (Array.isArray(m.points) ? m.points.filter(finite3).slice(0, 64).map(v => v.map(Number)) : []) } : {}),
      ...(type === 'pick' ? {
        dir: finite3(m.dir) && Math.hypot(m.dir[0], m.dir[2]) > 1e-9 ? [m.dir[0], 0, m.dir[2]].map((v, i, a) => v / Math.hypot(a[0], a[2])) : [0, 0, 1],
        droop: num(m.droop, 0, 2, 0.3), stretch: num(m.stretch, 0, 1, 0.5), zone: num(m.zone, 0, 100, 0),
        size: num(m.size, 1e-6, 1e4, 1), bottom: Number.isFinite(+m.bottom) ? +m.bottom : undefined,
        utensil: UTENSILS.includes(m.utensil) ? m.utensil : 'none',
      } : {}),
    },
    ...(normalizeRegion(p.region) ? { region: normalizeRegion(p.region) } : {}),
    ...(normalizeCells(p.cells) ? { cells: normalizeCells(p.cells) } : {}),
    // the experience around it: a sound, an effect (perfume mist), and its place
    // in a sequence (suitcase: zip → clasps → lid). A press springs back.
    sound: SOUNDS.includes(p.sound) ? p.sound : 'none',
    // your own recording (uploaded from your machine), used instead of the built-in sound
    ...(normalizeSoundFile(p.soundFile) ? { soundFile: normalizeSoundFile(p.soundFile) } : {}),
    ...(normalizeEffect(p.effect) ? { effect: normalizeEffect(p.effect) } : {}),
    group: typeof p.group === 'string' ? p.group.replace(/[<>]/g, '').trim().slice(0, 30) : '',
    order: Number.isFinite(+p.order) ? Math.max(0, Math.min(99, Math.round(+p.order))) : 0,
    springBack: !!p.springBack,
    startOpen: !!p.startOpen,
    // on the published page: only when clicked, open once, or keep opening and closing
    autoplay: ['none', 'once', 'loop'].includes(p.autoplay) ? p.autoplay : 'none',
    hold: num(p.hold, 0, 30, 1.2),
    delay: num(p.delay, 0, 60, 0),
  };
}

export const SOUNDS = ['none', 'click', 'zip', 'spray', 'thunk', 'whoosh'];
export const MAX_SOUND_BYTES = 1.5 * 1024 * 1024;
function normalizeSoundFile(f) {
  if (!f || typeof f !== 'object' || typeof f.dataUrl !== 'string') return null;
  if (!/^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(f.dataUrl) || f.dataUrl.length > MAX_SOUND_BYTES * 1.4) return null;
  return {
    name: String(f.name || 'sound').replace(/[<>]/g, '').slice(0, 60), dataUrl: f.dataUrl,
    on: ['open', 'close', 'both'].includes(f.on) ? f.on : 'open',
    volume: Number.isFinite(+f.volume) ? Math.max(0, Math.min(1, +f.volume)) : 0.9,
  };
}
function normalizeEffect(e) {
  if (!e || typeof e !== 'object' || e.type !== 'mist' || !finite3(e.origin)) return null;
  const d = finite3(e.dir) && Math.hypot(...e.dir) > 1e-9 ? e.dir.map(v => v / Math.hypot(...e.dir)) : [0, 0, 1];
  const n = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
  return {
    type: 'mist', origin: e.origin.map(Number), dir: d,
    color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : '#e8f1ff',
    amount: n(e.amount, 0.05, 1, 0.6), spread: n(e.spread, 2, 60, 16), reach: n(e.reach, 0.01, 1000, 0.3),
    ...(['view', 'front', 'back', 'left', 'right', 'up'].includes(e._dirKey) ? { _dirKey: e._dirKey } : {}),
  };
}

/** Point along a path at fraction t of its length. */
export function pathPoint(points, t) {
  if (!points || points.length < 2) return points?.[0] || [0, 0, 0];
  const seg = []; let total = 0;
  for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); seg.push(l); total += l; }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const a = points[i], b = points[i + 1], k = seg[i] ? Math.min(1, d / seg[i]) : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    d -= seg[i];
  }
  return points[points.length - 1];
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
  if (m.type === 'pick') { const tf = pickTransform(m, pickPhases(t).lift); return { q: tf.q, apply: tf.apply }; }
  if (m.type === 'path') {
    // carried along the path (from where it starts) — a zip pull round a case
    const a = m.points?.[0] || [0, 0, 0], b = pathPoint(m.points, t), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { q: [0, 0, 0, 1], apply: (p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]] };
  }
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

// ── Exact part area ─────────────────────────────────────────────────────────
// A part remembers the small 3D cells its selected splats sit in, not just a
// box. An axis-aligned box around an angled car door covers half the car (and
// the far side); the cells hug the door's own surface. Cells are in the
// splat's own coordinates, so they work on any copy of the file.
const b64 = {
  enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return (globalThis.btoa ? btoa(s) : Buffer.from(u8).toString('base64')); },
  dec(str) { const bin = globalThis.atob ? atob(str) : Buffer.from(str, 'base64').toString('binary'); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; },
};

/** Cells covering the given splats. `size` defaults to the area's diagonal / 64. */
export function cellsFromIndices(positions, indices, { size = 0 } = {}) {
  if (!indices?.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of indices) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1e-3;
  const s = size > 0 ? size : Math.max(diag / 64, 1e-4);
  const origin = min.map(v => v - s);
  const dims = [0, 1, 2].map(k => Math.floor((max[k] - origin[k]) / s) + 2);
  if (dims[0] * dims[1] * dims[2] > 2 ** 31) return null;
  const set = new Set();
  for (const i of indices) {
    const x = Math.floor((positions[i * 3] - origin[0]) / s), y = Math.floor((positions[i * 3 + 1] - origin[1]) / s), z = Math.floor((positions[i * 3 + 2] - origin[2]) / s);
    set.add(x + dims[0] * (y + dims[1] * z));
  }
  const keys = Uint32Array.from([...set].sort((a, b) => a - b));
  return { size: s, origin, dims, keys: b64.enc(new Uint8Array(keys.buffer)) };
}

function normalizeCells(c) {
  if (!c || typeof c !== 'object' || !(c.size > 0) || !finite3(c.origin) || !Array.isArray(c.dims) || c.dims.length !== 3 || typeof c.keys !== 'string') return null;
  if (!c.dims.every(d => Number.isInteger(d) && d > 0)) return null;
  return { size: +c.size, origin: c.origin.map(Number), dims: c.dims.map(Number), keys: c.keys };
}

/**
 * Splats in a part's cells, plus gaps inside it: an empty cell joins when most
 * of its neighbours are part cells (a hole in the door), but not when only a
 * few are (just past the door's edge) — so the part fills in without spilling.
 */
export function cellMembers(positions, count, cells, { fill = 5 } = {}) {
  const u8 = b64.dec(cells.keys);
  const keys = new Uint32Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 4));
  const set = new Set(keys);
  const { size: s, origin, dims } = cells, [nx, ny, nz] = dims, out = [];
  const gap = new Map();   // cached decision for empty cells
  for (let i = 0; i < count; i++) {
    const x = Math.floor((positions[i * 3] - origin[0]) / s), y = Math.floor((positions[i * 3 + 1] - origin[1]) / s), z = Math.floor((positions[i * 3 + 2] - origin[2]) / s);
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
    const k = x + nx * (y + ny * z);
    if (set.has(k)) { out.push(i); continue; }
    let inside = gap.get(k);
    if (inside === undefined) {
      let c = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if ((dx || dy || dz) && X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz && set.has(X + nx * (Y + ny * Z))) c++;
      }
      inside = c >= fill; gap.set(k, inside);
    }
    if (inside) out.push(i);
  }
  return Int32Array.from(out);
}

/** Splat indices that belong to a part: its exact cells, food region, or box. */
export function partMembers(positions, count, part) {
  if (part.region) return regionMembers(positions, count, part.region);
  if (part.cells) return cellMembers(positions, count, part.cells);
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
      // Only re-find members when the part's area changed (sliders call this often).
      const areaKey = JSON.stringify([p.box, p.cells?.keys?.length, p.cells?.size, p.cells?.origin, p.cells?.keys?.slice(0, 64), p.cells?.keys?.slice(-64), p.region]);
      const members = prev && prev.areaKey === areaKey ? prev.members : partMembers(this.rest.positions, this.rest.count, p);
      // Splats that left an open part go back to rest before the new pose is written.
      if (prev && prev.t && prev.members !== members) this._write(prev.members, null);
      const entry = { part: p, members, areaKey, t: prev ? prev.t : (p.startOpen ? 1 : 0) };
      if (p.motion.type === 'pick') {
        const same = prev && prev.part.motion.type === 'pick' && prev.part.motion.zone === p.motion.zone && prev.members.length === members.length;
        entry.strands = same && prev.strands ? prev.strands : findStrands(this.rest.positions, this.rest.count, members, p.motion.zone);
        if (prev?.utensil && prev.utensil.userData.kind === p.motion.utensil && Math.abs(prev.utensil.userData.size - p.motion.size) < 1e-9) entry.utensil = prev.utensil;
        else { prev?.utensil?.parent?.remove(prev.utensil); entry.utensil = makeUtensil(this.THREE, p.motion.utensil, p.motion.size); if (entry.utensil) this.mesh.add(entry.utensil); }
      } else if (prev?.utensil) prev.utensil.parent?.remove(prev.utensil);
      next.set(p.id, entry);
    }
    // splats that left a part go back to rest
    for (const [id, old] of this.parts) if (!next.has(id)) { if (old.t) { this._write(old.members, null); if (old.strands) this._writeStrands(old, 0); } old.utensil?.parent?.remove(old.utensil); }
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

  /** Strands (cheese, filling) pulled out of the cut with a picked piece. */
  _writeStrands(e, t) {
    const st = e.strands; if (!st?.idx.length) return;
    const splats = this.mesh.packedSplats || this.mesh.splats;
    const r = this.rest, C = this._colors(), { c, s, q, col } = this._v, m = e.part.motion;
    const u = pickPhases(t).lift, pull = strandPull(u) * m.stretch;
    const tf = pull > 0 ? pickTransform(m, u) : null;
    for (let k = 0; k < st.idx.length; k++) {
      const i = st.idx[k], j = st.near[k];
      let x = r.positions[i * 3], y = r.positions[i * 3 + 1], z = r.positions[i * 3 + 2], grow = 1;
      if (tf) {
        // follow the piece splat it is stuck to, part of the way, and stretch
        const pj = [r.positions[j * 3], r.positions[j * 3 + 1], r.positions[j * 3 + 2]], dj = tf.apply(pj);
        const f = st.w[k] * pull;
        x += (dj[0] - pj[0]) * f; y += (dj[1] - pj[1]) * f; z += (dj[2] - pj[2]) * f;
        grow = 1 + f * 1.6;
      }
      this.posed[i * 3] = x; this.posed[i * 3 + 1] = y; this.posed[i * 3 + 2] = z;
      c.set(x, y, z);
      s.set(r.scales[i * 3] * grow, r.scales[i * 3 + 1] * grow, r.scales[i * 3 + 2] * grow);
      q.set(r.rotations[i * 4 + 1], r.rotations[i * 4 + 2], r.rotations[i * 4 + 3], r.rotations[i * 4]);
      col.setRGB(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      splats.setSplat(i, c, s, q, r.opacity[i], col);
    }
    splats.needsUpdate = true;
  }

  _writePart(e) {
    this._write(e.members, e.part, e.t);
    if (e.part.motion.type === 'pick') { this._writeStrands(e, e.t); poseUtensil(this.THREE, e.utensil, e.part.motion, e.t); }
  }

  /** Put a part at openness t immediately. */
  set(id, t) {
    const e = this.parts.get(id);
    if (!e) return false;
    e.t = Math.min(1, Math.max(0, t));
    this._writePart(e);
    return true;
  }

  reapply() { for (const e of this.parts.values()) if (e.t) this._writePart(e); }

  /** Parts that are (partly) open: their splats and turn — for relighting. */
  openTransforms() {
    const out = [];
    for (const e of this.parts.values()) if (e.t > 1e-4) out.push({ members: e.members, q: partTransform(e.part, e.t).q });
    return out;
  }
  get moving() { return this.anims.size > 0; }

  /** Animate to open (1), closed (0) or 'toggle'. Resolves when it arrives. */
  run(id, to = 'toggle', { by = 'auto', single = false } = {}) {
    const e = this.parts.get(id);
    if (!e) return Promise.resolve(false);
    const target = to === 'toggle' ? (e.t > 0.5 ? 0 : 1) : (to === 'open' || to === 1 || to === true ? 1 : 0);
    // part of a sequence (suitcase: zip → clasps → lid): play the whole sequence
    if (e.part.group && !single) return this.runSequence(e.part.group, target ? 'open' : 'close', { by });
    // a press (perfume nozzle, button): goes down and springs back by itself
    if (e.part.springBack && target === 1 && !this._pressing?.has(id)) {
      (this._pressing ||= new Set()).add(id);
      return this.run(id, 'open', { by, single: true }).then(() => new Promise(r => setTimeout(r, 120))).then(() => this.run(id, 'close', { by, single: true })).finally(() => this._pressing.delete(id));
    }
    cancelAnimationFrame(this.anims.get(id) || 0);
    const from = e.t, dur = e.part.motion.duration * 1000 * Math.max(0.15, Math.abs(target - from));
    const ease = EASE[e.part.motion.ease];
    const t0 = performance.now();
    globalThis.dispatchEvent?.(new CustomEvent('fumoca:partMove', { detail: { id, to: target ? 'open' : 'closed', by, part: e.part, mesh: this.mesh, THREE: this.THREE, from, duration: dur / 1000 } }));
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / Math.max(1, dur));
        e.t = from + (target - from) * ease(k);
        this._writePart(e);
        globalThis.dispatchEvent?.(new CustomEvent('fumoca:partFrame', { detail: { mesh: this.mesh } }));
        if (k < 1) this.anims.set(id, requestAnimationFrame(step));
        else {
          e.t = target; this._writePart(e); this.anims.delete(id);
          globalThis.dispatchEvent?.(new CustomEvent('fumoca:partSettled', { detail: { mesh: this.mesh, id } }));
          resolve(true);
        }
      };
      this.anims.set(id, requestAnimationFrame(step));
    });
  }

  closeAll() { return Promise.all([...this.parts.keys()].map(id => this.run(id, 'close', { single: true }))); }

  /** Parts sharing a group play in order to open, in reverse to close. */
  async runSequence(group, to = 'toggle', { by = 'auto' } = {}) {
    const list = [...this.parts.values()].filter(e => e.part.group === group).sort((a, b) => a.part.order - b.part.order);
    if (!list.length) return false;
    const open = to === 'toggle' ? !list.some(e => e.t > 0.5) : (to === 'open' || to === 1 || to === true);
    if (this._seq?.get(group)) return false;   // already playing
    (this._seq ||= new Map()).set(group, true);
    try {
      for (const e of open ? list : list.slice().reverse()) {
        if (e.part.springBack && !open) continue;
        await this.run(e.part.id, open ? 'open' : 'close', { by, single: true });
        await new Promise(r => setTimeout(r, 90));
      }
    } finally { this._seq.delete(group); }
    return true;
  }

  /** After an in-place edit: new geometry, parts re-found in their boxes. */
  refreshGeometry() {
    if (this.anims.size || [...this.parts.values()].some(e => e.t)) return false;   // not while a part is open
    if (!refreshRestGeometry(this.rest, this.mesh)) return false;
    this.posed = Float32Array.from(this.rest.positions);
    for (const e of this.parts.values()) e.areaKey = null;   // geometry changed: re-find members
    this.setParts([...this.parts.values()].map(e => e.part));
    return true;
  }

  dispose() {
    this.stopAutoplay?.();
    for (const id of this.anims.keys()) cancelAnimationFrame(this.anims.get(id));
    for (const e of this.parts.values()) { if (e.t) { this._write(e.members, null); if (e.strands) this._writeStrands(e, 0); } e.utensil?.parent?.remove(e.utensil); }
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
