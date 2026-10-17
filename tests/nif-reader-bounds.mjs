import assert from 'node:assert/strict';
import { NIFReader, CHUNK, CODEC } from '../engine-next/format/NIFSpec.js';
import { encodeGeometryOnly } from '../js/modules/nif-format.js';

function readerFor(bytes) {
  const reader = Object.create(NIFReader.prototype);
  reader.getChunk = type => type === CHUNK.KEYFRAME_GEO
    ? { type, codec: CODEC.RAW, data: bytes }
    : null;
  return reader;
}
function header(flag, count, size) {
  const bytes = new Uint8Array(size);
  bytes[0] = flag;
  new DataView(bytes.buffer).setUint32(1, count, false);
  return bytes;
}

await assert.rejects(
  () => readerFor(header(1, 0xffffffff, 5)).getGeometry(),
  /point count .*supported range/,
  'a tiny file must not trigger a huge Float32Array allocation',
);
await assert.rejects(
  () => readerFor(header(0, 1, 5)).getGeometry(),
  /Raw geometry payload is truncated/,
  'raw geometry count must fit the available payload',
);
await assert.rejects(
  () => readerFor(header(1, 1, 29)).getGeometry(),
  /Quantised geometry payload is truncated/,
  'quantized point bytes must fit the available payload',
);

const nonFiniteRaw = header(0, 1, 61);
new DataView(nonFiniteRaw.buffer).setFloat32(5, Number.NaN, true);
await assert.rejects(
  () => readerFor(nonFiniteRaw).getGeometry(),
  /non-finite value/,
  'raw NIF geometry must reject NaN values',
);

const invertedBounds = header(1, 1, 46);
const boundsView = new DataView(invertedBounds.buffer);
boundsView.setFloat32(5, 1, false);
boundsView.setFloat32(9, 0, false);
boundsView.setFloat32(13, 0, false);
boundsView.setFloat32(17, 0, false);
boundsView.setFloat32(21, 1, false);
boundsView.setFloat32(25, 1, false);
await assert.rejects(
  () => readerFor(invertedBounds).getGeometry(),
  /invalid or inverted bounds/,
  'quantized geometry must reject inverted bounding boxes',
);

const valid = encodeGeometryOnly({
  positions: new Float32Array([1, 2, 3]),
  colors01: new Float32Array([0.2, 0.4, 0.6]),
  opacities01: new Float32Array([0.8]),
});
const decoded = await readerFor(new Uint8Array(valid)).getGeometry();
assert.equal(decoded.count, 1);
assert.equal(decoded.data.length, 14);
assert.ok(Math.abs(decoded.data[0] - 1) < 0.0001);
assert.ok(Math.abs(decoded.data[1] - 2) < 0.0001);
assert.ok(Math.abs(decoded.data[2] - 3) < 0.0001);
console.log('NIF reader rejects malformed geometry and decodes a valid quantized fixture.');
