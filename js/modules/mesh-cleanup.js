/**
 * Mesh clean-up for meshes made from splats (Mesh & Print → Extract /
 * Reconstruct). Works on Studio's mesh: { vertices Float32 xyz, triangles
 * Uint32, colours Uint8 rgb per vertex }. CPU only, no AI.
 *
 *   smoothSurface      Taubin smoothing: removes lumps / bumpiness without
 *                      shrinking the object; edges of open surfaces stay put
 *   removeSpikes       drops stretched "webbing" triangles (very long edges)
 *   trimRaggedEdges    peels the frayed outer ring(s) of an open surface
 *   evenColours        removes colour speckle (neighbour median), keeps edges
 *   simplify           fewer faces (vertex clustering), colours averaged
 *   compact            drops unused vertices
 */

const tri = (m) => m.triangles, vtx = (m) => m.vertices;

/** Unique vertex neighbours from triangles. */
export function vertexNeighbours(nv, triangles) {
  const deg = new Uint32Array(nv);
  for (let i = 0; i < triangles.length; i++) deg[triangles[i]] += 2;
  const start = new Uint32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + deg[v];
  const list = new Uint32Array(start[nv]), fill = start.slice(0, nv);
  for (let f = 0; f < triangles.length; f += 3) {
    const a = triangles[f], b = triangles[f + 1], c = triangles[f + 2];
    list[fill[a]++] = b; list[fill[a]++] = c;
    list[fill[b]++] = a; list[fill[b]++] = c;
    list[fill[c]++] = a; list[fill[c]++] = b;
  }
  return { start, list };
}

/** Vertices on open (boundary) edges. */
export function boundaryVertices(nv, triangles) {
  const count = new Map();
  const key = (a, b) => (a < b ? a * nv + b : b * nv + a);
  for (let f = 0; f < triangles.length; f += 3) {
    const t = [triangles[f], triangles[f + 1], triangles[f + 2]];
    for (let e = 0; e < 3; e++) { const k = key(t[e], t[(e + 1) % 3]); count.set(k, (count.get(k) || 0) + 1); }
  }
  const out = new Uint8Array(nv);
  for (const [k, c] of count) if (c === 1) { out[Math.floor(k / nv)] = 1; out[k % nv] = 1; }
  return out;
}

export function compact(mesh) {
  const v = vtx(mesh), t = tri(mesh), nv = v.length / 3, map = new Int32Array(nv).fill(-1);
  let n = 0;
  for (let i = 0; i < t.length; i++) if (map[t[i]] < 0) map[t[i]] = n++;
  const V = new Float32Array(n * 3), C = mesh.colours ? new Uint8Array(n * 3) : null;
  for (let i = 0; i < nv; i++) if (map[i] >= 0) {
    const j = map[i];
    V[j * 3] = v[i * 3]; V[j * 3 + 1] = v[i * 3 + 1]; V[j * 3 + 2] = v[i * 3 + 2];
    if (C) { C[j * 3] = mesh.colours[i * 3]; C[j * 3 + 1] = mesh.colours[i * 3 + 1]; C[j * 3 + 2] = mesh.colours[i * 3 + 2]; }
  }
  const T = new Uint32Array(t.length);
  for (let i = 0; i < t.length; i++) T[i] = map[t[i]];
  return { ...mesh, vertices: V, triangles: T, colours: C || mesh.colours, removedVertices: nv - n };
}

/**
 * Taubin λ|μ smoothing (no shrinking). strength 0…1 → iterations.
 * Open-surface edges are kept still so the outline doesn't creep in.
 */
export function smoothSurface(mesh, { strength = 0.5, keepEdges = true } = {}) {
  const v = vtx(mesh), nv = v.length / 3;
  const { start, list } = vertexNeighbours(nv, tri(mesh));
  const fixed = keepEdges ? boundaryVertices(nv, tri(mesh)) : new Uint8Array(nv);
  const iterations = Math.max(1, Math.round(2 + strength * 18));
  let P = Float32Array.from(v), Q = new Float32Array(v.length);
  const pass = (k) => {
    for (let i = 0; i < nv; i++) {
      const s = start[i], e = start[i + 1];
      if (fixed[i] || s === e) { Q[i * 3] = P[i * 3]; Q[i * 3 + 1] = P[i * 3 + 1]; Q[i * 3 + 2] = P[i * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let j = s; j < e; j++) { const n = list[j]; x += P[n * 3]; y += P[n * 3 + 1]; z += P[n * 3 + 2]; }
      const c = e - s;
      Q[i * 3] = P[i * 3] + k * (x / c - P[i * 3]);
      Q[i * 3 + 1] = P[i * 3 + 1] + k * (y / c - P[i * 3 + 1]);
      Q[i * 3 + 2] = P[i * 3 + 2] + k * (z / c - P[i * 3 + 2]);
    }
    [P, Q] = [Q, P];
  };
  for (let it = 0; it < iterations; it++) { pass(0.5); pass(-0.53); }
  let moved = 0;
  for (let i = 0; i < v.length; i++) moved = Math.max(moved, Math.abs(P[i] - v[i]));
  return { mesh: { ...mesh, vertices: P }, iterations, maxMove: moved };
}

/** Median edge length (sampled). */
export function medianEdge(mesh) {
  const v = vtx(mesh), t = tri(mesh), L = [];
  const step = Math.max(1, Math.floor(t.length / 3 / 50000));
  for (let f = 0; f < t.length / 3; f += step) {
    const a = t[f * 3], b = t[f * 3 + 1];
    L.push(Math.hypot(v[a * 3] - v[b * 3], v[a * 3 + 1] - v[b * 3 + 1], v[a * 3 + 2] - v[b * 3 + 2]));
  }
  L.sort((x, y) => x - y);
  return L.length ? L[Math.floor(L.length / 2)] : 0;
}

/** Drop triangles with an edge longer than `factor` × the median edge (webbing / spikes). */
export function removeSpikes(mesh, { factor = 4 } = {}) {
  const v = vtx(mesh), t = tri(mesh), lim = medianEdge(mesh) * factor, keep = [];
  let removed = 0;
  const len = (a, b) => Math.hypot(v[a * 3] - v[b * 3], v[a * 3 + 1] - v[b * 3 + 1], v[a * 3 + 2] - v[b * 3 + 2]);
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f], b = t[f + 1], c = t[f + 2];
    if (len(a, b) > lim || len(b, c) > lim || len(c, a) > lim) { removed++; continue; }
    keep.push(a, b, c);
  }
  if (!removed) return { mesh, removedTriangles: 0 };
  return { mesh: compact({ ...mesh, triangles: Uint32Array.from(keep) }), removedTriangles: removed };
}

/** Remove `rings` layers of triangles that touch an open edge (frayed outer border). */
export function trimRaggedEdges(mesh, { rings = 1 } = {}) {
  let m = mesh, removed = 0;
  for (let r = 0; r < rings; r++) {
    const nv = vtx(m).length / 3, b = boundaryVertices(nv, tri(m)), t = tri(m), keep = [];
    let n = 0;
    for (let f = 0; f < t.length; f += 3) {
      if (b[t[f]] || b[t[f + 1]] || b[t[f + 2]]) { n++; continue; }
      keep.push(t[f], t[f + 1], t[f + 2]);
    }
    if (!n || !keep.length) break;
    removed += n;
    m = compact({ ...m, triangles: Uint32Array.from(keep) });
  }
  return { mesh: m, removedTriangles: removed };
}

/** Speckle removal: each vertex colour → median of itself and its neighbours (per channel). */
export function evenColours(mesh, { passes = 1 } = {}) {
  if (!mesh.colours) return { mesh, changed: 0 };
  const nv = vtx(mesh).length / 3, { start, list } = vertexNeighbours(nv, tri(mesh));
  let C = Uint8Array.from(mesh.colours), changed = 0;
  const buf = [[], [], []];
  for (let p = 0; p < passes; p++) {
    const D = new Uint8Array(C.length);
    for (let i = 0; i < nv; i++) {
      for (let k = 0; k < 3; k++) { buf[k].length = 0; buf[k].push(C[i * 3 + k]); }
      const seen = new Set();
      for (let j = start[i]; j < start[i + 1]; j++) {
        const n = list[j]; if (seen.has(n)) continue; seen.add(n);
        for (let k = 0; k < 3; k++) buf[k].push(C[n * 3 + k]);
      }
      for (let k = 0; k < 3; k++) {
        const a = buf[k].sort((x, y) => x - y), med = a[a.length >> 1];
        D[i * 3 + k] = med;
        if (p === passes - 1 && med !== mesh.colours[i * 3 + k]) changed++;
      }
    }
    C = D;
  }
  return { mesh: { ...mesh, colours: C }, changed };
}

/**
 * Fewer faces: vertices in the same grid cell merge (positions and colours
 * averaged); triangles that collapse are dropped. `ratio` 0.1…1 ≈ faces kept.
 */
export function simplify(mesh, { ratio = 0.5 } = {}) {
  const v = vtx(mesh), t = tri(mesh), nv = v.length / 3;
  const e = medianEdge(mesh);
  const cell = Math.max(e * 1e-3, e / Math.sqrt(Math.max(0.02, Math.min(1, ratio))));
  const map = new Int32Array(nv), cells = new Map();
  let n = 0;
  for (let i = 0; i < nv; i++) {
    const k = `${Math.floor(v[i * 3] / cell)},${Math.floor(v[i * 3 + 1] / cell)},${Math.floor(v[i * 3 + 2] / cell)}`;
    let id = cells.get(k);
    if (id === undefined) { id = n++; cells.set(k, id); }
    map[i] = id;
  }
  const V = new Float64Array(n * 3), C = new Float64Array(n * 3), cnt = new Uint32Array(n);
  for (let i = 0; i < nv; i++) {
    const j = map[i]; cnt[j]++;
    for (let k = 0; k < 3; k++) { V[j * 3 + k] += v[i * 3 + k]; if (mesh.colours) C[j * 3 + k] += mesh.colours[i * 3 + k]; }
  }
  const outV = new Float32Array(n * 3), outC = mesh.colours ? new Uint8Array(n * 3) : null;
  for (let j = 0; j < n; j++) for (let k = 0; k < 3; k++) { outV[j * 3 + k] = V[j * 3 + k] / cnt[j]; if (outC) outC[j * 3 + k] = Math.round(C[j * 3 + k] / cnt[j]); }
  const seen = new Set(), keep = [];
  for (let f = 0; f < t.length; f += 3) {
    const a = map[t[f]], b = map[t[f + 1]], c = map[t[f + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) continue; seen.add(s);
    keep.push(a, b, c);
  }
  const out = compact({ ...mesh, vertices: outV, triangles: Uint32Array.from(keep), colours: outC || mesh.colours });
  return { mesh: out, before: t.length / 3, after: keep.length / 3 };
}

/** One-click: the usual order for a scan mesh. */
export function autoClean(mesh, { smooth = 0.4, spikes = 4, rings = 1, colours = true } = {}) {
  const log = [];
  let m = mesh, r;
  r = removeSpikes(m, { factor: spikes }); m = r.mesh; if (r.removedTriangles) log.push(`${r.removedTriangles} stretched faces removed`);
  r = trimRaggedEdges(m, { rings }); m = r.mesh; if (r.removedTriangles) log.push(`${r.removedTriangles} frayed edge faces trimmed`);
  r = smoothSurface(m, { strength: smooth }); m = r.mesh; log.push('surface smoothed');
  if (colours) { r = evenColours(m); m = r.mesh; if (r.changed) log.push('colour speckle evened'); }
  return { mesh: m, log };
}
