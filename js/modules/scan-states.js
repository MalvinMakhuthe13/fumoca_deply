/**
 * Scans as states — the same object captured closed and open (a car with a
 * door open, a fridge with its door open, a bin with its lid up, a drawer
 * pulled out). Once the two scans are lined up, this finds what moved and
 * exactly how, from the captures themselves. CPU only, no AI, any object.
 *
 *   diffStates      which splats both scans share (stayed still) and which
 *                   only one scan has (moved, or newly visible inside)
 *   pieces          connected pieces of a set of splats
 *   estimateMotion  rigid motion taking a piece from the closed scan onto the
 *                   open scan (many starting guesses, then ICP)
 *   motionFromRigid the motion as a Fumoca part: hinge (doors, lids, boots),
 *                   slide (drawers, sliding doors) or twist (caps)
 *   findMovingParts all of the above, for every piece that moved
 */
import { buildGrid, nearest, refineAlignment, applyT } from './scan-link.js';

const pos = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function sample(arr, max, seed = 7) {
  if (arr.length <= max) return Array.from(arr);
  const out = [], step = arr.length / max;
  let s = seed;
  for (let k = 0; k < max; k++) { s = (s * 1103515245 + 12345) >>> 0; out.push(arr[Math.min(arr.length - 1, Math.floor(k * step + (s / 2 ** 32) * step))]); }
  return out;
}

/** Rotation (row-major 3×3) about a unit axis by an angle in radians. */
export function axisAngleMat(u, a) {
  const [x, y, z] = norm(u), c = Math.cos(a), s = Math.sin(a), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
const rigid = (R, t) => ({ R, s: 1, t, q: [1, 0, 0, 0] });

/**
 * Split two lined-up scans into shared (both saw it, it stayed still) and
 * only-in-one splats. radius: how close counts as the same surface.
 */
export function diffStates(positions, baseIdx, linkIdx, radius) {
  const gB = buildGrid(positions, baseIdx, radius), gL = buildGrid(positions, linkIdx, radius);
  const baseOnly = [], baseShared = [], linkOnly = [], linkShared = [];
  for (const i of baseIdx) (nearest(gL, pos(positions, i), radius) ? baseShared : baseOnly).push(i);
  for (const i of linkIdx) (nearest(gB, pos(positions, i), radius) ? linkShared : linkOnly).push(i);
  return { baseOnly, baseShared, linkOnly, linkShared };
}

/** Connected pieces (26-neighbour cells of size `cell`), biggest first. */
export function pieces(positions, indices, cell, minPoints = 50) {
  const cells = new Map();
  for (const i of indices) {
    const k = `${Math.floor(positions[i * 3] / cell)},${Math.floor(positions[i * 3 + 1] / cell)},${Math.floor(positions[i * 3 + 2] / cell)}`;
    let c = cells.get(k); if (!c) cells.set(k, c = { idx: [], comp: -1 }); c.idx.push(i);
  }
  const out = [];
  for (const [k0, c0] of cells) {
    if (c0.comp >= 0) continue;
    const id = out.length, members = [], stack = [k0]; c0.comp = id;
    while (stack.length) {
      const k = stack.pop(), c = cells.get(k); members.push(...c.idx);
      const [x, y, z] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const nk = `${x + dx},${y + dy},${z + dz}`, n = cells.get(nk);
        if (n && n.comp < 0) { n.comp = id; stack.push(nk); }
      }
    }
    out.push(members);
  }
  return out.filter(p => p.length >= minPoints).sort((a, b) => b.length - a.length);
}

/** Centre and principal axes of some splats. */
function frame(positions, idx) {
  const c = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) c[k] += positions[i * 3 + k];
  for (let k = 0; k < 3; k++) c[k] /= idx.length || 1;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const i of idx) { const d = [positions[i * 3] - c[0], positions[i * 3 + 1] - c[1], positions[i * 3 + 2] - c[2]]; for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[r * 3 + q] += d[r] * d[q]; }
  // power iteration for two axes
  const axes = [];
  let M = C.slice();
  for (let a = 0; a < 3; a++) {
    let v = norm([1, 0.3 + a, 0.7 - a]);
    for (let it = 0; it < 60; it++) { v = norm([M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]); }
    const lam = dot(v, [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]);
    axes.push(v);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) M[r * 3 + q] -= lam * v[r] * v[q];
  }
  // the thinnest axis is best taken as the normal of the first two (deflation is noisy when it's tiny)
  axes[2] = norm(cross(axes[0], axes[1]));
  let ext = 0; for (const i of idx) { const d = Math.hypot(positions[i * 3] - c[0], positions[i * 3 + 1] - c[1], positions[i * 3 + 2] - c[2]); if (d > ext) ext = d; }
  return { c, axes, ext };
}

/**
 * Rigid motion taking `partIdx` (closed scan) onto `targetIdx` (where it is in
 * the open scan). Tries turns about many axes through the part's edges and
 * centre plus straight pulls, keeps the best few and snaps them with ICP.
 * Returns { T, overlap, rms } (T in scan-link form) or null.
 */
export function estimateMotion(positions, partIdx, targetIdx, spacing) {
  if (partIdx.length < 30 || targetIdx.length < 30) return null;
  const P = sample(partIdx, 2500, 3).map(i => pos(positions, i));
  const r = spacing * 4, grid = buildGrid(positions, sample(targetIdx, 200000, 5), r);
  const score = (T) => { let hit = 0; for (const p of P) if (nearest(grid, applyT(T, p), r)) hit++; return hit / P.length; };
  const { c, axes, ext } = frame(positions, partIdx);
  const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1], ...axes];
  // pivots: centre and the ends of the part along each principal axis (hinges sit on an edge)
  const pivots = [c];
  for (const a of axes.slice(0, 2)) for (const sgn of [-1, 1]) {
    let far = 0; for (const p of P) far = Math.max(far, sgn * dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], a));
    pivots.push([c[0] + a[0] * far * sgn, c[1] + a[1] * far * sgn, c[2] + a[2] * far * sgn]);
  }
  const cands = [];
  for (const u of dirs) for (const pv of pivots) for (let deg = -170; deg <= 170; deg += 10) {
    if (!deg) continue;
    const R = axisAngleMat(u, deg * Math.PI / 180), Rp = [R[0] * pv[0] + R[1] * pv[1] + R[2] * pv[2], R[3] * pv[0] + R[4] * pv[1] + R[5] * pv[2], R[6] * pv[0] + R[7] * pv[1] + R[8] * pv[2]];
    cands.push(rigid(R, [pv[0] - Rp[0], pv[1] - Rp[1], pv[2] - Rp[2]]));
  }
  for (const u of dirs) for (const f of [-1.5, -1, -0.75, -0.5, -0.3, -0.15, 0.15, 0.3, 0.5, 0.75, 1, 1.5]) cands.push(rigid([1, 0, 0, 0, 1, 0, 0, 0, 1], u.map(v => v * f * ext)));
  const scored = cands.map(T => ({ T, s: score(T) })).sort((a, b) => b.s - a.s).slice(0, 6);
  let best = null;
  for (const { T } of scored) {
    const fit = refineAlignment(positions, targetIdx, partIdx, T, { spacing, scale: false, iterations: 30, samples: 4000 });
    const s = score(fit.T);
    if (!best || s > best.overlap + 1e-9 || (Math.abs(s - best.overlap) < 1e-9 && fit.rms < best.rms)) best = { T: fit.T, overlap: s, rms: fit.rms };
  }
  return best;
}

/**
 * The motion as a Fumoca part motion. Hinge: axis through a pivot (pivot is
 * put level with the part's centre along the axis). Slide: direction and
 * distance. Twist: turn plus travel along the axis (caps, jar lids).
 */
export function motionFromRigid(T, centre, size) {
  const R = T.R, t = T.t;
  const tr = R[0] + R[4] + R[8];
  const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  const deg = ang * 180 / Math.PI;
  if (deg < 4) {
    const d = Math.hypot(t[0], t[1], t[2]);
    return { type: 'slide', axis: norm(t), distance: d, pivot: centre.slice(), angle: 0 };
  }
  let u = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  if (Math.hypot(...u) < 1e-9) u = [0, 1, 0];
  u = norm(u);
  // fixed axis point: p0 = (t⊥ + cot(θ/2) · u × t⊥) / 2
  const along = dot(t, u), tp = [t[0] - u[0] * along, t[1] - u[1] * along, t[2] - u[2] * along];
  const cot = 1 / Math.tan(ang / 2), ux = cross(u, tp);
  let p0 = [(tp[0] + cot * ux[0]) / 2, (tp[1] + cot * ux[1]) / 2, (tp[2] + cot * ux[2]) / 2];
  const k = dot([centre[0] - p0[0], centre[1] - p0[1], centre[2] - p0[2]], u);
  p0 = [p0[0] + u[0] * k, p0[1] + u[1] * k, p0[2] + u[2] * k];
  if (Math.abs(along) > 0.15 * size) return { type: 'twist', axis: u, pivot: p0, angle: deg, lift: along };
  return { type: 'hinge', axis: u, pivot: p0, angle: deg };
}

/** A friendly name from the motion and the object's up direction. */
export function guessKind(motion, up = [0, 1, 0]) {
  if (motion.type === 'slide') return Math.abs(dot(motion.axis, up)) > 0.7 ? 'Lift-off part' : 'Drawer / slider';
  if (motion.type === 'twist') return 'Cap / screw lid';
  return Math.abs(dot(motion.axis, up)) > 0.7 ? 'Door' : 'Lid / flap';
}

/**
 * Everything that moved between a closed scan (base) and an open scan (link).
 * Returns { parts: [{ closedIdx, openIdx, motion, overlap, rms, kind }], diff }.
 * openIdx: the moved piece as the open scan saw it (to attach / drop doubles).
 */
export function findMovingParts(positions, baseIdx, linkIdx, { spacing, minShare = 0.003, minOverlap = 0.45, up = [0, 1, 0] } = {}) {
  const r = spacing * 2.5;
  const diff = diffStates(positions, baseIdx, linkIdx, r);
  const minPts = Math.max(60, Math.round(baseIdx.length * minShare));
  const moved = pieces(positions, diff.baseOnly, spacing * 3, minPts);
  const parts = [];
  let target = diff.linkOnly.slice();
  for (const piece of moved.slice(0, 6)) {
    if (target.length < 30) break;
    const fit = estimateMotion(positions, piece, target, spacing);
    if (!fit || fit.overlap < minOverlap) continue;
    const { c, ext } = frame(positions, piece);
    const motion = motionFromRigid(fit.T, c, ext * 2);
    // the open scan's copy of this piece: open-only splats the moved piece lands on
    const g = buildGrid(positions, piece, r);
    const inv = invertRigid(fit.T);
    const openIdx = [], rest = [];
    for (const i of target) (nearest(g, applyT(inv, pos(positions, i)), r * 1.6) ? openIdx : rest).push(i);
    target = rest;
    // Along the panel's edges (and next to a hinge, where it barely moves) both
    // scans have splats close together, so those strips looked "unchanged".
    // Take back shared splats next to the panel that, moved like the panel,
    // land on the open scan's copy of it; body splats would land in mid-air.
    const grown = growByMotion(positions, piece, diff.baseShared, fit.T, openIdx, motion, r, diff.linkShared);
    if (grown.length) { const have = new Set(piece); for (const i of grown) if (!have.has(i)) piece.push(i); }
    parts.push({ closedIdx: piece, openIdx, motion, overlap: fit.overlap, rms: fit.rms, kind: guessKind(motion, up) });
  }
  return { parts, diff, inside: target };
}

/** Shared splats next to the panel that move with it (see findMovingParts). */
export function growByMotion(positions, piece, shared, T, openIdx, motion, r, stillIdx = null) {
  if (!openIdx.length) return [];
  const near = buildGrid(positions, piece, r * 2), dest = buildGrid(positions, openIdx, r);
  const still = stillIdx?.length ? buildGrid(positions, stillIdx, r) : null;
  // a flat panel (door, lid, drawer front): strip splats must lie on its plane
  const f = frame(positions, piece);
  let thick = 0; for (const i of piece) thick += dot([positions[i * 3] - f.c[0], positions[i * 3 + 1] - f.c[1], positions[i * 3 + 2] - f.c[2]], f.axes[2]) ** 2;
  thick = Math.sqrt(thick / Math.max(1, piece.length));
  const flat = thick < 0.06 * f.ext ? { n: f.axes[2], c: f.c, tol: Math.max(r * 0.5, thick * 3) } : null;
  const onPlane = (p) => !flat || Math.abs(dot([p[0] - flat.c[0], p[1] - flat.c[1], p[2] - flat.c[2]], flat.n)) <= flat.tol;
  const hinge = motion.type === 'hinge' ? hingeFrame(positions, piece, motion, r) : null;
  const out = [];
  for (const i of shared) {
    const p = pos(positions, i);
    if (!nearest(near, p, r * 2)) continue;
    const moved = nearest(dest, applyT(T, p), r);
    if (!moved) continue;
    // joins the part only if "moved with it" fits the open scan better than "stayed still"
    const stay = still ? nearest(still, p, r) : null;
    if (stay && moved.d2 > stay.d2 * 0.35) continue;   // clearly better, not a coin toss at the edge
    if (hinge && !hinge.onPanelSide(p)) continue;
    if (!onPlane(p)) continue;
    out.push(i);
  }
  // the strip right at a hinge barely moves, so the test above can't tell; use the hinge side
  if (hinge) { const have = new Set(out); for (const i of hingeStrip(positions, piece, shared, motion, r)) if (!have.has(i) && onPlane(pos(positions, i))) out.push(i); }
  return out;
}

function hingeFrame(positions, piece, motion, r) {
  const u = motion.axis, p0 = motion.pivot;
  let side = [0, 0, 0], lo = Infinity, hi = -Infinity;
  for (const i of piece) {
    const d = [positions[i * 3] - p0[0], positions[i * 3 + 1] - p0[1], positions[i * 3 + 2] - p0[2]], a = dot(d, u);
    side = [side[0] + d[0] - u[0] * a, side[1] + d[1] - u[1] * a, side[2] + d[2] - u[2] * a];
    if (a < lo) lo = a; if (a > hi) hi = a;
  }
  side = norm(side);
  return {
    onPanelSide(p) {
      const d = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]], a = dot(d, u);
      if (a < lo - r || a > hi + r) return false;
      const perp = [d[0] - u[0] * a, d[1] - u[1] * a, d[2] - u[2] * a];
      return dot(perp, side) > 0.5 * Math.hypot(perp[0], perp[1], perp[2]) - 0.3 * r;
    },
  };
}

/** Shared splats in the panel's strip next to its hinge (see findMovingParts). */
export function hingeStrip(positions, piece, shared, motion, r) {
  const u = motion.axis, p0 = motion.pivot, th = motion.angle * Math.PI / 180;
  const D = Math.min(1.5 * r / Math.max(1e-6, 2 * Math.sin(th / 2)) + r, 10 * r);
  // the panel's direction away from the axis, and its extent along the axis
  let side = [0, 0, 0], lo = Infinity, hi = -Infinity;
  for (const i of piece) {
    const d = [positions[i * 3] - p0[0], positions[i * 3 + 1] - p0[1], positions[i * 3 + 2] - p0[2]], a = dot(d, u);
    side = [side[0] + d[0] - u[0] * a, side[1] + d[1] - u[1] * a, side[2] + d[2] - u[2] * a];
    if (a < lo) lo = a; if (a > hi) hi = a;
  }
  side = norm(side);
  // only grow where the panel actually is: near some panel splat
  const near = buildGrid(positions, piece, D);
  const out = [];
  for (const i of shared) {
    const d = [positions[i * 3] - p0[0], positions[i * 3 + 1] - p0[1], positions[i * 3 + 2] - p0[2]], a = dot(d, u);
    if (a < lo - r || a > hi + r) continue;
    const perp = [d[0] - u[0] * a, d[1] - u[1] * a, d[2] - u[2] * a], rho = Math.hypot(perp[0], perp[1], perp[2]);
    // in line with the panel (a wall meeting the hinge at a corner doesn't qualify)
    if (rho > D || dot(perp, side) < 0.7 * rho - 0.3 * r) continue;
    if (nearest(near, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], D)) out.push(i);
  }
  return out;
}

export function invertRigid(T) {
  const R = T.R, Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]], t = T.t;
  return rigid(Rt, [-(Rt[0] * t[0] + Rt[1] * t[1] + Rt[2] * t[2]), -(Rt[3] * t[0] + Rt[4] * t[1] + Rt[5] * t[2]), -(Rt[6] * t[0] + Rt[7] * t[1] + Rt[8] * t[2])]);
}
