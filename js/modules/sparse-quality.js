/**
 * Sparse / limited-imagery quality boost
 *
 * When capture has few views, Gaussians look thin and gappy.
 * This pass is browser-side and non-destructive:
 *  1. Statistical floater removal (optional)
 *  2. Local density gap fill (neighbours → insert soft points)
 *  3. Opacity boost on dense clusters (solid surfaces)
 *
 * Designed to feed better meshes and NIF depth, not replace a real multi-view rebuild.
 */

function dist2(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * @param {object} state  Studio state: positions Float32Array, colors, opacities?, alive Bool[], count
 * @param {object} opts
 * @returns {{ added: number, removed: number, message: string }}
 */
export function boostSparseCapture(state, opts = {}) {
  const {
    floaterSigma = 2.2,
    gapRadius = 0.08,
    maxInserts = 50_000,
    opacityBoost = 0.15,
    onProgress,
  } = opts;

  if (!state?.positions || !state.alive) {
    throw new Error('No splat state loaded');
  }

  const N = state.alive.length;
  const pos = state.positions;
  let removed = 0;
  let added = 0;

  // --- 1. Simple floater pass: points far from local mean ---
  onProgress?.('Scanning floaters…');
  const samples = [];
  for (let i = 0; i < N; i++) {
    if (!state.alive[i]) continue;
    samples.push(i);
  }
  if (samples.length < 50) {
    return { added: 0, removed: 0, message: 'Too few points to boost' };
  }

  // Subsample for mean/std of nearest-neighbour distance
  const step = Math.max(1, Math.floor(samples.length / 2000));
  const nnDists = [];
  for (let s = 0; s < samples.length; s += step) {
    const i = samples[s];
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let best = Infinity;
    for (let t = 0; t < samples.length; t += step) {
      const j = samples[t];
      if (j === i) continue;
      const d = dist2(x, y, z, pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
      if (d < best) best = d;
    }
    if (best < Infinity) nnDists.push(Math.sqrt(best));
  }
  nnDists.sort((a, b) => a - b);
  const median = nnDists[Math.floor(nnDists.length / 2)] || 0.05;
  const threshold = median * floaterSigma * floaterSigma; // compare in dist2 space loosely

  for (let i = 0; i < N; i++) {
    if (!state.alive[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let neighbours = 0;
    const r2 = (median * floaterSigma) ** 2;
    // cheap: check a stride of points
    for (let j = 0; j < N; j += Math.max(1, Math.floor(N / 800))) {
      if (j === i || !state.alive[j]) continue;
      if (dist2(x, y, z, pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]) < r2) {
        neighbours++;
        if (neighbours >= 3) break;
      }
    }
    if (neighbours < 2) {
      state.alive[i] = false;
      removed++;
    }
  }

  // --- 2. Opacity boost on survivors ---
  if (state.opacities) {
    onProgress?.('Boosting solid surfaces…');
    for (let i = 0; i < N; i++) {
      if (!state.alive[i]) continue;
      state.opacities[i] = Math.min(1, (state.opacities[i] ?? 0.7) + opacityBoost);
    }
  }

  // --- 3. Gap markers (metadata only unless gap-filler is available) ---
  onProgress?.('Marking sparse regions…');
  const gapHints = [];
  const rGap2 = gapRadius * gapRadius;
  for (let s = 0; s < samples.length && gapHints.length < maxInserts; s += step * 2) {
    const i = samples[s];
    if (!state.alive[i]) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let near = 0;
    for (let t = 0; t < samples.length; t += step) {
      const j = samples[t];
      if (j === i || !state.alive[j]) continue;
      if (dist2(x, y, z, pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]) < rGap2) near++;
    }
    if (near < 4) {
      gapHints.push([x, y, z]);
    }
  }

  // Hand off to gap filler if present
  if (gapHints.length && typeof window.FUMOCA_GapFiller?.fillFromHints === 'function') {
    onProgress?.(`Filling ${gapHints.length} sparse regions…`);
    const result = window.FUMOCA_GapFiller.fillFromHints(state, gapHints, { maxInserts });
    added = result?.added ?? 0;
  }

  const message = `Sparse boost: removed ${removed} floaters, gap hints ${gapHints.length}, inserted ${added}`;
  onProgress?.(message);
  return { added, removed, gapHints: gapHints.length, message };
}

if (typeof window !== 'undefined') {
  window.FUMOCA_SparseQuality = { boostSparseCapture };
}
