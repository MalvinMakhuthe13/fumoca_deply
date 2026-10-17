import assert from 'node:assert/strict';
import { encodeNif, decodeNif, decodeLayers } from '../js/modules/nif-format.js';
import { compactNifLayers } from '../js/modules/nif-layer-geo.js';
import { CHUNK } from '../engine-next/format/NIFSpec.js';

const rows = new Uint8Array(3 * 32);
const view = new DataView(rows.buffer);
for (let i = 0; i < 3; i++) {
  const o = i * 32;
  view.setFloat32(o, i + 10, true);
  view.setFloat32(o + 4, i + 20, true);
  view.setFloat32(o + 8, i + 30, true);
  view.setFloat32(o + 12, 0.1, true);
  view.setFloat32(o + 16, 0.2, true);
  view.setFloat32(o + 20, 0.3, true);
  rows[o + 24] = 220; rows[o + 25] = 120; rows[o + 26] = 40; rows[o + 27] = 230;
  rows[o + 28] = 255; rows[o + 29] = 128; rows[o + 30] = 128; rows[o + 31] = 128;
}
const original = encodeNif({
  sourceBuffer: rows, aliveIndices: [0, 1, 2], rowSize: 32,
  layers: [
    { label: 'door_é', depthMin: -1, depthMax: 2, indices: [2, 0] },
    { label: 'wheel', depthMin: 0, depthMax: 3, indices: [1] },
  ],
});
const decoded = await decodeNif(original);
const layers = await decodeLayers(decoded.reader);
assert.equal(layers.length, 2);
assert.equal(layers[0].label, 'door_é');
assert.deepEqual(Array.from(layers[0].indices), [2, 0]);
assert.equal(layers[0].depthMin, -1);
assert.equal(layers[0].depthMax, 2);
assert.equal(layers[0].data[0], decoded.gaussians.data[2 * 14]);
assert.equal(layers[0].data[14], decoded.gaussians.data[0]);
assert.deepEqual(Array.from(layers[1].indices), [1]);

const compacted = compactNifLayers(layers, [2, 0], 3);
assert.equal(compacted.droppedUnindexed, 0);
assert.equal(compacted.layers.length, 1, 'layer with no remaining points should be removed');
assert.equal(compacted.layers[0].label, 'door_é');
assert.deepEqual(compacted.layers[0].indices, [0, 1]);

const compactRows = new Uint8Array(2 * 32);
compactRows.set(rows.subarray(2 * 32, 3 * 32), 0);
compactRows.set(rows.subarray(0, 32), 32);
const compactNif = encodeNif({
  sourceBuffer: compactRows, aliveIndices: [0, 1], rowSize: 32,
  layers: compacted.layers,
});
const compactDecoded = await decodeNif(compactNif);
const compactLayers = await decodeLayers(compactDecoded.reader);
assert.equal(compactLayers.length, 1);
assert.deepEqual(Array.from(compactLayers[0].indices), [0, 1]);

const originalLayerChunk = decoded.reader.chunks.filter(chunk => chunk.type === CHUNK.LAYER_GEO);
assert.equal(originalLayerChunk.length, 1);
const noDuplicate = encodeNif({
  sourceBuffer: rows, aliveIndices: [0, 1, 2], rowSize: 32,
  layers: [{ label: 'door_é', indices: [2, 0] }],
  passthroughChunks: originalLayerChunk,
});
const noDuplicateDecoded = await decodeNif(noDuplicate);
assert.equal(noDuplicateDecoded.reader.chunks.filter(chunk => chunk.type === CHUNK.LAYER_GEO).length, 1,
  'rebuilt LAYER_GEO must replace rather than duplicate the passthrough chunk');
const intentionallyDropped = encodeNif({
  sourceBuffer: rows, aliveIndices: [0, 1, 2], rowSize: 32,
  layers: [],
  passthroughChunks: originalLayerChunk,
});
const droppedDecoded = await decodeNif(intentionallyDropped);
assert.equal(droppedDecoded.reader.chunks.filter(chunk => chunk.type === CHUNK.LAYER_GEO).length, 0,
  'an explicit empty layer list must not reattach stale point-indexed layer data');
assert.equal(compactLayers[0].data[0], compactDecoded.gaussians.data[0]);
assert.equal(compactLayers[0].data[14], compactDecoded.gaussians.data[14]);

const legacy = compactNifLayers([{ label: 'legacy_no_indices', indices: null }], [0], 1);
assert.equal(legacy.layers.length, 0);
assert.equal(legacy.droppedUnindexed, 1);
assert.throws(() => compactNifLayers([{ label: 'bad', indices: [3] }], [0], 1), /invalid source index/);
assert.throws(() => encodeNif({
  sourceBuffer: rows, aliveIndices: [0, 1, 2], rowSize: 32,
  layers: [{ label: 'bad', indices: [3] }],
}), /out-of-range point index/);
assert.throws(() => encodeNif({
  sourceBuffer: rows, aliveIndices: [0, 1, 2], rowSize: 32,
  layers: [{ label: 'bad', indices: [1, 1] }],
}), /duplicate point indices/);

console.log('NIF LAYER_GEO encoding, decode, alive-index compaction and validation passed.');
