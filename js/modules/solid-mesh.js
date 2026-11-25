/**
 * FUMOCA Solid Mesh — Gaussian splat → textured solid mesh, OpenMVS-style.
 *
 * CPU only (no AI, no GPU needed; runs in a Web Worker or Node):
 *   1. RENDER   the splat from many virtual cameras around the object with a
 *               CPU EWA splatting rasteriser → colour + *median* depth per view
 *               (the depth where accumulated opacity crosses 50%: sharp edges,
 *               no floaters).
 *   2. FUSE     the depth maps into a truncated signed distance volume (TSDF)
 *               — like OpenMVS ReconstructMesh / KinectFusion.
 *   3. MESH     extract the zero surface with marching cubes, weld, drop
 *               small islands, light Taubin smoothing.
 *   4. TEXTURE  like OpenMVS TextureMesh: choose the best visible view per
 *               face, smooth the labels, group faces into charts, pack the
 *               charts' pixels into one texture atlas and assign UVs.
 *
 * Output: { positions, normals, uvs, indices, atlas: {width,height,rgba} }
 * which glb-writer.js turns into a .glb.
 */
import { MC_EDGE_TABLE, loadMarchingCubesTriTable } from './fumoc-mesh-extractor.js';

// ─── small vector helpers ──────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Robust bounds (1st–99th percentile) so floaters don't blow up the volume. */
export function robustBounds(positions, count, lo = 0.01, hi = 0.99) {
  const step = Math.max(1, Math.floor(count / 50000));
  const axes = [[], [], []];
  for (let i = 0; i < count; i += step) for (let k = 0; k < 3; k++) axes[k].push(positions[i * 3 + k]);
  const min = [], max = [];
  for (let k = 0; k < 3; k++) {
    const a = axes[k].filter(Number.isFinite).sort((x, y) => x - y);
    min.push(a[Math.floor(lo * (a.length - 1))]); max.push(a[Math.ceil(hi * (a.length - 1))]);
  }
  return { min, max };
}

/** Cameras on rings around the object, all looking at its centre. */
export function orbitCameras(bounds, { count = 40, fovDeg = 40, width = 512, height = 512 } = {}) {
  const c = [0, 1, 2].map(k => (bounds.min[k] + bounds.max[k]) / 2);
  const r = 0.5 * Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) || 1;
  const fov = fovDeg * Math.PI / 180;
  const dist = r / Math.sin(fov / 2) * 1.05;
  const focal = (width / 2) / Math.tan(fov / 2);
  const elevations = [-35, 0, 30, 62];
  const perRing = Math.max(4, Math.round((count - 2) / elevations.length));
  const dirs = [];
  elevations.forEach((e, ri) => {
    for (let i = 0; i < perRing; i++) {
      const az = (i + (ri % 2) * 0.5) / perRing * Math.PI * 2, el = e * Math.PI / 180;
      dirs.push([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]);
    }
  });
  dirs.push([0, 1, 0.001], [0, -1, 0.001]);
  return dirs.map((d) => {
    const eye = [c[0] + d[0] * dist, c[1] + d[1] * dist, c[2] + d[2] * dist];
    const fwd = norm(sub(c, eye));
    const upHint = Math.abs(fwd[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const right = norm(cross(fwd, upHint));
    const down = cross(fwd, right);          // OpenCV-style: x right, y down, z forward
    return { eye, right, down, fwd, focal, width, height, cx: width / 2, cy: height / 2, near: dist * 0.05 };
  });
}

function quatToMat(w, x, y, z) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Precompute each Gaussian's world covariance (upper triangle). */
export function gaussianCovariances(g) {
  const cov = new Float32Array(g.count * 6);
  for (let i = 0; i < g.count; i++) {
    const q = g.rotations ? [g.rotations[i * 4], g.rotations[i * 4 + 1], g.rotations[i * 4 + 2], g.rotations[i * 4 + 3]] : [1, 0, 0, 0];
    const R = quatToMat(q[0], q[1], q[2], q[3]);
    const s = [g.scales[i * 3], g.scales[i * 3 + 1], g.scales[i * 3 + 2]];
    // M = R·S ; Σ = M·Mᵀ
    const M = [R[0] * s[0], R[1] * s[1], R[2] * s[2], R[3] * s[0], R[4] * s[1], R[5] * s[2], R[6] * s[0], R[7] * s[1], R[8] * s[2]];
    const o = i * 6;
    cov[o] = M[0] * M[0] + M[1] * M[1] + M[2] * M[2];
    cov[o + 1] = M[0] * M[3] + M[1] * M[4] + M[2] * M[5];
    cov[o + 2] = M[0] * M[6] + M[1] * M[7] + M[2] * M[8];
    cov[o + 3] = M[3] * M[3] + M[4] * M[4] + M[5] * M[5];
    cov[o + 4] = M[3] * M[6] + M[4] * M[7] + M[5] * M[8];
    cov[o + 5] = M[6] * M[6] + M[7] * M[7] + M[8] * M[8];
  }
  return cov;
}

/**
 * CPU EWA splatting (front-to-back alpha compositing, like 3DGS).
 * @returns {{ rgb: Uint8Array, depth: Float32Array, alpha: Float32Array }}
 */
export function renderView(g, cov, cam) {
  const { width: W, height: H, focal: f, cx, cy, eye, right, down, fwd, near } = cam;
  const n = g.count;
  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
  const conA = new Float32Array(n), conB = new Float32Array(n), conC = new Float32Array(n), rad = new Float32Array(n);
  const visible = [];
  let zMax = 0;
  const [r0, r1, r2] = right, [d0, d1, d2] = down, [f0, f1, f2] = fwd;
  for (let i = 0; i < n; i++) {
    if (g.opacities[i] < 1 / 255) continue;
    const dx = g.positions[i * 3] - eye[0], dy = g.positions[i * 3 + 1] - eye[1], dz = g.positions[i * 3 + 2] - eye[2];
    const z = dx * f0 + dy * f1 + dz * f2;
    if (z < near) continue;
    const x = dx * r0 + dy * r1 + dz * r2, y = dx * d0 + dy * d1 + dz * d2;
    const u = f * x / z + cx, v = f * y / z + cy;
    if (u < -W * 0.25 || u > W * 1.25 || v < -H * 0.25 || v > H * 1.25) continue;
    // Σ (world, symmetric) → camera rows (right, down, fwd): C = Rc Σ Rcᵀ
    const o = i * 6;
    const s00 = cov[o], s01 = cov[o + 1], s02 = cov[o + 2], s11 = cov[o + 3], s12 = cov[o + 4], s22 = cov[o + 5];
    // T = Rc · Σ
    const t00 = r0 * s00 + r1 * s01 + r2 * s02, t01 = r0 * s01 + r1 * s11 + r2 * s12, t02 = r0 * s02 + r1 * s12 + r2 * s22;
    const t10 = d0 * s00 + d1 * s01 + d2 * s02, t11 = d0 * s01 + d1 * s11 + d2 * s12, t12 = d0 * s02 + d1 * s12 + d2 * s22;
    const t20 = f0 * s00 + f1 * s01 + f2 * s02, t21 = f0 * s01 + f1 * s11 + f2 * s12, t22 = f0 * s02 + f1 * s12 + f2 * s22;
    const c00 = t00 * r0 + t01 * r1 + t02 * r2, c01 = t00 * d0 + t01 * d1 + t02 * d2, c02 = t00 * f0 + t01 * f1 + t02 * f2;
    const c11 = t10 * d0 + t11 * d1 + t12 * d2, c12 = t10 * f0 + t11 * f1 + t12 * f2, c22 = t20 * f0 + t21 * f1 + t22 * f2;
    const j00 = f / z, j02 = -f * x / (z * z), j11 = f / z, j12 = -f * y / (z * z);
    const a = j00 * j00 * c00 + 2 * j00 * j02 * c02 + j02 * j02 * c22 + 0.3;
    const b = j00 * j11 * c01 + j00 * j12 * c02 + j02 * j11 * c12 + j02 * j12 * c22;
    const c = j11 * j11 * c11 + 2 * j11 * j12 * c12 + j12 * j12 * c22 + 0.3;
    const det = a * c - b * b;
    if (!(det > 1e-12)) continue;
    const mid = 0.5 * (a + c), lam = mid + Math.sqrt(Math.max(0.1, mid * mid - det));
    px[i] = u; py[i] = v; pz[i] = z;
    conA[i] = c / det; conB[i] = -b / det; conC[i] = a / det;
    rad[i] = Math.min(Math.max(W, H) / 4, Math.ceil(3 * Math.sqrt(lam)));
    visible.push(i);
    if (z > zMax) zMax = z;
  }
  // Counting sort by depth (front first).
  const BUCKETS = 65536, scale = (BUCKETS - 1) / (zMax || 1);
  const counts = new Uint32Array(BUCKETS + 1);
  for (const i of visible) counts[Math.min(BUCKETS - 1, (pz[i] * scale) | 0) + 1]++;
  for (let k = 1; k <= BUCKETS; k++) counts[k] += counts[k - 1];
  const order = new Uint32Array(visible.length);
  for (const i of visible) order[counts[Math.min(BUCKETS - 1, (pz[i] * scale) | 0)]++] = i;

  const T = new Float32Array(W * H).fill(1);
  const acc = new Float32Array(W * H * 3);
  const depth = new Float32Array(W * H).fill(NaN);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const op = g.opacities[i];
    if (op < 1 / 255) continue;
    const u = px[i], v = py[i], r = rad[i];
    const x0 = Math.max(0, Math.floor(u - r)), x1 = Math.min(W - 1, Math.ceil(u + r));
    const y0 = Math.max(0, Math.floor(v - r)), y1 = Math.min(H - 1, Math.ceil(v + r));
    const ca = conA[i], cb = conB[i], cc = conC[i];
    const cr = g.colors[i * 3], cg = g.colors[i * 3 + 1], cbl = g.colors[i * 3 + 2], z = pz[i];
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - v;
      for (let x = x0; x <= x1; x++) {
        const p = y * W + x;
        const t = T[p];
        if (t < 1e-3) continue;
        const dx = x + 0.5 - u;
        const power = -0.5 * (ca * dx * dx + 2 * cb * dx * dy + cc * dy * dy);
        if (power > 0 || power < -4.5) continue;
        const alpha = Math.min(0.99, op * Math.exp(power));
        if (alpha < 1 / 255) continue;
        const w = t * alpha;
        acc[p * 3] += w * cr; acc[p * 3 + 1] += w * cg; acc[p * 3 + 2] += w * cbl;
        const nt = t * (1 - alpha);
        if (t >= 0.5 && nt < 0.5) depth[p] = z;
        T[p] = nt;
      }
    }
  }
  const rgb = new Uint8Array(W * H * 3), alpha = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const a = 1 - T[p];
    alpha[p] = a;
    const inv = a > 1e-4 ? 1 / a : 0; // un-premultiply so textures aren't darkened at edges
    rgb[p * 3] = Math.min(255, Math.round(acc[p * 3] * inv * 255));
    rgb[p * 3 + 1] = Math.min(255, Math.round(acc[p * 3 + 1] * inv * 255));
    rgb[p * 3 + 2] = Math.min(255, Math.round(acc[p * 3 + 2] * inv * 255));
  }
  return { rgb, depth, alpha };
}

/** Fuse median-depth maps into a TSDF volume (ray band integration). */
export function fuseTsdf(views, cams, bounds, resolution = 160) {
  const size = [0, 1, 2].map(k => bounds.max[k] - bounds.min[k]);
  const voxel = Math.max(...size) / (resolution - 1);
  const pad = voxel * 4;
  const min = bounds.min.map(v => v - pad);
  const dims = size.map(s => Math.min(resolution + 8, Math.ceil((s + 2 * pad) / voxel) + 1));
  const [NX, NY, NZ] = dims;
  const tsdf = new Float32Array(NX * NY * NZ).fill(1);
  const weight = new Float32Array(NX * NY * NZ);
  const trunc = voxel * 3;
  const step = voxel * 0.5;
  for (let v = 0; v < views.length; v++) {
    const { depth } = views[v], cam = cams[v];
    const { width: W, height: H, focal: f, cx, cy, eye, right, down, fwd } = cam;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = depth[y * W + x];
        if (!(d > 0)) continue;
        // Ray through the pixel centre, parameterised by camera depth z.
        const rx = (x + 0.5 - cx) / f, ry = (y + 0.5 - cy) / f;
        const dir = [fwd[0] + rx * right[0] + ry * down[0], fwd[1] + rx * right[1] + ry * down[1], fwd[2] + rx * right[2] + ry * down[2]];
        for (let z = d - trunc; z <= d + trunc; z += step) {
          const wx = eye[0] + dir[0] * z, wy = eye[1] + dir[1] * z, wz = eye[2] + dir[2] * z;
          const ix = Math.round((wx - min[0]) / voxel), iy = Math.round((wy - min[1]) / voxel), iz = Math.round((wz - min[2]) / voxel);
          if (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ) continue;
          const idx = (iz * NY + iy) * NX + ix;
          // Signed distance of the voxel centre to the observed surface, along the view axis.
          const vzc = (min[0] + ix * voxel - eye[0]) * fwd[0] + (min[1] + iy * voxel - eye[1]) * fwd[1] + (min[2] + iz * voxel - eye[2]) * fwd[2];
          const sdf = Math.max(-1, Math.min(1, (d - vzc) / trunc));
          const w0 = weight[idx];
          tsdf[idx] = (tsdf[idx] * w0 + sdf) / (w0 + 1);
          weight[idx] = Math.min(w0 + 1, 255);
        }
      }
    }
  }
  return { tsdf, weight, dims, min, voxel };
}

/** Marching cubes on the TSDF zero level, only where every corner was observed. */
export async function extractSurface(vol, { minWeight = 1 } = {}) {
  const tri = await loadMarchingCubesTriTable();
  const { tsdf, weight, dims: [NX, NY, NZ], min, voxel } = vol;
  const CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const EC = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const at = (x, y, z) => (z * NY + y) * NX + x;
  const verts = [], tris = [];
  const cache = new Map();
  const val = new Float32Array(8);
  for (let z = 0; z < NZ - 1; z++) for (let y = 0; y < NY - 1; y++) for (let x = 0; x < NX - 1; x++) {
    let ok = true, ci = 0;
    for (let k = 0; k < 8; k++) {
      const idx = at(x + CO[k][0], y + CO[k][1], z + CO[k][2]);
      if (weight[idx] < minWeight) { ok = false; break; }
      val[k] = tsdf[idx];
      if (val[k] < 0) ci |= 1 << k;     // behind the surface = inside
    }
    if (!ok) continue;
    const mask = MC_EDGE_TABLE[ci];
    if (!mask) continue;
    const ev = new Array(12);
    for (let e = 0; e < 12; e++) {
      if (!(mask & (1 << e))) continue;
      const [a, b] = EC[e], oa = CO[a], ob = CO[b];
      const kx = x + Math.min(oa[0], ob[0]), ky = y + Math.min(oa[1], ob[1]), kz = z + Math.min(oa[2], ob[2]);
      const axis = oa[0] !== ob[0] ? 0 : oa[1] !== ob[1] ? 1 : 2;
      const key = at(kx, ky, kz) * 3 + axis;
      let vi = cache.get(key);
      if (vi === undefined) {
        const t = val[a] / (val[a] - val[b]);
        vi = verts.length / 3;
        verts.push(min[0] + (x + oa[0] + t * (ob[0] - oa[0])) * voxel,
          min[1] + (y + oa[1] + t * (ob[1] - oa[1])) * voxel,
          min[2] + (z + oa[2] + t * (ob[2] - oa[2])) * voxel);
        cache.set(key, vi);
      }
      ev[e] = vi;
    }
    const base = ci * 16;
    // The table expects "inside = value above iso"; our inside bit order matches, so flip winding for outward normals.
    for (let i = 0; tri[base + i] !== -1; i += 3) tris.push(ev[tri[base + i]], ev[tri[base + i + 2]], ev[tri[base + i + 1]]);
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) };
}

/** Keep connected components with at least `fraction` of the largest one's faces. */
export function keepMainComponents(mesh, fraction = 0.02) {
  const { indices } = mesh, nf = indices.length / 3, nv = mesh.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let f = 0; f < nf; f++) {
    const a = find(indices[f * 3]), b = find(indices[f * 3 + 1]), c = find(indices[f * 3 + 2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const size = new Map();
  for (let f = 0; f < nf; f++) { const r = find(indices[f * 3]); size.set(r, (size.get(r) || 0) + 1); }
  const largest = Math.max(0, ...size.values());
  const keep = [];
  for (let f = 0; f < nf; f++) if (size.get(find(indices[f * 3])) >= largest * fraction) keep.push(indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
  return compact({ positions: mesh.positions, indices: new Uint32Array(keep) });
}

function compact(mesh) {
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1);
  const pos = [];
  const idx = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) {
    const v = mesh.indices[i];
    if (remap[v] < 0) { remap[v] = pos.length / 3; pos.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]); }
    idx[i] = remap[v];
  }
  return { positions: new Float32Array(pos), indices: idx };
}

/** Taubin smoothing (shrink-free) to remove voxel stair-steps. */
export function taubin(mesh, iterations = 2, lambda = 0.5, mu = -0.53) {
  const nv = mesh.positions.length / 3, idx = mesh.indices;
  const nbr = Array.from({ length: nv }, () => new Set());
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  let p = mesh.positions;
  const pass = (factor) => {
    const out = new Float32Array(p.length);
    for (let v = 0; v < nv; v++) {
      let sx = 0, sy = 0, sz = 0, k = 0;
      for (const u of nbr[v]) { sx += p[u * 3]; sy += p[u * 3 + 1]; sz += p[u * 3 + 2]; k++; }
      for (let d = 0; d < 3; d++) {
        const avg = k ? [sx, sy, sz][d] / k : p[v * 3 + d];
        out[v * 3 + d] = p[v * 3 + d] + factor * (avg - p[v * 3 + d]);
      }
    }
    p = out;
  };
  for (let i = 0; i < iterations; i++) { pass(lambda); pass(mu); }
  return { positions: p, indices: idx };
}

export function vertexNormals(mesh) {
  const { positions: p, indices: idx } = mesh;
  const n = new Float32Array(p.length);
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const fn = cross(e1, e2);
    for (const v of [a, b, c]) { n[v] += fn[0]; n[v + 1] += fn[1]; n[v + 2] += fn[2]; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

function project(cam, p) {
  const d = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
  const z = dot(d, cam.fwd);
  return [cam.focal * dot(d, cam.right) / z + cam.cx, cam.focal * dot(d, cam.down) / z + cam.cy, z];
}

/**
 * OpenMVS-style texturing: per-face best view → label smoothing → charts →
 * packed atlas + UVs. Vertices are split where charts meet.
 */
export function textureMesh(mesh, views, cams, { atlasSize = 2048, depthTolerance, padding = 2 } = {}) {
  const { positions: P, indices: I } = mesh;
  const nf = I.length / 3;
  const tol = depthTolerance ?? 0.02;
  const label = new Int32Array(nf).fill(-1);
  const scoreOf = (f, v) => {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const cen = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
    const fn = norm(cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
    const cam = cams[v];
    const toCam = norm(sub(cam.eye, cen));
    const facing = dot(fn, toCam);
    if (facing <= 0.05) return 0;
    const [u, w, z] = project(cam, cen);
    const W = cam.width, H = cam.height;
    if (!(z > 0) || u < 1 || w < 1 || u > W - 2 || w > H - 2) return 0;
    const d = views[v].depth[(w | 0) * W + (u | 0)];
    if (!(Math.abs(d - z) <= tol * z)) return 0;          // occluded or off-surface
    if (views[v].alpha[(w | 0) * W + (u | 0)] < 0.6) return 0;
    return facing * facing * (cam.focal / z);               // prefer head-on and close
  };
  const scores = [];
  for (let f = 0; f < nf; f++) {
    let best = -1, bestS = 0;
    const row = new Float32Array(cams.length);
    for (let v = 0; v < cams.length; v++) { const s = scoreOf(f, v); row[v] = s; if (s > bestS) { bestS = s; best = v; } }
    scores.push(row);
    label[f] = best;
  }
  // Face adjacency through shared edges.
  const edgeFaces = new Map(), adj = Array.from({ length: nf }, () => []);
  for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) {
    const a = I[f * 3 + e], b = I[f * 3 + (e + 1) % 3];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const g = edgeFaces.get(key);
    if (g === undefined) edgeFaces.set(key, f); else { adj[f].push(g); adj[g].push(f); }
  }
  // Fill unseen faces from neighbours, then smooth labels (fewer, bigger charts = fewer seams).
  for (let pass = 0; pass < 8; pass++) {
    let changed = 0;
    for (let f = 0; f < nf; f++) {
      const votes = new Map();
      for (const g of adj[f]) if (label[g] >= 0) votes.set(label[g], (votes.get(label[g]) || 0) + 1);
      let best = label[f], bestN = 0;
      for (const [l, n] of votes) if (n > bestN && (label[f] < 0 || scores[f][l] > 0)) { best = l; bestN = n; }
      if (best !== label[f] && (label[f] < 0 || bestN >= 2)) { label[f] = best; changed++; }
    }
    if (!changed) break;
  }
  for (let f = 0; f < nf; f++) if (label[f] < 0) {
    // Never seen: use the view facing it most, ignoring occlusion.
    let best = 0, bestS = -2;
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const fn = norm(cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]));
    for (let v = 0; v < cams.length; v++) { const s = dot(fn, norm(sub(cams[v].eye, [P[a], P[a + 1], P[a + 2]]))); if (s > bestS) { bestS = s; best = v; } }
    label[f] = best;
  }
  // Charts = connected faces with the same label.
  const chart = new Int32Array(nf).fill(-1), charts = [];
  for (let f = 0; f < nf; f++) {
    if (chart[f] >= 0) continue;
    const id = charts.length, faces = [f];
    chart[f] = id;
    for (let k = 0; k < faces.length; k++) for (const g of adj[faces[k]]) if (chart[g] < 0 && label[g] === label[f]) { chart[g] = id; faces.push(g); }
    charts.push({ view: label[f], faces });
  }
  // Project each chart into its view and measure its pixel box.
  for (const ch of charts) {
    const cam = cams[ch.view];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ch.uv = new Map();
    for (const f of ch.faces) for (let k = 0; k < 3; k++) {
      const v = I[f * 3 + k];
      if (ch.uv.has(v)) continue;
      const [u, w] = project(cam, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      const cu = Math.min(cam.width - 1, Math.max(0, u)), cw = Math.min(cam.height - 1, Math.max(0, w));
      ch.uv.set(v, [cu, cw]);
      x0 = Math.min(x0, cu); y0 = Math.min(y0, cw); x1 = Math.max(x1, cu); y1 = Math.max(y1, cw);
    }
    ch.box = [Math.floor(x0) - padding, Math.floor(y0) - padding, Math.ceil(x1) + padding, Math.ceil(y1) + padding];
    ch.w = ch.box[2] - ch.box[0] + 1; ch.h = ch.box[3] - ch.box[1] + 1;
  }
  // Shelf-pack charts (tallest first); grow the atlas scale down if needed.
  const order = charts.slice().sort((a, b) => b.h - a.h);
  let s = 1;
  const pack = (scale) => {
    let x = 0, y = 0, rowH = 0;
    for (const ch of order) {
      const w = Math.ceil(ch.w * scale) + 1, h = Math.ceil(ch.h * scale) + 1;
      if (x + w > atlasSize) { x = 0; y += rowH; rowH = 0; }
      if (w > atlasSize || y + h > atlasSize) return false;
      ch.at = [x, y]; x += w; rowH = Math.max(rowH, h);
    }
    return true;
  };
  while (!pack(s)) { s *= 0.85; if (s < 0.05) throw new Error('Mesh is too large to texture in one atlas'); }
  // Copy pixels and build the output mesh (vertices split per chart).
  const A = atlasSize, atlas = new Uint8Array(A * A * 4);
  const outPos = [], outUv = [], outIdx = [];
  for (const ch of charts) {
    const view = views[ch.view], cam = cams[ch.view], W = cam.width;
    const [bx, by] = ch.box, [ax, ay] = ch.at;
    const w = Math.ceil(ch.w * s), h = Math.ceil(ch.h * s);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const sx = Math.min(cam.width - 1, Math.max(0, Math.round(bx + xx / s))), sy = Math.min(cam.height - 1, Math.max(0, Math.round(by + yy / s)));
      const src = (sy * W + sx) * 3, dst = ((ay + yy) * A + ax + xx) * 4;
      atlas[dst] = view.rgb[src]; atlas[dst + 1] = view.rgb[src + 1]; atlas[dst + 2] = view.rgb[src + 2]; atlas[dst + 3] = 255;
    }
    const local = new Map();
    for (const f of ch.faces) for (let k = 0; k < 3; k++) {
      const v = I[f * 3 + k];
      let ni = local.get(v);
      if (ni === undefined) {
        ni = outPos.length / 3; local.set(v, ni);
        outPos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        const [u, w2] = ch.uv.get(v);
        outUv.push((ax + (u - bx) * s + 0.5) / A, (ay + (w2 - by) * s + 0.5) / A);
      }
      outIdx.push(ni);
    }
  }
  const out = { positions: new Float32Array(outPos), uvs: new Float32Array(outUv), indices: new Uint32Array(outIdx) };
  out.normals = vertexNormals(out);
  out.atlas = { width: A, height: A, rgba: atlas };
  out.stats = { charts: charts.length, atlasScale: s, faces: nf };
  return out;
}

/**
 * Full pipeline.
 * @param {{count, positions, colors (0..1), opacities (0..1), scales (linear), rotations (w,x,y,z)}} g
 */
export async function gaussiansToSolidMesh(g, opts = {}, onProgress = () => {}) {
  const { views: viewCount = 40, viewSize = 512, resolution = 160, atlasSize = 2048, smoothing = 2 } = opts;
  if (!g?.count) throw new Error('No Gaussians to convert');
  const bounds = robustBounds(g.positions, g.count);
  const cams = orbitCameras(bounds, { count: viewCount, width: viewSize, height: viewSize });
  const cov = gaussianCovariances(g);
  const views = [];
  for (let i = 0; i < cams.length; i++) {
    views.push(renderView(g, cov, cams[i]));
    onProgress(0.05 + 0.55 * (i + 1) / cams.length, `Rendering view ${i + 1}/${cams.length}`);
    await new Promise(r => setTimeout(r, 0));
  }
  onProgress(0.62, 'Fusing depth into a solid volume');
  const vol = fuseTsdf(views, cams, bounds, resolution);
  onProgress(0.72, 'Extracting the surface');
  let mesh = await extractSurface(vol, { minWeight: 1 });
  if (!mesh.indices.length) throw new Error('No surface found — the splat may be too sparse or too small');
  mesh = keepMainComponents(mesh, 0.02);
  if (smoothing) mesh = taubin(mesh, smoothing);
  onProgress(0.82, 'Texturing (choosing the best view per face)');
  const camDist = cams[0].near / 0.05;
  const out = textureMesh(mesh, views, cams, { atlasSize, depthTolerance: 2.5 * vol.voxel / camDist + 0.005 });
  onProgress(1, `Done: ${(out.indices.length / 3).toLocaleString()} triangles, ${out.stats.charts} texture charts`);
  out.stats.voxel = vol.voxel;
  out.stats.views = cams.length;
  return out;
}

export default { gaussiansToSolidMesh, renderView, fuseTsdf, extractSurface, textureMesh, orbitCameras, robustBounds };
