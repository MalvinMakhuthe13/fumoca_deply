import assert from 'node:assert/strict';
import { encodeNif, decodeNif, geometryToSplatRows } from '../js/modules/nif-format.js';

const rejects = (fn, pattern, message) => assert.throws(fn, pattern, message);

// Geometry containers must reject empty, malformed and non-finite data.
rejects(() => encodeNif({ geometry: new Float32Array(0) }), /at least one point/, 'compressed NIF must reject empty geometry');
rejects(() => encodeNif({ geometry: new Float32Array(15) }), /length must equal point count/, 'compressed NIF must reject malformed geometry lengths');
const nanGeometry = new Float32Array(14);
nanGeometry[0] = Number.NaN;
rejects(() => encodeNif({ geometry: nanGeometry }), /non-finite value/, 'compressed NIF must reject NaN');
const infinityGeometry = new Float32Array(14);
infinityGeometry[4] = Number.POSITIVE_INFINITY;
rejects(() => encodeNif({ geometry: infinityGeometry }), /non-finite value/, 'compressed NIF must reject Infinity');
const zeroQuaternion = new Float32Array(14);
rejects(() => encodeNif({ geometry: zeroQuaternion }), /zero-length quaternion/, 'compressed NIF must reject degenerate rotations');

// Exercise the actual uncompressed branch too (the public option is compress).
rejects(() => encodeNif({ geometry: new Float32Array(0), compress: false }), /at least one point/, 'raw NIF must reject empty geometry');
rejects(() => encodeNif({ geometry: new Float32Array(15), compress: false }), /length must equal point count/, 'raw NIF must reject malformed geometry lengths');
const rawNan = new Float32Array(14);
rawNan[2] = Number.NaN;
rejects(() => encodeNif({ geometry: rawNan, compress: false }), /non-finite value/, 'raw NIF must reject NaN');
rejects(() => encodeNif({ geometry: zeroQuaternion, compress: false }), /zero-length quaternion/, 'raw NIF must reject degenerate rotations');

const rawValid = new Float32Array(14);
rawValid[0] = 1; rawValid[1] = 2; rawValid[2] = 3;
rawValid[3] = rawValid[4] = rawValid[5] = Math.log(0.01);
rawValid[6] = 1;
const rawNif = encodeNif({ geometry: rawValid, compress: false });
const rawDecoded = await decodeNif(rawNif);
assert.equal(rawDecoded.gaussians.count, 1, 'raw NIF must round-trip one valid point');
assert.equal(rawDecoded.gaussians.data[0], 1, 'raw NIF position X must survive round-trip');
assert.equal(rawDecoded.gaussians.data[1], 2, 'raw NIF position Y must survive round-trip');
assert.equal(rawDecoded.gaussians.data[2], 3, 'raw NIF position Z must survive round-trip');

// Empty source and malformed legacy SPLAT rows must fail before allocation/read.
rejects(() => encodeNif({ sourceBuffer: new Uint8Array(0), aliveIndices: [] }), /point count must be between 1/, 'fully erased scene must fail clearly');
const oneSplat = new Uint8Array(32);
rejects(() => encodeNif({ sourceBuffer: oneSplat, aliveIndices: [1] }), /out of bounds/, 'SPLAT indices must be bounds-checked');
rejects(() => encodeNif({ sourceBuffer: oneSplat, aliveIndices: [0], rowSize: 16 }), /at least 32 bytes/, 'SPLAT row size must cover the canonical layout');
rejects(() => encodeNif({ sourceBuffer: new Uint8Array(33), aliveIndices: [0] }), /divisible by row size/, 'partial SPLAT rows must be rejected');

// PLY point arrays must have exact dimensions and normalized finite attributes.
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1]), colors01: new Float32Array([1, 0, 0]), opacities01: new Float32Array([1]) }),
  /exactly 3 values per point/,
  'PLY positions must match the point count',
);
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1, 2]), colors01: new Float32Array([1, 0, 0, 0]), opacities01: new Float32Array([1]) }),
  /exactly 3 values per point/,
  'PLY colors must match the point count',
);
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1, 2]), colors01: new Float32Array([1.1, 0, 0]), opacities01: new Float32Array([1]) }),
  /normalized to \[0,1\]/,
  'PLY colors outside [0,1] must be rejected',
);
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1, 2]), colors01: new Float32Array([1, 0, 0]), opacities01: new Float32Array([Number.NaN]) }),
  /opacity must be finite/,
  'PLY opacity must be finite',
);

// NIF-to-SPLAT conversion must not allocate malformed records or serialize zero quaternions.
rejects(() => geometryToSplatRows({ count: 1, data: zeroQuaternion }), /zero-length quaternion/, 'NIF-to-SPLAT must reject degenerate rotations');
rejects(() => geometryToSplatRows({ count: 0, data: new Float32Array(0) }), /invalid point count or data length/, 'NIF-to-SPLAT must reject empty scenes');

// Mesh colors are bytes; Float32 RGB must not be silently truncated.
const validGeometry = new Float32Array(14);
validGeometry[3] = validGeometry[4] = validGeometry[5] = Math.log(0.01);
validGeometry[6] = 1;
rejects(
  () => encodeNif({
    geometry: validGeometry,
    mesh: { vertices: new Float32Array([0, 0, 0]), triangles: new Uint32Array([0, 0, 0]), colours: new Float32Array([0.5, 0.5, 0.5]) },
  }),
  /byte colors/,
  'mesh colors must be byte-valued RGB',
);

console.log('NIF geometry, SPLAT and PLY input validation passed.');
