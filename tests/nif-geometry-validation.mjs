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

console.log('NIF geometry validation passed: compressed and uncompressed invalid scenes are rejected.');
