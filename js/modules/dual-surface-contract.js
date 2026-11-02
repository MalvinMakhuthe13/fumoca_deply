/**
 * Dual-surface source contract.
 *
 * A reconstructed mesh is derived from the current Gaussian state. This
 * signature lets save/export paths detect when the source splat has changed
 * since the mesh was generated, rather than silently publishing a stale pair.
 */
export function computeGaussianSourceSignature(state) {
  if (!state?.positions || !state?.alive) return null;

  let h1 = 2166136261;
  let h2 = 0x9e3779b9;
  const mix = (value) => {
    const n = Number.isFinite(Number(value)) ? Math.round(Number(value) * 1e6) | 0 : 0;
    h1 = Math.imul(h1 ^ n, 16777619);
    h2 = Math.imul(h2 + n, 2246822519);
    h2 ^= h2 >>> 13;
  };

  const keys = [
    'positions', 'alive', 'scaleXYZ', 'scale', 'rotation',
    'opacity', 'colors', 'paintColors',
  ];
  for (const key of keys) {
    const array = state[key];
    mix(array?.length ?? -1);
    if (!array) continue;

    if (array instanceof Float32Array) {
      const bits = new Uint32Array(array.buffer, array.byteOffset, array.length);
      for (let i = 0; i < bits.length; i++) {
        h1 = Math.imul(h1 ^ bits[i], 16777619);
        h2 = Math.imul(h2 + bits[i], 2246822519);
        h2 ^= h2 >>> 13;
      }
    } else {
      for (let i = 0; i < array.length; i++) mix(array[i]);
    }
  }

  return (h1 >>> 0).toString(16) + ':' + (h2 >>> 0).toString(16);
}

export function compareGaussianSourceSignature(state, savedSignature) {
  const current = computeGaussianSourceSignature(state);
  if (!current || !savedSignature) {
    return {
      ok: false,
      current,
      message: 'The mesh has no verified source signature. Re-extract it before exporting both layers.',
    };
  }
  if (current !== savedSignature) {
    return {
      ok: false,
      current,
      message: 'The Gaussian layer changed after this mesh was generated. Re-extract the solid mesh before exporting both layers.',
    };
  }
  return { ok: true, current, message: '' };
}
