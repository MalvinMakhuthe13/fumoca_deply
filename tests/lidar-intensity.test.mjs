import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIntensityForDisplay } from '../js/modules/lidar-intensity.js';

test('normalizes intensity for display without mutating raw samples', () => {
  const raw = new Uint16Array([0, 100, 200, 300, 65535]);
  const before = Array.from(raw);
  const result = normalizeIntensityForDisplay(raw, { lowerPercentile: 0, upperPercentile: 1 });
  assert.equal(result.values.length, raw.length);
  assert.equal(result.values[0], 0);
  assert.equal(result.values[4], 1);
  assert.deepEqual(Array.from(raw), before);
  assert.equal(result.range.min, 0);
  assert.equal(result.range.max, 65535);
});

test('constant intensity maps to neutral grey', () => {
  const result = normalizeIntensityForDisplay(new Uint16Array([42, 42, 42]));
  assert.deepEqual(Array.from(result.values), [0.5, 0.5, 0.5]);
});

test('percentile range clips outliers for display only', () => {
  const raw = new Uint16Array([0, 10, 20, 30, 40, 65535]);
  const result = normalizeIntensityForDisplay(raw, { lowerPercentile: 0.2, upperPercentile: 0.8 });
  assert.equal(result.values[0], 0);
  assert.equal(result.values[5], 1);
  assert.equal(result.method, 'percentile-display-only');
});

test('invalid samples map safely and empty input is reported', () => {
  const result = normalizeIntensityForDisplay([NaN, 10, Infinity], { lowerPercentile: 0, upperPercentile: 1 });
  assert.deepEqual(Array.from(result.values), [0, 0.5, 0]);
  assert.equal(result.validCount, 1);
  assert.equal(normalizeIntensityForDisplay([]).range, null);
});

test('rejects invalid percentile configuration', () => {
  assert.throws(() => normalizeIntensityForDisplay([1, 2], { lowerPercentile: 1, upperPercentile: 0 }), RangeError);
});
