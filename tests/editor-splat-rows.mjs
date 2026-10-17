import assert from 'node:assert/strict';
import { encodeEditorSplatRows } from '../js/modules/editor-splat-rows.js';

const state = {
  alive: new Uint8Array([1, 0, 1]),
  positions: new Float32Array([1, 2, 3, 99, 99, 99, -4, 5, 6]),
  colors: new Float32Array([0.1, 0.2, 0.3, 0.9, 0.9, 0.9, 0.4, 0.5, 0.6]),
  paintColors: new Float32Array([-1, -1, -1, -1, -1, -1, 0.8, -1, 0.2]),
  opacity: new Float32Array([0.25, 1, 0.75]),
  scale: new Float32Array([0.05, 0.05, 0.05]),
  scaleXYZ: new Float32Array([0.1, 0.2, 0.3, 0.01, 0.01, 0.01, 0.4, 0.5, 0.6]),
  rotation: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0]),
};
const rows = encodeEditorSplatRows(state, [2, 0]);
assert.equal(rows.byteLength, 64, 'two retained points must produce two 32-byte rows');
const view = new DataView(rows.buffer);
assert.deepEqual([view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)], [-4, 5, 6]);
for (const [offset, expected] of [[12, 0.4], [16, 0.5], [20, 0.6]]) {
  assert.ok(Math.abs(view.getFloat32(offset, true) - expected) < 1e-6, `axis scale at ${offset} survives float32 encoding`);
}
assert.deepEqual(Array.from(rows.slice(24, 28)), [204, 128, 51, 191], 'per-channel paint, unpainted color and opacity survive');
assert.deepEqual(Array.from(rows.slice(28, 32)), [128, 255, 128, 128], 'non-unit quaternion is normalized before encoding');
assert.deepEqual([view.getFloat32(32, true), view.getFloat32(36, true), view.getFloat32(40, true)], [1, 2, 3]);
for (const [offset, expected] of [[44, 0.1], [48, 0.2], [52, 0.3]]) {
  assert.ok(Math.abs(view.getFloat32(offset, true) - expected) < 1e-6, `axis scale at ${offset} survives float32 encoding`);
}
assert.deepEqual(Array.from(rows.slice(56, 60)), [26, 51, 77, 64]);
assert.deepEqual(Array.from(rows.slice(60, 64)), [255, 128, 128, 128], 'identity quaternion is encoded in SPLAT convention');
assert.throws(() => encodeEditorSplatRows(state, [1]), /invalid or dead source index/);
assert.throws(() => encodeEditorSplatRows({ ...state, positions: new Float32Array([NaN, 0, 0, 0, 0, 0, 0, 0, 0]) }, [0]), /non-finite position/);
assert.throws(() => encodeEditorSplatRows({ ...state, scaleXYZ: new Float32Array([0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]) }, [0]), /invalid scale/);
assert.throws(() => encodeEditorSplatRows({ ...state, rotation: new Float32Array(12) }, [0]), /invalid rotation/);
assert.throws(() => encodeEditorSplatRows(state, []), /no live points/);

console.log('Studio-to-NIF row encoder preserves live geometry, anisotropic scale, colour, opacity and rotation.');
