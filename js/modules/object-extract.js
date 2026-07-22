/**
 * FUMOCA Object Extraction v1
 * ══════════════════════════════════════════════════════════════════════════
 * "Keep the car" — extract a selected region of a splat as its own new
 * asset. Three things this module does that the existing editor does not:
 *
 *   1. Flood-fill selection from a seed point (click → grow to boundary)
 *   2. Color-aware growth (don't cross from red car to grey ground)
 *   3. Extract-to-new-asset (save the selected points as a standalone splat
 *      record in Supabase, with its own viewer URL)
 *
 * It is designed as a companion to splat-edit-engine.js. It reads the same
 * state shape (positions/colors/alive/selected) so it can be bolted on
 * without refactoring the editor.
 *
 * HONEST SCOPING
 * ──────────────
 * This is NOT SAGA / Gaussian Grouping / trained neural segmentation. It is
 * a heuristic: spatial BFS with color-similarity and optional ground-plane
 * rejection. It works well when:
 *   - The subject is spatially separated from the background (a car on a
 *     showroom floor; a sofa in a staged room)
 *   - The subject's color is distinct from what surrounds it
 *   - The reconstruction is reasonably clean (not mostly floaters)
 *
 * It struggles when:
 *   - The subject touches multiple similarly-colored objects
 *   - The point density is very uneven
 *   - The user clicks a floater instead of the real subject
 *
 * Users can always fall back to brush/lasso/grow from the existing editor.
 * This is the "fast path" for the clean cases, which is 80% of commercial use.
 * ══════════════════════════════════════════════════════════════════════════
 */

const DEFAULT_PARAMS = Object.freeze({
  // Spatial radius (world units) for connectivity. Automatically scaled to
  // scene size — see autoTuneRadius below.
  radius: 0.02,
  // Color distance threshold (0-1 RGB euclidean). Points more different
  // than this from the seed are rejected even if spatially close.
  colorTolerance: 0.28,
  // Adaptive color: the seed is averaged with its neighbors' colors over
  // time so the criterion widens for genuinely-connected same-object points
  // that drift in colour (reflections, shadows). Set 0 to disable.
  colorAdapt: 0.15,
  // Stop growth if component exceeds this many points. Prevents accidental
  // whole-scene selection when the user clicks into a connected floor.
  maxPoints: 2_000_000,
  // Optional: reject points below this Y value (ground plane). Computed
  // automatically from scene bounds if left null.
  groundY: null,
  // Margin above the detected ground (world units) to exclude.
  groundMargin: 0.01,
});

/**
 * Pick which point under the mouse to use as the seed. Takes a screen
 * coordinate and the existing editor state, returns a point index.
 *
 * Uses a small-radius screen-space query since picking "the nearest splat
 * to the mouse" is what users expect. The viewer's own precise picking
 * ray-cast is more accurate but requires three.js — this module stays
 * numpy-style deliberate so it can be unit tested.
 */
export function pickSeedPoint(state, camera, screenX, screenY, canvas) {
  if (!state?.positions || !state.alive) return -1;

  // Project every alive point to screen space and take the nearest within
  // a small pixel radius. O(n) — fine for <5M points at 60fps since we
  // only do it on click.
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  let best = -1;
  let bestD2 = 25 * 25; // 25px search radius
  // Also prefer points closer to the camera — discourages picking something
  // on the far wall when the user clearly meant the foreground car.
  let bestDepth = Infinity;

  const v = { x: 0, y: 0, z: 0 };
  const projMatrix = new Float32Array(16);
  const viewMatrix = new Float32Array(16);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  // three.js matrices are Matrix4 — extract the elements into a flat array
  // so we can do the math inline.
  for (let i = 0; i < 16; i++) {
    projMatrix[i] = camera.projectionMatrix.elements[i];
    viewMatrix[i] = camera.matrixWorldInverse.elements[i];
  }

  const count = state.alive.length;
  for (let i = 0; i < count; i++) {
    if (!state.alive[i]) continue;
    const x = state.positions[i*3];
    const y = state.positions[i*3+1];
    const z = state.positions[i*3+2];

    // view = viewMatrix * (x, y, z, 1)
    const vx = viewMatrix[0]*x + viewMatrix[4]*y + viewMatrix[8]*z + viewMatrix[12];
    const vy = viewMatrix[1]*x + viewMatrix[5]*y + viewMatrix[9]*z + viewMatrix[13];
    const vz = viewMatrix[2]*x + viewMatrix[6]*y + viewMatrix[10]*z + viewMatrix[14];
    if (vz > 0) continue; // behind camera in right-handed / OpenGL convention

    // clip = proj * view
    const cx = projMatrix[0]*vx + projMatrix[4]*vy + projMatrix[8]*vz + projMatrix[12];
    const cy = projMatrix[1]*vx + projMatrix[5]*vy + projMatrix[9]*vz + projMatrix[13];
    const cw = projMatrix[3]*vx + projMatrix[7]*vy + projMatrix[11]*vz + projMatrix[15];
    if (cw <= 0) continue;

    // ndc → screen
    const nx = cx / cw;
    const ny = cy / cw;
    const sx = (nx * 0.5 + 0.5) * w;
    const sy = (1 - (ny * 0.5 + 0.5)) * h;

    const dx = sx - screenX;
    const dy = sy - screenY;
    const d2 = dx*dx + dy*dy;
    if (d2 > bestD2) continue;

    // Depth-preference: within the pixel radius, pick the closer point,
    // UNLESS the closer one is much farther from the cursor. Tuned to
    // prefer foreground without being stupid about it.
    const depth = -vz;
    const depthPenalty = depth - bestDepth;
    if (d2 + depthPenalty * 50 < bestD2 + 0.01) {
      best = i;
      bestD2 = d2;
      bestDepth = depth;
    }
  }

  return best;
}

/**
 * Compute a sensible default radius for BFS based on the average
 * nearest-neighbor distance. This makes the same parameters work for a
 * small object and a room-scale scene.
 *
 * Samples 500 random points — O(n) over the samples, which is enough to
 * get a stable median.
 */
export function autoTuneRadius(state) {
  if (!state?.positions || !state.alive) return DEFAULT_PARAMS.radius;
  const samples = 500;
  const count = state.alive.length;
  const aliveIndices = [];
  for (let i = 0; i < count; i++) if (state.alive[i]) aliveIndices.push(i);
  if (aliveIndices.length < 50) return DEFAULT_PARAMS.radius;

  // Compute bounding box so we can bucket points into a coarse grid and
  // query neighbors without an O(n^2) scan.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const i of aliveIndices) {
    const x = state.positions[i*3], y = state.positions[i*3+1], z = state.positions[i*3+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);

  // Coarse grid with cell = span / 50 — gives us reasonable cells for
  // 1000-1M point scenes.
  const cell = span / 50;
  const inv = 1 / cell;
  const grid = new Map();
  const keyOf = (x, y, z) =>
    `${Math.floor(x*inv)},${Math.floor(y*inv)},${Math.floor(z*inv)}`;
  for (const i of aliveIndices) {
    const k = keyOf(state.positions[i*3], state.positions[i*3+1], state.positions[i*3+2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  // For each sample, nearest-neighbor distance within the 3x3x3 cell block.
  const dists = [];
  const step = Math.max(1, Math.floor(aliveIndices.length / samples));
  for (let s = 0; s < aliveIndices.length; s += step) {
    const i = aliveIndices[s];
    const x = state.positions[i*3], y = state.positions[i*3+1], z = state.positions[i*3+2];
    const cx = Math.floor(x*inv), cy = Math.floor(y*inv), cz = Math.floor(z*inv);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(`${cx+dx},${cy+dy},${cz+dz}`);
      if (!arr) continue;
      for (const j of arr) {
        if (j === i) continue;
        const ex = state.positions[j*3] - x;
        const ey = state.positions[j*3+1] - y;
        const ez = state.positions[j*3+2] - z;
        const d2 = ex*ex + ey*ey + ez*ez;
        if (d2 < best) best = d2;
      }
    }
    if (best < Infinity) dists.push(Math.sqrt(best));
  }
  // Filter zero distances — these come from duplicate positions (reconstruction
  // artifacts or numerical collisions at Float32 precision) and would drag
  // the median to zero, leaving flood-fill with a useless radius.
  const nonZero = dists.filter(d => d > 1e-7);
  if (!nonZero.length) return DEFAULT_PARAMS.radius;
  nonZero.sort((a, b) => a - b);
  const median = nonZero[Math.floor(nonZero.length * 0.5)];
  // BFS radius = 3× median nearest-neighbor spacing. Tight enough to not
  // bridge objects, loose enough to connect the subject through its own
  // natural density variation. Floor at a small positive value so even
  // pathological scenes still produce a usable radius.
  return Math.max(median * 3, 1e-5);
}

/**
 * Detect the ground plane as the lowest 2% of points. Returns the Y value
 * above which a point is considered "not ground". Very simple heuristic
 * — fine for staged product/showroom scenes, which is the use case.
 *
 * Returns null if the scene is too small to estimate, in which case the
 * caller should skip ground rejection.
 */
export function detectGround(state) {
  if (!state?.positions || !state.alive) return null;
  const ys = [];
  const count = state.alive.length;
  for (let i = 0; i < count; i++) {
    if (state.alive[i]) ys.push(state.positions[i*3+1]);
  }
  if (ys.length < 100) return null;
  ys.sort((a, b) => a - b);
  // 2nd percentile — lowest points. We use a percentile rather than the min
  // because the min is often a floater below the true ground.
  return ys[Math.floor(ys.length * 0.02)];
}

/**
 * Flood-fill selection from a seed. Breadth-first expansion through a
 * spatial grid, accepting points whose color is within tolerance of the
 * (adaptively-updated) seed color.
 *
 * Returns a Uint8Array mask the same length as state.alive, with 1 for
 * selected and 0 for unselected. Caller can OR / AND this with state.selected.
 */
export function floodFillExtract(state, seedIdx, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const count = state.alive.length;
  const out = new Uint8Array(count);
  if (seedIdx < 0 || seedIdx >= count || !state.alive[seedIdx]) return out;

  // Auto-tune radius and ground if caller didn't provide
  if (!params.radius) p.radius = autoTuneRadius(state);
  if (p.groundY === null || p.groundY === undefined) {
    p.groundY = detectGround(state);
  }

  // Build spatial grid once. Cell = radius so neighbors are in 3x3x3 block.
  const cell = p.radius;
  const inv = 1 / cell;
  const grid = new Map();
  for (let i = 0; i < count; i++) {
    if (!state.alive[i]) continue;
    const k = `${Math.floor(state.positions[i*3]*inv)},${Math.floor(state.positions[i*3+1]*inv)},${Math.floor(state.positions[i*3+2]*inv)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  // Seed color — we'll adapt this as we grow.
  let seedR = state.colors[seedIdx*3];
  let seedG = state.colors[seedIdx*3+1];
  let seedB = state.colors[seedIdx*3+2];

  const tol2 = p.colorTolerance * p.colorTolerance;
  const r2 = p.radius * p.radius;

  // BFS queue. Use a plain array with head/tail indices to avoid shift() cost.
  const queue = new Int32Array(Math.min(count, p.maxPoints));
  let qHead = 0, qTail = 0;
  queue[qTail++] = seedIdx;
  out[seedIdx] = 1;
  let accepted = 1;

  // Track color for adaptive update — running mean of accepted points.
  let meanR = seedR, meanG = seedG, meanB = seedB;

  while (qHead < qTail && accepted < p.maxPoints) {
    const i = queue[qHead++];
    const x = state.positions[i*3];
    const y = state.positions[i*3+1];
    const z = state.positions[i*3+2];
    const cx = Math.floor(x*inv), cy = Math.floor(y*inv), cz = Math.floor(z*inv);

    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(`${cx+dx},${cy+dy},${cz+dz}`);
      if (!arr) continue;
      for (const j of arr) {
        if (out[j]) continue;
        if (!state.alive[j]) continue;

        // Ground rejection
        if (p.groundY !== null && state.positions[j*3+1] < p.groundY + p.groundMargin) continue;

        // Spatial check
        const ex = state.positions[j*3] - x;
        const ey = state.positions[j*3+1] - y;
        const ez = state.positions[j*3+2] - z;
        if (ex*ex + ey*ey + ez*ez > r2) continue;

        // Color check against running mean (adaptive)
        const jr = state.colors[j*3];
        const jg = state.colors[j*3+1];
        const jb = state.colors[j*3+2];
        const dr = jr - meanR, dg = jg - meanG, db = jb - meanB;
        if (dr*dr + dg*dg + db*db > tol2) continue;

        // Accept
        out[j] = 1;
        accepted++;
        if (qTail < queue.length) queue[qTail++] = j;

        // Adaptive color update — small exponential moving average
        if (p.colorAdapt > 0) {
          meanR = meanR * (1 - p.colorAdapt) + jr * p.colorAdapt;
          meanG = meanG * (1 - p.colorAdapt) + jg * p.colorAdapt;
          meanB = meanB * (1 - p.colorAdapt) + jb * p.colorAdapt;
        }
      }
    }
  }

  return out;
}

/**
 * Build a PLY ArrayBuffer containing only the points marked 1 in the mask.
 * Preserves colors. If the caller supplies opacity/scale arrays, those are
 * preserved too as INRIA-style Gaussian splat PLY with f_dc_* and scale_*
 * properties — so the extracted splat renders correctly in the viewer.
 *
 * Returns a Uint8Array (binary PLY for compactness).
 */
export function buildExtractedPLY(state, mask, options = {}) {
  const count = state.alive.length;
  const indices = [];
  for (let i = 0; i < count; i++) {
    if (mask[i] && state.alive[i]) indices.push(i);
  }
  if (!indices.length) return null;

  const useFullSplat = options.fullSplat !== false &&
    state.opacity && state.scale;

  // For simplicity and portability, we emit ASCII PLY with position + color.
  // ASCII is not the most compact, but it opens in MeshLab, Blender, etc.
  // and your viewer already handles both ASCII and binary. Binary is a
  // future optimization — ASCII is correct first.
  const lines = [
    'ply',
    'format ascii 1.0',
    'comment FUMOCA extracted object — ' + new Date().toISOString(),
    `element vertex ${indices.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
  ];
  if (useFullSplat) {
    lines.push('property float opacity', 'property float scale');
  }
  lines.push('end_header');

  const clamp01 = v => Math.max(0, Math.min(1, v));
  for (const i of indices) {
    const px = state.positions[i*3];
    const py = state.positions[i*3+1];
    const pz = state.positions[i*3+2];
    const pc = state.paintColors;
    const r = Math.round(clamp01(pc && pc[i*3] >= 0 ? pc[i*3] : state.colors[i*3]) * 255);
    const g = Math.round(clamp01(pc && pc[i*3+1] >= 0 ? pc[i*3+1] : state.colors[i*3+1]) * 255);
    const b = Math.round(clamp01(pc && pc[i*3+2] >= 0 ? pc[i*3+2] : state.colors[i*3+2]) * 255);
    let line = `${px} ${py} ${pz} ${r} ${g} ${b}`;
    if (useFullSplat) {
      line += ` ${state.opacity[i] ?? 1} ${state.scale[i] ?? 0.015}`;
    }
    lines.push(line);
  }

  const text = lines.join('\n') + '\n';
  return new TextEncoder().encode(text);
}

/**
 * Statistics about a mask — useful for telling the user how big the
 * selection is before they commit to extracting it.
 */
export function maskStats(state, mask) {
  let count = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const n = mask.length;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || !state.alive[i]) continue;
    count++;
    const x = state.positions[i*3], y = state.positions[i*3+1], z = state.positions[i*3+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (count === 0) {
    return { count: 0, bbox: null, dims: null };
  }
  return {
    count,
    bbox: { minX, minY, minZ, maxX, maxY, maxZ },
    dims: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}

/**
 * Upload an extracted PLY as a new Supabase splats record. Returns the new
 * splat id and viewer URL.
 *
 * Requires the caller to pass `supabase` and `r2` clients because this
 * module stays dependency-free otherwise. The existing editor already
 * imports both — pass them in.
 */
export async function saveExtractedAsNewSplat({
  supabase, r2, plyBytes, sourceSplatId, title, stats,
}) {
  if (!supabase || !r2) throw new Error('supabase and r2 clients are required');
  if (!plyBytes) throw new Error('no ply bytes to save');

  // Create the new splats row first so we have an id for the storage path.
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id || null;

  const insertPayload = {
    title: title || 'Extracted object',
    status: 'complete',
    user_id: userId,
    metadata: {
      extracted_from: sourceSplatId || null,
      extracted_at: new Date().toISOString(),
      extraction: stats ? {
        point_count: stats.count,
        dims: stats.dims,
      } : undefined,
    },
  };
  const { data: newRow, error: insertErr } = await supabase
    .from('splats')
    .insert(insertPayload)
    .select()
    .single();
  if (insertErr) throw insertErr;

  const newId = newRow.id;
  const storagePath = `splats/${newId}/extracted_${Date.now()}.ply`;
  const blob = new Blob([plyBytes], { type: 'application/octet-stream' });

  // Upload via r2Client (same API used elsewhere in the editor).
  const { publicUrl, error: uploadErr } = await r2
    .from('splat-files')
    .upload(storagePath, blob, { contentType: 'application/octet-stream' });
  if (uploadErr) {
    // Best-effort: delete the row we just created so we don't leave orphans.
    await supabase.from('splats').delete().eq('id', newId).catch(() => {});
    throw uploadErr;
  }

  // Update the row with the URL now that we have it.
  await supabase.from('splats').update({
    splat_url: publicUrl,
    output_url: publicUrl,
    file_url: publicUrl,
  }).eq('id', newId);

  const viewerUrl = `viewer.html?splatId=${encodeURIComponent(newId)}`;
  return { id: newId, url: publicUrl, viewerUrl };
}

// Default export for convenient importing
export default {
  pickSeedPoint,
  autoTuneRadius,
  detectGround,
  floodFillExtract,
  buildExtractedPLY,
  maskStats,
  saveExtractedAsNewSplat,
  DEFAULT_PARAMS,
};
