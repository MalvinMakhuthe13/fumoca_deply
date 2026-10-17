import assert from 'node:assert/strict';
import { encodeNif, decodeNif } from '../js/modules/nif-format.js';

// Tiny valid 32-byte-row .splat fixture: two Gaussians, no GPU/runtime services.
const source = new Uint8Array(64);
const view = new DataView(source.buffer);
for (let i = 0; i < 2; i++) {
  const o = i * 32;
  view.setFloat32(o, i * 0.25, true);
  view.setFloat32(o + 4, 1 + i, true);
  view.setFloat32(o + 8, -0.5, true);
  view.setFloat32(o + 12, 0.1, true);
  view.setFloat32(o + 16, 0.1, true);
  view.setFloat32(o + 20, 0.1, true);
  source[o + 24] = 220;
  source[o + 25] = 120;
  source[o + 26] = 40;
  source[o + 27] = 230;
  source[o + 28] = 255; // approximately identity quaternion (wxyz)
  source[o + 29] = 128;
  source[o + 30] = 128;
  source[o + 31] = 128;
}
const indices = new Uint32Array([0, 1]);
const nif = encodeNif({
  sourceBuffer: source,
  aliveIndices: indices,
  rowSize: 32,
  vertical: 'generic',
  meta: { title: 'conversion fixture', source_format: 'splat' },
});
assert.ok(nif instanceof ArrayBuffer);
assert.ok(nif.byteLength > 0);
const decoded = await decodeNif(nif);
assert.equal(decoded.gaussians.count, 2);
assert.equal(decoded.gaussians.data.length, 28);
assert.equal(decoded.meta.title, 'conversion fixture');
assert.equal(decoded.meta.source_format, 'splat');

// Check actual decoded attributes, not only that the container opens.
// Position quantization should remain below 1e-4 scene units for this fixture.
const closeTo = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
};
const sigmoid = x => 1 / (1 + Math.exp(-x));
for (let i = 0; i < 2; i++) {
  const o = i * 14;
  closeTo(decoded.gaussians.data[o], i * 0.25, 0.0001, `point ${i} x`);
  closeTo(decoded.gaussians.data[o + 1], 1 + i, 0.0001, `point ${i} y`);
  closeTo(decoded.gaussians.data[o + 2], -0.5, 0.0001, `point ${i} z`);
  closeTo(decoded.gaussians.data[o + 3], Math.log(0.1), 0.025, `point ${i} log-scale-x`);
  closeTo(sigmoid(decoded.gaussians.data[o + 10]), 230 / 255, 0.003, `point ${i} opacity`);
  closeTo(sigmoid(decoded.gaussians.data[o + 11]), 220 / 255, 0.003, `point ${i} red`);
  closeTo(sigmoid(decoded.gaussians.data[o + 12]), 120 / 255, 0.003, `point ${i} green`);
  closeTo(sigmoid(decoded.gaussians.data[o + 13]), 40 / 255, 0.003, `point ${i} blue`);
}
console.log('SPLAT → NIF round-trip passed: 2 Gaussians, metadata preserved, no GPU required.');
