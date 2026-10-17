import assert from 'node:assert/strict';
import { encodeNif, geometryToSplatRows } from '../js/modules/nif-format.js';

const rejects = (fn, pattern) => assert.throws(fn, pattern);

rejects(
  () => encodeNif({ geometry: new Float32Array(0) }),
  /at least one point/,
  'empty geometry must be rejected before bounds are calculated',
);
rejects(
  () => encodeNif({ geometry: new Float32Array(15) }),
  /length must equal point count/,
  'geometry lengths not divisible by 14 must be rejected',
);
const nanGeometry = new Float32Array(14);
nanGeometry[0] = Number.NaN;
rejects(
  () => encodeNif({ geometry: nanGeometry }),
  /non-finite value/,
  'NaN positions must not be serialized',
);
const infinityGeometry = new Float32Array(14);
infinityGeometry[4] = Number.POSITIVE_INFINITY;
rejects(
  () => encodeNif({ geometry: infinityGeometry }),
  /non-finite value/,
  'infinite scales must not be serialized',
);
rejects(
  () => encodeNif({ sourceBuffer: new Uint8Array(0), aliveIndices: [] }),
  /at least one point/,
  'a fully erased scene must fail clearly instead of creating an invalid NIF',
);

rejects(
  () => encodeNif({ geometry: new Float32Array(0), compressed: false }),
  /at least one point/,
  'raw NIF encoding must reject empty geometry too',
);
rejects(
  () => encodeNif({ geometry: new Float32Array(15), compressed: false }),
  /length must equal point count/,
  'raw NIF encoding must reject malformed geometry records',
);
const rawNan = new Float32Array(14);
rawNan[2] = Number.NaN;
rejects(
  () => encodeNif({ geometry: rawNan, compressed: false }),
  /non-finite value/,
  'raw NIF encoding must reject non-finite positions',
);
const rawValid = new Float32Array(14);
rawValid[0] = 1; rawValid[1] = 2; rawValid[2] = 3;
rawValid[3] = rawValid[4] = rawValid[5] = Math.log(0.01);
rawValid[6] = 1; rawValid[10] = 0; rawValid[11] = rawValid[12] = rawValid[13] = 0;
const rawNif = encodeNif({ geometry: rawValid, compressed: false });
const rawDecoded = await decodeNif(rawNif);
assert.equal(rawDecoded.gaussians.count, 1, 'raw NIF must round-trip one valid point');
assert.equal(rawDecoded.gaussians.data[0], 1, 'raw NIF position must survive round-trip');

rejects(
  () => encodeNif({ geometry: new Float32Array(0), compressed: false }),
  /at least one point/,
  'uncompressed encoding must reject empty scenes too',
);
rejects(
  () => encodeNif({ geometry: new Float32Array(15), compressed: false }),
  /length must equal point count/,
  'uncompressed encoding must reject malformed geometry lengths',
);
const rawNanGeometry = new Float32Array(14);
rawNanGeometry[2] = Number.NaN;
rejects(
  () => encodeNif({ geometry: rawNanGeometry, compressed: false }),
  /non-finite value/,
  'uncompressed encoding must reject NaN geometry too',
);

rejects(
  () => encodeNif({ positions: new Float32Array([0, 1]), colors01: new Float32Array([1, 0, 0]), opacities01: new Float32Array([1]) }),
  /exactly 3 values per point/,
  'PLY positions must match the point count exactly',
);
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1, 2]), colors01: new Float32Array([1, 0, 0, 0]), opacities01: new Float32Array([1]) }),
  /exactly 3 values per point/,
  'PLY colors must match the point count exactly',
);
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1, 2]), colors01: new Float32Array([1.1, 0, 0]), opacities01: new Float32Array([1]) }),
  /normalized to \[0,1\]/,
  'PLY colors outside the normalized range must be rejected instead of silently clipped',
);
rejects(
  () => encodeNif({ positions: new Float32Array([0, 1, 2]), colors01: new Float32Array([1, 0, 0]), opacities01: new Float32Array([Number.NaN]) }),
  /opacity must be finite/,
  'non-finite PLY opacity must be rejected',
);

const zeroQuaternion = new Float32Array(14);
rejects(
  () => encodeNif({ geometry: zeroQuaternion }),
  /zero-length quaternion/,
  'compressed NIF must reject a degenerate quaternion',
);
rejects(
  () => encodeNif({ geometry: zeroQuaternion, compressed: false }),
  /zero-length quaternion/,
  'uncompressed NIF must reject a degenerate quaternion',
);

rejects(
  () => geometryToSplatRows({ count: 1, data: zeroQuaternion }),
  /zero-length quaternion/,
  'NIF-to-SPLAT conversion must reject degenerate rotations',
);
rejects(
  () => geometryToSplatRows({ count: 0, data: new Float32Array(0) }),
  /invalid point count or data length/,
  'NIF-to-SPLAT conversion must reject empty scenes',
);

const validGeometry = new Float32Array(14);
validGeometry[3] = validGeometry[4] = validGeometry[5] = Math.log(0.01);
validGeometry[6] = 1;
rejects(
  () => encodeNif({
    geometry: validGeometry,
    mesh: { vertices: new Float32Array([0, 0, 0]), triangles: new Uint32Array([0, 0, 0]), colours: new Float32Array([0.5, 0.5, 0.5]) },
  }),
  /byte colors/,
  'mesh colors must be byte-valued RGB instead of silently truncating float colors',
);

const oneSplat = new Uint8Array(32);
rejects(
  () => encodeNif({ sourceBuffer: oneSplat, aliveIndices: [1] }),
  /out of bounds/,
  'SPLAT point indices must be validated before DataView reads',
);
rejects(
  () => encodeNif({ sourceBuffer: oneSplat, aliveIndices: [0], rowSize: 16 }),
  /at least 32 bytes/,
  'SPLAT row size must cover the canonical 32-byte layout',
);
rejects(
  () => encodeNif({ sourceBuffer: new Uint8Array(33), aliveIndices: [0] }),
  /divisible by row size/,
  'partial trailing SPLAT rows must be rejected',
);

console.log('NIF geometry and SPLAT input validation passed.');
