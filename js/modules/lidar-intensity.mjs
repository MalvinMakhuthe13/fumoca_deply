/**
 * Display-only intensity normalization.
 * Raw source samples must remain unchanged for export and analysis.
 */
export function normalizeIntensityForDisplay(values, { lowerPercentile = 0.02, upperPercentile = 0.98 } = {}) {
  if (!values || typeof values.length !== 'number') throw new TypeError('Intensity values must be an array-like collection.');
  if (!(lowerPercentile >= 0 && lowerPercentile < upperPercentile && upperPercentile <= 1)) {
    throw new RangeError('Percentiles must satisfy 0 <= lower < upper <= 1.');
  }
  const valid = [];
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i]);
    if (Number.isFinite(value)) valid.push(value);
  }
  const output = new Float32Array(values.length);
  if (!valid.length) return { values: output, range: null, validCount: 0, method: 'percentile-display-only' };
  valid.sort((a, b) => a - b);
  const quantile = p => valid[Math.min(valid.length - 1, Math.max(0, Math.floor(p * (valid.length - 1))))];
  const min = quantile(lowerPercentile);
  const max = quantile(upperPercentile);
  if (max === min) {
    // A constant-intensity scan has no contrast information. Use neutral grey,
    // rather than pretending the signal is either completely dark or bright.
    for (let i = 0; i < values.length; i++) output[i] = Number.isFinite(Number(values[i])) ? 0.5 : 0;
  } else {
    const inv = 1 / (max - min);
    for (let i = 0; i < values.length; i++) {
      const value = Number(values[i]);
      output[i] = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - min) * inv)) : 0;
    }
  }
  return { values: output, range: { min, max }, validCount: valid.length, method: 'percentile-display-only' };
}
