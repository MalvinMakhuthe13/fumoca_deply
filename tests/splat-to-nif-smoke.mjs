import assert from 'node:assert/strict';
import { encodeNif, decodeNif, geometryToSplatRows } from '../js/modules/nif-format.js';

// Tiny valid 32-byte-row .splat fixture: two Gaussians, no GPU/runtime services.
const source = new Uint8Array(64);
const view = new DataView(source.buffer);
for (let i = 0; i < 2; i++) {
  const o = i * 32;
  view.setFloat32(o, i * 0.25, true);
  view.setFloat32(o + 4, 1 + i, true);
  view.setFloat32(o + 8, -0.5, true);
  view.setFloat32(o + 12, 0.1, true);
  view.setFloat32(o + 16, 0.2, true);
  view.setFloat32(o + 20, 0.3, true);
  source[o + 24] = 220;
  source[o + 25] = 120;
  source[o + 26] = 40;
  source[o + 27] = 230;
  // Non-identity quaternion on point 0 exercises orientation preservation.
  const q = i === 0 ? [235, 148, 118, 136] : [255, 128, 128, 128];
  source[o + 28] = q[0];
  source[o + 29] = q[1];
  source[o + 30] = q[2];
  source[o + 31] = q[3];
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
  closeTo(decoded.gaussians.data[o + 4], Math.log(0.2), 0.025, `point ${i} log-scale-y`);
  closeTo(decoded.gaussians.data[o + 5], Math.log(0.3), 0.025, `point ${i} log-scale-z`);
  const qBytes = i === 0 ? [235, 148, 118, 136] : [255, 128, 128, 128];
  const qRaw = qBytes.map(value => (value - 128) / 128);
  const qLength = Math.hypot(...qRaw) || 1;
  for (let q = 0; q < 4; q++) closeTo(decoded.gaussians.data[o + 6 + q], qRaw[q] / qLength, 0.01, `point ${i} quaternion ${q}`);
  closeTo(sigmoid(decoded.gaussians.data[o + 10]), 230 / 255, 0.003, `point ${i} opacity`);
  closeTo(sigmoid(decoded.gaussians.data[o + 11]), 220 / 255, 0.003, `point ${i} red`);
  closeTo(sigmoid(decoded.gaussians.data[o + 12]), 120 / 255, 0.003, `point ${i} green`);
  closeTo(sigmoid(decoded.gaussians.data[o + 13]), 40 / 255, 0.003, `point ${i} blue`);
}
// A NIF opened in the app must also be convertible back to the legacy
// 32-byte renderer input in memory, without a GPU or another reconstruction.
const legacyRows = geometryToSplatRows(decoded.gaussians);
assert.equal(legacyRows.byteLength, 2 * 32);
const legacyView = new DataView(legacyRows.buffer);
closeTo(legacyView.getFloat32(0, true), 0, 0.0001, 'legacy row 0 x');
closeTo(legacyView.getFloat32(4, true), 1, 0.0001, 'legacy row 0 y');
closeTo(legacyView.getFloat32(8, true), -0.5, 0.0001, 'legacy row 0 z');
assert.ok(legacyRows[24] >= 219 && legacyRows[24] <= 221, 'red channel survives NIF → SPLAT');
assert.ok(legacyRows[27] >= 229 && legacyRows[27] <= 231, 'opacity survives NIF → SPLAT');
for (let q = 0; q < 4; q++) assert.ok(Math.abs(legacyRows[28 + q] - Math.round(decoded.gaussians.data[6 + q] * 128 + 128)) <= 1, `normalized quaternion byte ${q} survives NIF → SPLAT`);

// Plain PLY point clouds have a distinct CPU-only route: encode positions,
// RGB and opacity as isotropic points, and do not claim Gaussian source fidelity.
const plyNif = encodeNif({
  positions: new Float32Array([2, 3, 4, -1, 0.5, 8]),
  colors01: new Float32Array([1, 0.25, 0, 0.1, 0.5, 0.9]),
  opacities01: new Float32Array([1, 0.6]),
  meta: { title: 'point cloud fixture', source_format: 'ply' },
});
const plyDecoded = await decodeNif(plyNif);
assert.equal(plyDecoded.gaussians.count, 2);
assert.equal(plyDecoded.meta.source_format, 'ply');
closeTo(plyDecoded.gaussians.data[0], 2, 0.0001, 'PLY point 0 x');
closeTo(plyDecoded.gaussians.data[1], 3, 0.0001, 'PLY point 0 y');
closeTo(sigmoid(plyDecoded.gaussians.data[10]), 1, 0.003, 'PLY point 0 opacity');
closeTo(sigmoid(plyDecoded.gaussians.data[11]), 1, 0.003, 'PLY point 0 red');
closeTo(sigmoid(plyDecoded.gaussians.data[12]), 0.25, 0.003, 'PLY point 0 green');
closeTo(sigmoid(plyDecoded.gaussians.data[13]), 0, 0.003, 'PLY point 0 blue');
closeTo(plyDecoded.gaussians.data[2], 4, 0.0001, 'PLY point 0 z');
for (let axis = 3; axis < 6; axis++) closeTo(plyDecoded.gaussians.data[axis], Math.log(0.01), 0.025, `PLY point 0 isotropic log-scale ${axis}`);
closeTo(plyDecoded.gaussians.data[6], 1, 0.0001, 'PLY identity quaternion w');
closeTo(plyDecoded.gaussians.data[7], 0, 0.0001, 'PLY identity quaternion x');
closeTo(plyDecoded.gaussians.data[8], 0, 0.0001, 'PLY identity quaternion y');
closeTo(plyDecoded.gaussians.data[9], 0, 0.0001, 'PLY identity quaternion z');
closeTo(plyDecoded.gaussians.data[14], -1, 0.0001, 'PLY point 1 x');
closeTo(plyDecoded.gaussians.data[15], 0.5, 0.0001, 'PLY point 1 y');
closeTo(plyDecoded.gaussians.data[16], 8, 0.0001, 'PLY point 1 z');
closeTo(sigmoid(plyDecoded.gaussians.data[24]), 0.6, 0.003, 'PLY point 1 opacity');
closeTo(sigmoid(plyDecoded.gaussians.data[25]), 0.1, 0.003, 'PLY point 1 red');
closeTo(sigmoid(plyDecoded.gaussians.data[26]), 0.5, 0.003, 'PLY point 1 green');
closeTo(sigmoid(plyDecoded.gaussians.data[27]), 0.9, 0.003, 'PLY point 1 blue');

console.log('SPLAT ↔ NIF and PLY → NIF CPU conversion round-trips passed.');
