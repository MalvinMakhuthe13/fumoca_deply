import assert from 'node:assert/strict';
import { encodeNif } from '../js/modules/nif-format.js';

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
