import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentModel } from '../../js/modules/document-model.js';
import { encodeDocumentModelChunk, decodeDocumentModelChunk } from '../../js/modules/document-model-nif.js';

function fixture() {
  return createDocumentModel({
    documentId: 'persistent-doc',
    revision: 7,
    nextGaussianId: 5,
    gaussianIds: new Uint32Array([1, 2, 4]),
    source: { geometrySignature: 'geo-abc', appearanceSignature: 'app-def' },
    reconstruction: { method: 'oriented-surfel-tsdf', version: 2 },
    lineage: [{ operation: 'split', parentId: 'whole', childIds: ['cap-a', 'cap-b'] }],
    components: [
      { id: 'cap-a', parentIds: ['whole'], gaussianIds: new Uint32Array([1, 2]), visible: true, selected: true, geometrySource: 'gaussian-derived', vertices: new Float32Array([0, 0, 0]) },
      { id: 'cap-b', parentIds: ['whole'], gaussianIds: new Uint32Array([4]), visible: false, geometrySource: 'gaussian-derived' },
      { id: 'platform', gaussianIds: [], geometrySource: 'mesh-authored' },
    ],
  });
}

test('document model binary chunk round-trips IDs, membership, visibility and lineage', () => {
  const original = fixture();
  const encoded = encodeDocumentModelChunk(original);
  const decoded = decodeDocumentModelChunk(encoded);
  assert.ok(decoded);
  assert.equal(decoded.documentId, original.documentId);
  assert.equal(decoded.revision, 7);
  assert.equal(decoded.nextGaussianId, 5);
  assert.deepEqual([...decoded.gaussianIds], [1, 2, 4]);
  assert.deepEqual([...decoded.components[0].gaussianIds], [1, 2]);
  assert.deepEqual([...decoded.components[1].gaussianIds], [4]);
  assert.equal(decoded.components[1].visible, false);
  assert.equal(decoded.components[2].geometrySource, 'mesh-authored');
  assert.deepEqual(decoded.lineage, original.lineage);
  assert.deepEqual(decoded.source, original.source);
  assert.equal('vertices' in decoded.components[0], false);
});

test('document model binary decoder rejects malformed chunks without throwing to caller', () => {
  assert.equal(decodeDocumentModelChunk(new Uint8Array([1, 0, 0])), null);
  const encoded = encodeDocumentModelChunk(fixture());
  const malformed = encoded.slice(0, encoded.length - 1);
  assert.equal(decodeDocumentModelChunk(malformed), null);
});

test('document model binary encoding rejects duplicate Gaussian identities', () => {
  const model = fixture();
  model.gaussianIds = new Uint32Array([1, 1]);
  assert.throws(() => encodeDocumentModelChunk(model), /duplicate ID/);
});
