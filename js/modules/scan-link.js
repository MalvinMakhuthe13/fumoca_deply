/**
 * Linking a second scan of the same object — the inside of a car, a house's
 * rooms, a fridge or wardrobe with its doors open — into the first one, and
 * tying it to the moving parts so the inside shows as a door / lid opens.
 * CPU only, no AI, works on any splat.
 *
 *   line up      a few matching points → similarity (Horn), then ICP snaps it
 *                tight on the surfaces both scans saw
 *   blend        colour match on the overlap; drop splats both scans hold
 *   doors        splats of an opened door in the second scan are put back to
 *                the closed position (the opening angle is found for you), the
 *                outer skin both scans saw is dropped, and the inner panel
 *                rides along with the door from then on
 *   reveal       the inside fades in as linked doors open and out as they close
 *   clean        loose, foggy splats around an opening are removed
 */
import { partTransform } from './part-animator.js';

// ─── small linear algebra ────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const matVec = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const matMul = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };

function jacobiEigen4(M) {
  const a = M.map(r => r.slice()), v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 4; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  let best = 0; for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];   // [w,x,y,z]
}

const quatToMat = ([w, x, y, z]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
  2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
  2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];

export function matToQuat(R) {   // [w,x,y,z]
  const tr = R[0] + R[4] + R[8];
  let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4; }
  const n = Math.hypot(w, x, y, z) || 1;
  return [w / n, x / n, y / n, z / n];
}

/**
 * Best similarity dst ≈ s·R·src + t from matched points (Horn's quaternion
 * method). opts.scale=false keeps the size fixed. weights optional.
 */
export function similarityFromPairs(src, dst, { scale = true, weights = null } = {}) {
  const n = src.length;
  if (n < 3 || dst.length !== n) throw new Error('Pick at least 3 matching points on each scan.');
  let W = 0; const cs = [0, 0, 0], cd = [0, 0, 0];
  for (let i = 0; i < n; i++) { const w = weights ? weights[i] : 1; W += w; for (let k = 0; k < 3; k++) { cs[k] += w * src[i][k]; cd[k] += w * dst[i][k]; } }
  for (let k = 0; k < 3; k++) { cs[k] /= W; cd[k] /= W; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let ss = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1, a = sub(src[i], cs), b = sub(dst[i], cd);
    ss += w * (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += w * a[r] * b[c];
  }
  if (ss < 1e-18) throw new Error('The matching points are all in one spot — spread them over the object.');
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  const q = jacobiEigen4(N), R = quatToMat(q);
  let s = 1;
  if (scale) {
    let num = 0;
    for (let i = 0; i < n; i++) { const w = weights ? weights[i] : 1, a = matVec(R, sub(src[i], cs)), b = sub(dst[i], cd); num += w * (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]); }
    s = num / ss;
    if (!(s > 0)) throw new Error('These points cannot be matched — check that each pair is the same spot.');
  }
  const Rc = matVec(R, cs);
  const t = [cd[0] - s * Rc[0], cd[1] - s * Rc[1], cd[2] - s * Rc[2]];
  return { R, s, t, q };
}

export const applyT = (T, p) => { const r = matVec(T.R, p); return [T.s * r[0] + T.t[0], T.s * r[1] + T.t[1], T.s * r[2] + T.t[2]]; };
/** a∘b: apply b first, then a */
export const composeT = (a, b) => { const R = matMul(a.R, b.R), tb = matVec(a.R, b.t); return { R, s: a.s * b.s, t: [a.s * tb[0] + a.t[0], a.s * tb[1] + a.t[1], a.s * tb[2] + a.t[2]], q: matToQuat(R) }; };
export const pairError = (T, src, dst) => Math.sqrt(src.reduce((e, p, i) => { const d = sub(applyT(T, p), dst[i]); return e + d[0] * d[0] + d[1] * d[1] + d[2] * d[2]; }, 0) / Math.max(1, src.length));

// ─── spatial grid ────────────────────────────────────────────────────────────
const OFF = 1 << 16;
const cellKey = (ix, iy, iz) => ((ix + OFF) * 131072 + (iy + OFF)) * 131072 + (iz + OFF);

/** Uniform grid over the given splat indices (positions xyz-interleaved). */
export function buildGrid(positions, indices, cell) {
  const n = indices.length, keys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    keys[k] = cellKey(Math.floor(positions[i * 3] / cell), Math.floor(positions[i * 3 + 1] / cell), Math.floor(positions[i * 3 + 2] / cell));
  }
  const order = new Uint32Array(n); for (let k = 0; k < n; k++) order[k] = k;
  order.sort((a, b) => keys[a] - keys[b]);
  const sorted = new Int32Array(n), map = new Map();
  let start = 0;
  for (let k = 0; k < n; k++) {
    sorted[k] = indices[order[k]];
    if (k === n - 1 || keys[order[k + 1]] !== keys[order[k]]) { map.set(keys[order[k]], [start, k + 1]); start = k + 1; }
  }
  return { cell, map, sorted, positions };
}

/** Nearest indexed splat to p within radius r: { index, d2 } or null. */
export function nearest(grid, p, r) {
  const { cell, map, sorted, positions } = grid, reach = Math.ceil(r / cell), r2 = r * r;
  const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
  let best = -1, bd = r2;
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
    const span = map.get(cellKey(cx + dx, cy + dy, cz + dz));
    if (!span) continue;
    for (let k = span[0]; k < span[1]; k++) {
      const i = sorted[k], ex = positions[i * 3] - p[0], ey = positions[i * 3 + 1] - p[1], ez = positions[i * 3 + 2] - p[2];
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < bd) { bd = d2; best = i; }
    }
  }
  return best < 0 ? null : { index: best, d2: bd };
}

export function countNear(grid, p, r, cap = 64) {
  const { cell, map, sorted, positions } = grid, reach = Math.ceil(r / cell), r2 = r * r;
  const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
  let n = 0;
  for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
    const span = map.get(cellKey(cx + dx, cy + dy, cz + dz));
    if (!span) continue;
    for (let k = span[0]; k < span[1]; k++) {
      const i = sorted[k], ex = positions[i * 3] - p[0], ey = positions[i * 3 + 1] - p[1], ez = positions[i * 3 + 2] - p[2];
      if (ex * ex + ey * ey + ez * ez <= r2 && ++n >= cap) return n;
    }
  }
  return n;
}

// deterministic sampling (so results repeat)
function sample(indices, max, seed = 7) {
  if (indices.length <= max) return Array.from(indices);
  let s = seed >>> 0; const out = [], step = indices.length / max;
  for (let k = 0; k < max; k++) { s = (s * 1664525 + 1013904223) >>> 0; out.push(indices[Math.min(indices.length - 1, Math.floor(k * step + (s / 4294967296) * step))]); }
  return out;
}
const pos = (P, i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

/** Typical spacing between neighbouring splats (median nearest distance). */
export function estimateSpacing(positions, indices) {
  const idx = Array.from(indices);
  if (idx.length < 20) return 0.01;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of sample(idx, 20000, 3)) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  const diag = Math.hypot(...max.map((v, k) => v - min[k])) || 1;
  let cell = diag / Math.cbrt(idx.length) ;
  const grid = buildGrid(positions, idx, cell);
  const d = [];
  for (const i of sample(idx, 1500, 11)) {
    const p = pos(positions, i);
    // nearest other splat
    const { map, sorted } = grid, cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    let bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const span = map.get(cellKey(cx + dx, cy + dy, cz + dz)); if (!span) continue;
      for (let k = span[0]; k < span[1]; k++) { const j = sorted[k]; if (j === i) continue; const e = sub(pos(positions, j), p), d2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2]; if (d2 < bd) bd = d2; }
    }
    if (Number.isFinite(bd) && bd > 0) d.push(Math.sqrt(bd));
  }
  d.sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : cell;
}

/**
 * Snap the second scan tight onto the first where both saw the same surface
 * (trimmed point-to-point ICP). T0 maps the second scan into the first.
 * Returns { T, rms, overlap } — overlap is the share of sampled second-scan
 * splats that found a partner.
 */
export function refineAlignment(positions, baseIdx, linkIdx, T0, { spacing, iterations = 40, samples = 12000, scale = true, onIter } = {}) {
  const sp = spacing || estimateSpacing(positions, baseIdx);
  const base = sample(baseIdx, 250000, 5), src = sample(linkIdx, samples, 9).map(i => pos(positions, i));
  let T = { ...T0 }, r = Math.max(sp * 8, 1e-6), rms = Infinity, overlap = 0;
  let grid = buildGrid(positions, base, r);
  for (let it = 0; it < iterations; it++) {
    const a = [], b = [], d = [];
    for (const p of src) {
      const q = applyT(T, p), hit = nearest(grid, q, r);
      if (hit) { a.push(q); b.push(pos(positions, hit.index)); d.push(hit.d2); }
    }
    overlap = a.length / src.length;
    if (a.length < 12) break;
    // trim the worst 25 % (parts only one scan saw)
    const cut = [...d].sort((x, y) => x - y)[Math.floor(d.length * 0.75)];
    const A = [], B = [];
    for (let k = 0; k < a.length; k++) if (d[k] <= cut) { A.push(a[k]); B.push(b[k]); }
    const step = similarityFromPairs(A, B, { scale });
    T = composeT(step, T);
    rms = pairError(step, A, B);
    onIter?.(it, rms, overlap);
    const nr = Math.max(sp * 1.5, r * 0.7);
    if (nr < r * 0.95) { r = nr; grid = buildGrid(positions, base, r); }
    const turn = Math.acos(Math.min(1, Math.max(-1, (step.R[0] + step.R[4] + step.R[8] - 1) / 2)));
    if (r <= sp * 1.5 + 1e-12 && Math.hypot(...step.t) < sp * 0.005 && turn < 1e-4 && Math.abs(step.s - 1) < 1e-4) break;
  }
  return { T, rms, overlap, spacing: sp };
}

// ─── editing the Studio state (S) ────────────────────────────────────────────
const qmul = (a, b) => [   // [w,x,y,z]
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];

/** Move, turn and size the given splats by T (positions, rotations, scales). */
export function transformSplats(S, indices, T) {
  const q = T.q || matToQuat(T.R);
  for (const i of indices) {
    const p = applyT(T, pos(S.positions, i));
    S.positions[i * 3] = p[0]; S.positions[i * 3 + 1] = p[1]; S.positions[i * 3 + 2] = p[2];
    if (S.rotation) {
      const r = qmul(q, [S.rotation[i * 4], S.rotation[i * 4 + 1], S.rotation[i * 4 + 2], S.rotation[i * 4 + 3]]);
      const n = Math.hypot(...r) || 1;
      for (let k = 0; k < 4; k++) S.rotation[i * 4 + k] = r[k] / n;
    }
    if (T.s !== 1) {
      if (S.scaleXYZ) for (let k = 0; k < 3; k++) S.scaleXYZ[i * 3 + k] *= T.s;
      if (S.scale) S.scale[i] *= T.s;
    }
  }
}

/** Splats of the second scan that sit on a surface the first scan already has. */
export function findDoubles(positions, keepIdx, testIdx, radius) {
  const grid = buildGrid(positions, keepIdx, radius), out = [];
  for (const i of testIdx) if (nearest(grid, pos(positions, i), radius)) out.push(i);
  return out;
}

/**
 * Per-channel gain + offset that makes the second scan's colours match the
 * first where both saw the same surface.
 */
export function colourMatch(positions, colors, baseIdx, linkIdx, radius) {
  const grid = buildGrid(positions, sample(baseIdx, 300000, 13), radius);
  const xs = [[], [], []], ys = [[], [], []];
  for (const i of sample(linkIdx, 30000, 17)) {
    const hit = nearest(grid, pos(positions, i), radius);
    if (!hit) continue;
    for (let c = 0; c < 3; c++) { xs[c].push(colors[i * 3 + c]); ys[c].push(colors[hit.index * 3 + c]); }
  }
  if (xs[0].length < 50) return null;
  // robust: match the 10th and 90th percentiles per channel
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const out = [0, 1, 2].map(c => {
    const x0 = pct(xs[c], 0.1), x1 = pct(xs[c], 0.9), y0 = pct(ys[c], 0.1), y1 = pct(ys[c], 0.9);
    const gain = x1 - x0 > 1e-4 ? Math.min(3, Math.max(0.33, (y1 - y0) / (x1 - x0))) : 1;
    return { gain, offset: Math.min(0.5, Math.max(-0.5, y0 - gain * x0)) };
  });
  return { channels: out, samples: xs[0].length };
}

const SH_C0 = 0.28209479177387814;
/** Apply a colour match to S (base colours and the stored spherical harmonics). */
export function applyColourMatch(S, indices, match) {
  const ch = match.channels;
  const rest = (S.shAttributes || []).filter(a => a.startsWith('f_rest_'));
  const perChannel = rest.length / 3;
  const shArr = (name, j) => (S.shCoefficients?.[name] ? { get: (i) => S.shCoefficients[name][i], set: (i, v) => { S.shCoefficients[name][i] = v; } }
    : S.shCoefficients && S.shAttributes ? { get: (i) => S.shCoefficients[i * S.shAttributes.length + j], set: (i, v) => { S.shCoefficients[i * S.shAttributes.length + j] = v; } } : null);
  const dc = [0, 1, 2].map(c => { const name = 'f_dc_' + c, j = (S.shAttributes || []).indexOf(name); return j >= 0 ? shArr(name, j) : null; });
  const restArr = rest.map(name => ({ c: Math.min(2, Math.floor(Number(name.split('_').pop()) / Math.max(1, perChannel))), a: shArr(name, S.shAttributes.indexOf(name)) }));
  for (const i of indices) {
    for (let c = 0; c < 3; c++) {
      const v = Math.min(1, Math.max(0, ch[c].gain * S.colors[i * 3 + c] + ch[c].offset));
      S.colors[i * 3 + c] = v;
      if (dc[c]) dc[c].set(i, (v - 0.5) / SH_C0);
    }
    for (const r of restArr) if (r.a) r.a.set(i, r.a.get(i) * ch[r.c].gain);
  }
}

/**
 * How far was this part open in the second scan? Tries openings and keeps the
 * one where the selected (opened) splats, put back to closed, land on the
 * closed part from the first scan. Returns { t, score }.
 */
export function findPartOpening(positions, part, closedIdx, openIdx, radius) {
  const grid = buildGrid(positions, closedIdx, radius), pts = sample(openIdx, 4000, 19).map(i => pos(positions, i));
  // truncated squared distance: rewards landing exactly on the closed skin
  const r2 = radius * radius;
  const score = (t) => { const tf = partTransform(part, -t); let c = 0; for (const p of pts) { const h = nearest(grid, tf.apply(p), radius); c += h ? h.d2 : r2; } return 1 - c / (pts.length * r2); };
  let best = { t: 0, score: -1 };
  for (let t = -1.6; t <= 1.6001; t += 0.02) { const s = score(t); if (s > best.score) best = { t, score: s }; }
  for (let t = best.t - 0.02; t <= best.t + 0.02; t += 0.002) { const s = score(t); if (s > best.score) best = { t, score: s }; }
  return best;
}

/**
 * Put the opened part from the second scan back to closed so it moves with
 * the door; drops its outer skin (the first scan already has it).
 * Returns { attached: indices kept, removed: indices of doubles }.
 */
export function attachToPart(S, part, closedIdx, openIdx, t, radius) {
  const tf = partTransform(part, -t);
  const q = tf.q;   // [x,y,z,w]
  const qw = [q[3], q[0], q[1], q[2]];
  for (const i of openIdx) {
    const p = tf.apply(pos(S.positions, i));
    S.positions[i * 3] = p[0]; S.positions[i * 3 + 1] = p[1]; S.positions[i * 3 + 2] = p[2];
    if (S.rotation) {
      const r = qmul(qw, [S.rotation[i * 4], S.rotation[i * 4 + 1], S.rotation[i * 4 + 2], S.rotation[i * 4 + 3]]), n = Math.hypot(...r) || 1;
      for (let k = 0; k < 4; k++) S.rotation[i * 4 + k] = r[k] / n;
    }
  }
  const removed = findDoubles(S.positions, closedIdx, openIdx, radius);
  const gone = new Set(removed);
  for (const i of removed) S.alive[i] = 0;
  return { attached: openIdx.filter(i => !gone.has(i)), removed };
}

/** Bounds (2–98 %) of some splats — for growing a part's box to hold its inner panel. */
export function robustBounds(positions, indices) {
  const idx = sample(indices, 50000, 23);
  const min = [], max = [];
  for (let k = 0; k < 3; k++) {
    const v = idx.map(i => positions[i * 3 + k]).sort((a, b) => a - b);
    min.push(v[Math.floor(v.length * 0.02)]); max.push(v[Math.ceil((v.length - 1) * 0.98)]);
  }
  return { min, max };
}

/**
 * Loose splats near an opening: few neighbours, and faint or oversized —
 * the "fizz" that hangs in a door frame. Returns indices.
 */
export function looseSplats(S, indices, spacing, { minNeighbours = 4 } = {}) {
  const r = spacing * 2.5, grid = buildGrid(S.positions, indices, r), out = [];
  for (const i of indices) {
    const big = S.scaleXYZ ? Math.max(S.scaleXYZ[i * 3], S.scaleXYZ[i * 3 + 1], S.scaleXYZ[i * 3 + 2]) : (S.scale?.[i] || 0);
    const faint = (S.opacity?.[i] ?? 1) < 0.5;
    if (!faint && big < spacing * 4) continue;
    if (countNear(grid, pos(S.positions, i), r, minNeighbours + 1) <= minNeighbours) out.push(i);
  }
  return out;
}

export function boxIndices(S, box, pad = 0) {
  const out = [], n = S.alive.length;
  const min = box.min.map((v, k) => v - pad * (box.max[k] - box.min[k])), max = box.max.map((v, k) => v + pad * (box.max[k] - box.min[k]));
  for (let i = 0; i < n; i++) {
    if (!S.alive[i]) continue;
    const x = S.positions[i * 3], y = S.positions[i * 3 + 1], z = S.positions[i * 3 + 2];
    if (x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]) out.push(i);
  }
  return out;
}

// ─── saving which splats are "inside" ────────────────────────────────────────
/**
 * Saved files keep the live splats in order, so a set of splats is stored as
 * ranges in that order: [[start, length], …].
 */
export function maskToRanges(mask, alive) {
  const out = []; let row = 0, start = -1;
  for (let i = 0; i < alive.length; i++) {
    if (!alive[i]) continue;
    const on = !!mask[i];
    if (on && start < 0) start = row;
    if (!on && start >= 0) { out.push([start, row - start]); start = -1; }
    row++;
  }
  if (start >= 0) out.push([start, row - start]);
  return out;
}
export function normalizeRanges(r, max = 1e9) {
  if (!Array.isArray(r)) return [];
  return r.slice(0, 20000).filter(x => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] >= 0 && x[1] > 0 && x[0] + x[1] <= max).map(x => [x[0], x[1]]);
}
export function rangesToIndices(ranges, count = Infinity) {
  const out = [];
  for (const [s, l] of ranges) for (let i = s; i < s + l && i < count; i++) out.push(i);
  return Int32Array.from(out);
}

export function normalizeLink(l, i = 0) {
  if (!l || typeof l !== 'object') return null;
  return {
    id: String(l.id || 'link' + i).replace(/[^\w-]/g, '').slice(0, 32) || 'link' + i,
    name: String(l.name || 'Inside').slice(0, 60),
    kind: ['inside', 'open'].includes(l.kind) ? l.kind : 'inside',
    reveal: ['opened', 'always'].includes(l.reveal) ? l.reveal : 'opened',
    revealWith: (Array.isArray(l.revealWith) ? l.revealWith : []).slice(0, 32).map(x => String(x).replace(/[^\w-]/g, '').slice(0, 40)).filter(Boolean),
    ranges: normalizeRanges(l.ranges),
  };
}
export const normalizeLinks = (list) => (Array.isArray(list) ? list.slice(0, 8).map(normalizeLink).filter(Boolean) : []);

// ─── reveal: the inside fades with the doors ────────────────────────────────
/**
 * Writes the inside's opacity into the live Spark mesh from how far the
 * linked parts are open. Needs the part animator (for openness) and the
 * splat indices of the inside in the mesh.
 */
export class InsideReveal {
  constructor(THREE, mesh, animator, links, rest) {
    this.THREE = THREE; this.mesh = mesh; this.animator = animator;
    this.rest = rest || animator?.rest;
    if (!this.rest) throw new Error('Splat is not ready yet.');
    const partMembers = new Set();
    for (const e of animator?.parts?.values?.() || []) for (const i of e.members) partMembers.add(i);
    this.links = normalizeLinks(links).filter(l => l.reveal === 'opened' && l.revealWith.length)
      .map(l => ({ ...l, members: rangesToIndices(l.ranges, this.rest.count).filter(i => !partMembers.has(i)), alpha: -1 }));
    this._v = { c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), col: new THREE.Color() };
    this.raf = 0;
    this._onMove = () => this._loop();
    this._onLit = () => { for (const l of this.links) l.alpha = -1; this.update(); };
    globalThis.addEventListener?.('fumoca:partMove', this._onMove);
    globalThis.addEventListener?.('fumoca:lightingApplied', this._onLit);
    this.update();
  }

  openness(l) {
    let t = 0;
    for (const id of l.revealWith) t = Math.max(t, this.animator?.parts?.get?.(id)?.t || 0);
    return t;
  }

  update() {
    let moving = false;
    for (const l of this.links) {
      const t = this.openness(l), a = Math.min(1, Math.max(0, t * 1.6));   // fully in by ~60 % open
      if (Math.abs(a - l.alpha) > 0.004) { this._write(l, a); moving = true; }
    }
    return moving;
  }

  _loop() {
    cancelAnimationFrame(this.raf);
    let still = 0;
    const tick = () => {
      const changed = this.update();
      const animating = (this.animator?.anims?.size || 0) > 0;
      still = changed || animating ? 0 : still + 1;
      if (still < 10) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  _write(l, a) {
    const splats = this.mesh.packedSplats || this.mesh.splats;
    if (!splats?.setSplat) return;
    const r = this.rest, { c, s, q, col } = this._v;
    const lit = globalThis._fumocaLightingByMesh?.get?.(this.mesh);
    const C = lit?.settings?.enabled && lit.lit?.length === r.colors.length ? lit.lit : r.colors;
    for (const i of l.members) {
      c.set(r.positions[i * 3], r.positions[i * 3 + 1], r.positions[i * 3 + 2]);
      s.set(r.scales[i * 3], r.scales[i * 3 + 1], r.scales[i * 3 + 2]);
      q.set(r.rotations[i * 4 + 1], r.rotations[i * 4 + 2], r.rotations[i * 4 + 3], r.rotations[i * 4]);
      col.setRGB(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      splats.setSplat(i, c, s, q, r.opacity[i] * a, col);
    }
    l.alpha = a;
    splats.needsUpdate = true;
    this.mesh.updateVersion?.();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    globalThis.removeEventListener?.('fumoca:partMove', this._onMove);
    globalThis.removeEventListener?.('fumoca:lightingApplied', this._onLit);
    for (const l of this.links) if (l.alpha !== 1) this._write(l, 1);
  }
}

// ─── picking a point on one of the scans ────────────────────────────────────
/**
 * Front-most splat under the cursor, limited to splats where accept(i) is
 * true. camera is a three.js camera (matrices up to date); px/py are pixels
 * in a w × h view.
 */
export function pickSplat(positions, count, accept, camera, px, py, w, h, radiusPx = 9) {
  camera.updateMatrixWorld?.();
  const V = camera.matrixWorldInverse.elements, Pm = camera.projectionMatrix.elements;
  const step = Math.max(1, Math.floor(count / 600000));
  const cands = [];
  for (let i = 0; i < count; i += step) {
    if (!accept(i)) continue;
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14];
    if (vz >= 0) continue;   // behind the camera
    const cx = Pm[0] * vx + Pm[4] * vy + Pm[8] * vz + Pm[12], cy = Pm[1] * vx + Pm[5] * vy + Pm[9] * vz + Pm[13], cw = Pm[3] * vx + Pm[7] * vy + Pm[11] * vz + Pm[15];
    const sx = (cx / cw * 0.5 + 0.5) * w, sy = (-cy / cw * 0.5 + 0.5) * h;
    const d = Math.hypot(sx - px, sy - py);
    if (d <= radiusPx) cands.push([i, -vz, d]);
  }
  if (!cands.length) return null;
  const front = Math.min(...cands.map(c => c[1]));
  const near = cands.filter(c => c[1] <= front * 1.03 + 1e-9).sort((a, b) => a[2] - b[2]);
  const i = near[0][0];
  return { index: i, point: pos(positions, i) };
}
