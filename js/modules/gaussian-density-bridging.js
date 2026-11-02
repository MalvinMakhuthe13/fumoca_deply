/**
 * Directionally constrained density bridging.
 *
 * Fills only small low-density cavities surrounded by coherent support from
 * multiple opposing directions. Unlike a separable blur, it does not spread
 * density indiscriminately across every voxel face. A single opposing pair
 * (the usual signature of two close, separate sheets) is insufficient.
 *
 * This is a local continuity repair, not semantic segmentation or recovery of
 * unobserved geometry. Keep the source density immutable.
 */
export function bridgeDensityField(field, iterations = 1, options = {}) {
  const { density, resolution: R } = field || {};
  const passes = Math.max(0, Math.min(3, Math.floor(Number(iterations) || 0)));
  if (!density?.length || !R || !passes) return field;

  const relativeSupport = Math.max(0.001, Math.min(0.2, Number(options.relativeSupport) || 0.025));
  const relativeCavity = Math.max(0.05, Math.min(0.8, Number(options.relativeCavity) || 0.42));
  const fillRatio = Math.max(0.1, Math.min(0.95, Number(options.fillRatio) || 0.62));
  let current = density;
  let bridgedTotal = 0;
  let maxDensity = 0;
  for (let i = 0; i < current.length; i++) if (current[i] > maxDensity) maxDensity = current[i];
  if (!(maxDensity > 0)) return field;

  const plane = R * R;
  // Half of the 26-neighbourhood: each vector represents one opposing pair.
  const directions = [];
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    if (!x && !y && !z) continue;
    if (z < 0 || (z === 0 && y < 0) || (z === 0 && y === 0 && x < 0)) directions.push([x, y, z]);
  }

  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    let bridgedThisPass = 0;
    for (let z = 1; z < R - 1; z++) for (let y = 1; y < R - 1; y++) for (let x = 1; x < R - 1; x++) {
      const index = z * plane + y * R + x;
      const center = current[index];
      // A candidate cannot pass the local cavity test if it already exceeds
      // the cavity fraction of the global maximum (localMean cannot be higher).
      if (center >= maxDensity * relativeCavity) continue;
      let supportSum = 0, supportCount = 0, opposingPairs = 0;
      for (const [dx, dy, dz] of directions) {
        const a = current[(z + dz) * plane + (y + dy) * R + x + dx];
        const b = current[(z - dz) * plane + (y - dy) * R + x - dx];
        if (a >= maxDensity * relativeSupport && b >= maxDensity * relativeSupport) {
          const hi = Math.max(a, b), lo = Math.min(a, b);
          // Do not bridge across a strong density discontinuity.
          if (lo / Math.max(hi, 1e-12) >= 0.22) {
            opposingPairs++;
            supportSum += a + b;
            supportCount += 2;
          }
        }
      }
      // At least three independent opposing directions are needed. This
      // rejects a simple narrow gap between two facing, separate surfaces.
      if (opposingPairs < 3 || supportCount < 6) continue;
      const localMean = supportSum / supportCount;
      if (!(localMean > 0) || center >= localMean * relativeCavity) continue;
      const value = Math.min(localMean * fillRatio, maxDensity * 0.75);
      if (value > center) {
        next[index] = value;
        bridgedThisPass++;
      }
    }
    current = next;
    bridgedTotal += bridgedThisPass;
    if (!bridgedThisPass) break;
  }
  return {
    ...field,
    density: current,
    densityBridging: {
      passes,
      bridgedVoxels: bridgedTotal,
      method: 'opposed-support-cavity-bridge',
      relativeSupport,
      relativeCavity,
      fillRatio,
    },
  };
}

export default { bridgeDensityField };
