// Floater removal by density + connectivity (no AI, CPU only).
//
// Splats are binned into a voxel grid sized from the scan itself. Cells with
// too few splats are "thin air"; the remaining cells are joined into connected
// pieces (26-neighbour). The biggest piece is the subject; other pieces are
// kept only if they are a real part of the scene (large enough), so a
// house's separate rooms or a product's stand survive while specks go.
//
// Returns a Uint8Array mask: 1 = remove.

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export function floaterMask(positions, alive, { aggression = 0.5, opacity = null } = {}) {
  const n = alive.length;
  const out = new Uint8Array(n);
  const idx = [];
  for (let i = 0; i < n; i++) if (alive[i]) idx.push(i);
  if (idx.length < 200) return out;

  // Robust extent: ignore the outer 1% each side so far specks don't set the grid.
  const step = Math.max(1, Math.floor(idx.length / 50000));
  const ax = [[], [], []];
  for (let k = 0; k < idx.length; k += step) { const i = idx[k]; for (let a = 0; a < 3; a++) ax[a].push(positions[i * 3 + a]); }
  const lo = [], hi = [];
  for (let a = 0; a < 3; a++) { ax[a].sort((p, q) => p - q); lo[a] = percentile(ax[a], 0.01); hi[a] = percentile(ax[a], 0.99); }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;

  // About 2–3 splats per occupied cell on the subject's surface.
  const G = Math.max(24, Math.min(200, Math.round(Math.cbrt(idx.length) * 1.4)));
  const cell = span / G;
  const key = (i) => {
    const x = Math.floor((positions[i * 3] - lo[0]) / cell), y = Math.floor((positions[i * 3 + 1] - lo[1]) / cell), z = Math.floor((positions[i * 3 + 2] - lo[2]) / cell);
    return `${x},${y},${z}`;
  };
  const cells = new Map();
  const cellOf = new Array(n);
  for (const i of idx) {
    const k = key(i); cellOf[i] = k;
    const w = opacity ? Math.max(0.05, Math.min(1, opacity[i])) : 1;
    const c = cells.get(k);
    if (c) { c.count++; c.weight += w; } else cells.set(k, { count: 1, weight: w, comp: -1 });
  }

  // Thin-air threshold relative to how dense the scan is where it is solid.
  // "Solid" = the density that half of all splats sit at or above (weighted by
  // splats, not cells, so thousands of one-splat floater cells can't drag it down).
  const byWeight = [...cells.values()].sort((p, q) => q.weight - p.weight);
  let acc = 0, solid = 1; const half = idx.length * 0.5;
  for (const c of byWeight) { acc += c.count; if (acc >= half) { solid = c.weight; break; } }
  const minW = Math.max(1, solid * (0.04 + 0.16 * aggression));

  // Connected pieces of dense cells.
  const comps = [];
  for (const [k, c] of cells) {
    if (c.weight < minW || c.comp >= 0) continue;
    const id = comps.length; let total = 0, ncell = 0;
    const stack = [k]; c.comp = id;
    while (stack.length) {
      const cur = stack.pop(); const cc = cells.get(cur); total += cc.count; ncell++;
      const [x, y, z] = cur.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const nk = `${x + dx},${y + dy},${z + dz}`; const nc = cells.get(nk);
        if (nc && nc.comp < 0 && nc.weight >= minW) { nc.comp = id; stack.push(nk); }
      }
    }
    comps.push({ total, ncell });
  }
  if (!comps.length) return out;
  // Keep the subject and any separate piece with real substance (a table, a
  // lamp, a stand); drop scraps — a few cells holding a handful of splats.
  const biggest = Math.max(...comps.map(c => c.total));
  const minPts = Math.max(30, idx.length * 0.0005 * (1 + 4 * aggression));
  const minCells = 6 + Math.round(10 * aggression);
  const keepComp = comps.map(c => c.total >= biggest * 0.05 || (c.total >= minPts && c.ncell >= minCells));

  // A splat in a thin cell survives only if its cell shares a face with a kept
  // dense cell and isn't nearly empty (keeps the subject's edges, drops specks).
  const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const edgeMin = Math.max(1, minW * (0.08 + 0.25 * aggression));
  for (const i of idx) {
    const c = cells.get(cellOf[i]);
    if (c.comp >= 0) { if (!keepComp[c.comp]) out[i] = 1; continue; }
    if (c.weight < edgeMin) { out[i] = 1; continue; }
    const [x, y, z] = cellOf[i].split(',').map(Number);
    let near = false;
    for (const [dx, dy, dz] of faces) {
      const nc = cells.get(`${x + dx},${y + dy},${z + dz}`);
      if (nc && nc.comp >= 0 && keepComp[nc.comp]) { near = true; break; }
    }
    if (!near) out[i] = 1;
  }
  return out;
}
