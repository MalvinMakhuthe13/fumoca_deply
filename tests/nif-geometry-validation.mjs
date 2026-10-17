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

console.log('NIF geometry validation passed: empty, malformed and non-finite scenes are rejected.');
