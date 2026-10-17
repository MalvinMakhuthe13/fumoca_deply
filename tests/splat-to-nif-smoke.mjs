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
console.log('SPLAT → NIF round-trip passed: 2 Gaussians, metadata preserved, no GPU required.');
