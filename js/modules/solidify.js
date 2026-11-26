// Solid splats (the clean, opaque look of KIRI-style captures) — CPU only, no AI.
//
// A raw capture is full of semi-transparent splats: haze, see-through skins,
// long streaks. That looks smoky, lets the far side show through, and makes
// selection, lighting and moving parts harder. Solidify:
//   • makes surface splats opaque (faint ones become solid, strong ones stay)
//   • flattens each splat onto the surface (its thinnest axis gets thinner),
//     so it reads as a crisp skin instead of a fuzzy blob
//   • caps very long streaks to a sensible length
//   • removes haze: splats too faint to be part of any surface
//
// It always works from the scan's own values (orig), so moving the strength
// slider re-applies cleanly and "Back to original" is exact.

/**
 * @param {object} orig   { opacity: Float32Array (0..1), scaleXYZ: Float32Array (linear) }
 * @param {Uint8Array} alive
 * @param {object} opts   strength 0..1, removeHaze boolean
 * @returns {{ opacity, scaleXYZ, remove: Uint8Array, edited: Uint8Array, stats }}
 */
export function solidify(orig, alive, { strength = 0.7, removeHaze = true } = {}) {
  const n = alive.length;
  const s = Math.max(0, Math.min(1, strength));
  const opacity = Float32Array.from(orig.opacity);
  const scaleXYZ = Float32Array.from(orig.scaleXYZ);
  const remove = new Uint8Array(n), edited = new Uint8Array(n);
  if (s === 0) return { opacity, scaleXYZ, remove, edited, stats: { solid: 0, flattened: 0, capped: 0, haze: 0 } };

  // Haze threshold: below this a splat is fog, not surface.
  const hazeCut = 0.04 + 0.16 * s;
  // How opaque: o' = 1 − (1 − o)^(1 + k). k = 0 keeps o, larger k pushes to 1.
  const k = 1 + 5 * s;
  // Flatten: thinnest axis shrinks toward a thin disc (never below 15 % of the middle axis × (1 − s)).
  const flat = 1 - 0.8 * s;
  // Streak cap: longest axis at most this many times the middle axis.
  const maxRatio = 8 - 5 * s;

  let solid = 0, flattened = 0, capped = 0, haze = 0;
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const o = orig.opacity[i];
    if (o < hazeCut) {
      if (removeHaze) { remove[i] = 1; haze++; }
      continue;
    }
    const o2 = 1 - Math.pow(1 - Math.min(0.999, o), 1 + k);
    if (o2 > o + 1e-4) { opacity[i] = o2; solid++; }

    const a = scaleXYZ[i * 3], b = scaleXYZ[i * 3 + 1], c = scaleXYZ[i * 3 + 2];
    // order the three axes
    let lo = 0, hi = 0;
    const v = [a, b, c];
    for (let j = 1; j < 3; j++) { if (v[j] < v[lo]) lo = j; if (v[j] > v[hi]) hi = j; }
    if (lo !== hi) {
      const midV = v[3 - lo - hi];
      const thin = Math.max(v[lo] * flat, midV * 0.04, 1e-6);
      if (thin < v[lo] - 1e-9) { scaleXYZ[i * 3 + lo] = thin; flattened++; }
      if (v[hi] > midV * maxRatio) { scaleXYZ[i * 3 + hi] = midV * maxRatio; capped++; }
    }
    edited[i] = 1;
  }
  return { opacity, scaleXYZ, remove, edited, stats: { solid, flattened, capped, haze } };
}
