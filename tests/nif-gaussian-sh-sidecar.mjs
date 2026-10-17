import assert from 'node:assert/strict';
import { encodeNif, decodeNif } from '../js/modules/nif-format.js';

const rows = new Uint8Array(32);
const view = new DataView(rows.buffer);
view.setFloat32(0, 1, true);
view.setFloat32(4, 2, true);
view.setFloat32(8, 3, true);
view.setFloat32(12, 0.1, true);
view.setFloat32(16, 0.1, true);
view.setFloat32(20, 0.1, true);
rows[24] = 200; rows[25] = 120; rows[26] = 40; rows[27] = 230;
rows[28] = 255; rows[29] = 128; rows[30] = 128; rows[31] = 128;
const aliveIndices = new Uint32Array([0]);
const values = new Float32Array(Array.from({ length: 12 }, (_, i) => (i + 1) / 100));
const properties = ['f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: 9 }, (_, i) => `f_rest_${i}`)];
const buffer = encodeNif({
  sourceBuffer: rows,
  aliveIndices,
  gaussianSH: { degree: 1, pointCount: 1, coefficientCount: 12, values },
  meta: { source_format: 'gaussian_ply', gaussian_sh: { degree: 1, properties, coefficient_count: 12 } },
});
const decoded = await decodeNif(buffer);
assert.equal(decoded.gaussianSH.degree, 1);
assert.equal(decoded.gaussianSH.pointCount, 1);
assert.equal(decoded.gaussianSH.coefficientCount, 12);
assert.equal(decoded.gaussianSH.values.length, 12);
for (let i = 0; i < values.length; i++) assert.equal(decoded.gaussianSH.values[i], values[i]);
assert.deepEqual(decoded.meta.gaussian_sh.properties, properties);

assert.throws(
  () => encodeNif({
    sourceBuffer: rows, aliveIndices,
    gaussianSH: { degree: 1, pointCount: 1, coefficientCount: 11, values: new Float32Array(11) },
  }),
  /invalid degree, point count, coefficient count or value array/,
  'sidecar coefficient count must match its SH degree',
);
assert.throws(
  () => encodeNif({
    sourceBuffer: rows, aliveIndices,
    gaussianSH: { degree: 0, pointCount: 1, coefficientCount: 3, values: new Float32Array([0, Number.NaN, 0]) },
  }),
  /not finite/,
  'sidecar coefficients must be finite',
);
assert.throws(
  () => encodeNif({
    sourceBuffer: rows, aliveIndices,
    gaussianSH: { degree: 0, pointCount: 2, coefficientCount: 3, values: new Float32Array(6) },
  }),
  /point count must match geometry/,
  'NIF geometry and SH sidecar point counts must agree before encoding',
);
console.log('Gaussian PLY SH sidecar round-trip and validation passed.');
