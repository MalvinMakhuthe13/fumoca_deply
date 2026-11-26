/**
 * Make a scan sit flat on the grid.
 *
 * Finds the plane the object stands on — a table, a sole, the wheels' contact
 * line, a cap's rim — either from the splats the user selected (the base) or
 * automatically: the plane with many splats on it and (almost) everything else
 * on one side. Returns the turn that puts that plane's "up" on +Y and the move
 * that puts it at y = 0, centred over the origin. CPU only.
 */

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function smallestEigen(C) {
  // Jacobi on a symmetric 3×3; returns the eigenvector of the smallest eigenvalue
  const A = C.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 30; it++) {
    let p = 0, q = 1;
    if (Math.abs(A[0][2]) > Math.abs(A[p][q])) { p = 0; q = 2; }
    if (Math.abs(A[1][2]) > Math.abs(A[p][q])) { p = 1; q = 2; }
    if (Math.abs(A[p][q]) < 1e-15) break;
    const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), c = Math.cos(th), s = Math.sin(th);
    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq; A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq; A[p][q] = A[q][p] = 0;
    for (let k = 0; k < 3; k++) if (k !== p && k !== q) { const akp = A[k][p], akq = A[k][q]; A[k][p] = A[p][k] = c * akp - s * akq; A[k][q] = A[q][k] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  let m = 0; if (A[1][1] < A[m][m]) m = 1; if (A[2][2] < A[m][m]) m = 2;
  const v = [V[0][m], V[1][m], V[2][m]], l = Math.hypot(...v) || 1;
  return v.map(x => x / l);
}

function fitPlane(pts) {
  const c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  return { n: smallestEigen(C), c };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * @param {Float32Array} positions xyz
 * @param {Uint8Array} alive
 * @param {{ selected?: Uint8Array, opacity?: Float32Array, maxSamples?: number }} opts
 * @returns {{ up:number[], height:number, centre:number[], source:'selection'|'auto', support:number }}
 */
export function findBase(positions, alive, { selected = null, opacity = null, maxSamples = 9000 } = {}) {
  const n = alive.length, all = [], sel = [];
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    if (opacity && opacity[i] < 0.25) continue;      // haze doesn't define a base
    all.push(i);
    if (selected?.[i]) sel.push(i);
  }
  if (all.length < 30) throw new Error('Not enough splats to find what the object stands on.');
  const step = Math.max(1, Math.floor(all.length / maxSamples));
  let pts = [];
  for (let k = 0; k < all.length; k += step) { const i = all[k]; pts.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]); }
  // drop the outer 1 % (floaters) per axis
  const lim = [0, 1, 2].map(a => { const v = pts.map(p => p[a]).sort((x, y) => x - y); return [v[Math.floor(v.length * 0.01)], v[Math.ceil((v.length - 1) * 0.99)]]; });
  pts = pts.filter(p => p.every((v, a) => v >= lim[a][0] && v <= lim[a][1]));
  const diag = Math.hypot(...lim.map(([a, b]) => b - a)) || 1;
  const thr = diag * 0.008;
  const sideOf = (nrm, d) => { let pos = 0, neg = 0; for (const p of pts) { const s = dot(nrm, p) - d; if (s > thr) pos++; else if (s < -thr) neg++; } return { pos, neg }; };

  let plane, source, support;
  if (sel.length >= 30) {
    const sp = []; const st = Math.max(1, Math.floor(sel.length / 6000));
    for (let k = 0; k < sel.length; k += st) { const i = sel[k]; sp.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]); }
    plane = fitPlane(sp); source = 'selection'; support = sp.length;
  } else {
    const r = rng(1234), N = pts.length;
    let best = null;
    const consider = (nrm, d) => {
      let inl = 0;
      for (const p of pts) if (Math.abs(dot(nrm, p) - d) < thr) inl++;
      if (inl < N * 0.03) return;
      const { pos, neg } = sideOf(nrm, d), one = Math.max(pos, neg) / Math.max(1, pos + neg);
      const score = inl * one ** 8;
      if (!best || score > best.score) best = { score, nrm, d, inl };
    };
    // the current floor (in case it is already right)
    { const ys = pts.map(p => p[1]).sort((a, b) => a - b); consider([0, 1, 0], ys[Math.floor(ys.length * 0.02)]); }
    for (let it = 0; it < 500; it++) {
      const a = pts[Math.floor(r() * N)], b = pts[Math.floor(r() * N)], c = pts[Math.floor(r() * N)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...nrm); if (l < 1e-12) continue;
      nrm = nrm.map(x => x / l);
      consider(nrm, dot(nrm, a));
    }
    if (!best) throw new Error('No flat base found — select the part it stands on (sole, table, wheels) and try again.');
    // refine on its inliers
    const inl = pts.filter(p => Math.abs(dot(best.nrm, p) - best.d) < thr);
    plane = fitPlane(inl); source = 'auto'; support = best.inl;
  }
  // "up" points to the side the object is on
  let up = plane.n, d = dot(up, plane.c);
  const { pos, neg } = sideOf(up, d);
  if (neg > pos) { up = up.map(x => -x); d = -d; }
  // centre over the base: middle of the object's footprint on the plane
  const proj = pts.map(p => { const s = dot(up, p) - d; return [p[0] - up[0] * s, p[1] - up[1] * s, p[2] - up[2] * s]; });
  const mid = [0, 1, 2].map(a => { const v = proj.map(p => p[a]).sort((x, y) => x - y); return (v[Math.floor(v.length * 0.05)] + v[Math.floor(v.length * 0.95)]) / 2; });
  // the lowest real splats along "up" (a little haze under the base is ignored)
  const hs = pts.map(p => dot(up, p) - d).sort((a, b) => a - b);
  const height = d + Math.min(0, hs[Math.floor(hs.length * 0.005)]);
  return { up, height, centre: mid, source, support };
}

/** Quaternion [x,y,z,w] turning unit vector a onto b. */
export function quatFromTo(a, b) {
  const c = dot(a, b);
  if (c < -0.999999) {   // opposite: any perpendicular axis
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    let v = [a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]];
    const l = Math.hypot(...v); v = v.map(x => x / l);
    return [v[0], v[1], v[2], 0];
  }
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const w = 1 + c, l = Math.hypot(v[0], v[1], v[2], w);
  return [v[0] / l, v[1] / l, v[2] / l, w / l];
}

export function rotateVec(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

/**
 * Apply: turn base-up to +Y, base to y = 0, centred over the origin.
 * S: { positions, rotation [w,x,y,z], alive }. Returns { angleDeg, base }.
 */
export function sitFlat(S, opts = {}) {
  const base = findBase(S.positions, S.alive, { selected: opts.useSelection === false ? null : S.selected, opacity: S.opacity });
  const q = quatFromTo(base.up, [0, 1, 0]);
  const c = rotateVec(q, base.centre), h = base.height;
  // after the turn the base plane sits at y = h (rotation keeps distances along up)
  const shift = [-c[0], -h, -c[2]];
  const [qx, qy, qz, qw] = q;
  for (let i = 0; i < S.alive.length; i++) {
    const p = rotateVec(q, [S.positions[i * 3], S.positions[i * 3 + 1], S.positions[i * 3 + 2]]);
    S.positions[i * 3] = p[0] + shift[0]; S.positions[i * 3 + 1] = p[1] + shift[1]; S.positions[i * 3 + 2] = p[2] + shift[2];
    if (S.rotation) {
      const w = S.rotation[i * 4], x = S.rotation[i * 4 + 1], y = S.rotation[i * 4 + 2], z = S.rotation[i * 4 + 3];
      const nw = qw * w - qx * x - qy * y - qz * z, nx = qw * x + qx * w + qy * z - qz * y, ny = qw * y - qx * z + qy * w + qz * x, nz = qw * z + qx * y - qy * x + qz * w;
      const l = Math.hypot(nw, nx, ny, nz) || 1;
      S.rotation[i * 4] = nw / l; S.rotation[i * 4 + 1] = nx / l; S.rotation[i * 4 + 2] = ny / l; S.rotation[i * 4 + 3] = nz / l;
    }
  }
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, base.up[1]))) * 180 / Math.PI;
  return { angleDeg, base };
}
