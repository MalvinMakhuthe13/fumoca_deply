/**
 * Collision between splat objects (layers), built from voxels — CPU only.
 *
 * Each solid layer is turned into the set of small cubes (voxels) its solid
 * splats occupy. Two layers collide when one's splats fall in the other's
 * voxels. That hugs the real shape (a mug's handle, a chair's legs) far better
 * than a bounding box, and it is fast enough to check on every move.
 *
 *   voxelize       occupied voxels of some splats
 *   overlapCount   how many of a layer's splats sit in another's voxels
 *   backOff        largest part of a move that doesn't push into anything
 *   dropDistance   how far a layer can fall before it rests on something
 */

const key = (x, y, z) => `${x},${y},${z}`;

/** Voxels of the given splats (solid ones only); a voxel needs `minHits` splats. */
export function voxelize(positions, indices, cell, { opacity = null, minHits = 0 } = {}) {
  const hits = new Map();
  for (const i of indices) {
    if (opacity && opacity[i] < 0.3) continue;
    const k = key(Math.floor(positions[i * 3] / cell), Math.floor(positions[i * 3 + 1] / cell), Math.floor(positions[i * 3 + 2] / cell));
    hits.set(k, (hits.get(k) || 0) + 1);
  }
  // a voxel needs a couple of splats to count (drops stray specks) — unless the
  // scan is sparse at this size, where that would punch holes in its skin
  if (!minHits) {
    const counts = [...hits.values()].sort((a, b) => a - b);
    minHits = counts.length && counts[Math.floor(counts.length / 2)] >= 4 ? 2 : 1;
  }
  const set = new Set();
  for (const [k, n] of hits) if (n >= minHits) set.add(k);
  return { cell, set: fillInside(set) };
}

/**
 * A scan is a skin: fill closed shapes so something pushed into a box hits
 * its inside, not just its walls. The skin is thickened by one voxel to close
 * small holes, the outside is flooded from the edges, and whatever the flood
 * can't reach is inside. Open shapes simply stay a skin.
 */
export function fillInside(set, { maxCells = 2_500_000 } = {}) {
  if (!set.size) return set;
  const pts = [...set].map(k => k.split(',').map(Number));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let a = 0; a < 3; a++) { if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] > hi[a]) hi[a] = p[a]; }
  for (let a = 0; a < 3; a++) { lo[a] -= 2; hi[a] += 2; }
  const [nx, ny, nz] = [0, 1, 2].map(a => hi[a] - lo[a] + 1);
  if (nx * ny * nz > maxCells) return set;
  const at = (x, y, z) => (x - lo[0]) + nx * ((y - lo[1]) + ny * (z - lo[2]));
  const wall = new Uint8Array(nx * ny * nz);
  for (const [x, y, z] of pts) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) wall[at(x + dx, y + dy, z + dz)] = 1;
  const out = new Uint8Array(nx * ny * nz), stack = [at(lo[0], lo[1], lo[2])];
  out[stack[0]] = 1;
  while (stack.length) {
    const c = stack.pop(), x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const j = X + nx * (Y + ny * Z);
      if (out[j] || wall[j]) continue;
      out[j] = 1; stack.push(j);
    }
  }
  const filled = new Set(set);
  for (let j = 0; j < out.length; j++) {
    if (out[j]) continue;
    const x = j % nx, y = Math.floor(j / nx) % ny, z = Math.floor(j / (nx * ny));
    // inside cells, and the thickening on the inner side (not touching the outside)
    if (wall[j]) {
      let outer = false;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const X = x + dx, Y = y + dy, Z = z + dz; if (X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz && out[X + nx * (Y + ny * Z)]) { outer = true; break; } }
      if (outer) continue;
    }
    filled.add(key(x + lo[0], y + lo[1], z + lo[2]));
  }
  return filled;
}

/** A sample of a layer's solid splats, as plain points (for quick tests). */
export function samplePoints(positions, indices, { opacity = null, max = 20000 } = {}) {
  const solid = opacity ? indices.filter(i => opacity[i] >= 0.3) : indices;
  const step = Math.max(1, Math.floor(solid.length / max)), out = [];
  for (let k = 0; k < solid.length; k += step) { const i = solid[k]; out.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
  return Float32Array.from(out);
}

/** How many of these points (shifted by offset) are inside the voxels. */
export function overlapCount(points, vox, offset = [0, 0, 0]) {
  const c = vox.cell; let n = 0;
  for (let i = 0; i < points.length; i += 3) {
    if (vox.set.has(key(Math.floor((points[i] + offset[0]) / c), Math.floor((points[i + 1] + offset[1]) / c), Math.floor((points[i + 2] + offset[2]) / c)))) n++;
  }
  return n;
}

/** Touching is fine, pushing in isn't: a few splats may graze. */
export const touches = (points, vox, offset) => overlapCount(points, vox, offset) > Math.max(3, points.length / 3 * 0.004);

/**
 * The layer has been moved by `delta`, and its points are where they ended up.
 * Returns the fraction of the move to keep (1 = all of it) so it stops where
 * it meets something instead of passing into it.
 */
export function backOff(points, vox, delta) {
  const back = (f) => [-(1 - f) * delta[0], -(1 - f) * delta[1], -(1 - f) * delta[2]];
  // resting contact where it started (sitting on a table) is allowed; pushing deeper isn't
  const start = overlapCount(points, vox, back(0)), tol = Math.max(3, points.length / 3 * 0.004);
  const limit = Math.max(tol, start * 1.25 + tol);
  const into = (f) => overlapCount(points, vox, back(f)) > limit;
  if (!into(1)) return 1;
  if (start > points.length / 3 * 0.5) return null;   // already deep inside before the move: not ours to fix
  let lo = 0, hi = 1;
  for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (into(m)) hi = m; else lo = m; }
  return lo;
}

/**
 * How far the layer can fall (along −y) before resting on something in `vox`
 * or reaching `floorY` with its lowest splats. Returns a distance ≥ 0.
 */
export function dropDistance(points, vox, floorY = -Infinity) {
  let low = Infinity; for (let i = 1; i < points.length; i += 3) low = Math.min(low, points[i]);
  const maxFall = Number.isFinite(floorY) ? Math.max(0, low - floorY) : 1e3;
  if (maxFall === 0) return 0;
  const step = vox.cell * 0.5;
  let d = 0;
  while (d + step <= maxFall && !touches(points, vox, [0, -(d + step), 0])) d += step;
  if (d + step > maxFall && !touches(points, vox, [0, -maxFall, 0])) return maxFall;   // lands on the floor
  // refine to the contact
  let lo = d, hi = Math.min(maxFall, d + step);
  for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (touches(points, vox, [0, -m, 0])) hi = m; else lo = m; }
  return lo;
}

/** A sensible voxel size for a scene: 1/100 of its size. */
export function cellFor(positions, alive) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const st = Math.max(1, Math.floor(alive.length / 50000));
  for (let i = 0; i < alive.length; i += st) if (alive[i]) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return Math.max(1e-4, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 100);
}

const api = { voxelize, samplePoints, overlapCount, touches, backOff, dropDistance, cellFor };
if (typeof window !== 'undefined') window.FumocaCollision = api;
export default api;
