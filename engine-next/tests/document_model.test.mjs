import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateGaussianIds, createDocumentModel, validateDocumentModel,
  DocumentHistory, createComponentChildren, cloneDocumentModel,
} from '../../js/modules/document-model.js';

const ids = (() => { let n = 0; return () => `test-id-${++n}`; })();

function fixture() {
  const allocated = allocateGaussianIds(3);
  return createDocumentModel({
    idFactory: ids,
    documentId: 'doc-test',
    gaussianIds: allocated.ids,
    nextGaussianId: allocated.nextId,
    components: [{
      id: 'cap',
      gaussianIds: new Uint32Array([1, 2]),
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      triangles: new Uint32Array([0, 1, 2]),
      visible: true,
    }],
  });
}

test('Gaussian identities are monotonic, nonzero and independent of array order', () => {
  const a = allocateGaussianIds(3);
  const b = allocateGaussianIds(2, a.nextId);
  assert.deepEqual([...a.ids], [1, 2, 3]);
  assert.deepEqual([...b.ids], [4, 5]);
  assert.equal(a.nextId, 4);
  assert.throws(() => allocateGaussianIds(2, 0xffffffff), /exhausted/);\n  assert.throws(() => createDocumentModel({ documentId: 'bad', gaussianIds: [-1] }), /invalid uint32 identity/);
});

test('document model validates unique component IDs and Gaussian membership', () => {
  const model = fixture();
  assert.deepEqual(validateDocumentModel(model), { valid: true, gaussianCount: 3, componentCount: 1 });
  const bad = cloneDocumentModel(model);
  bad.components[0].gaussianIds = new Uint32Array([99]);
  assert.throws(() => validateDocumentModel(bad), /unknown Gaussian ID/);\n  const duplicate = cloneDocumentModel(model);\n  duplicate.components[0].gaussianIds = new Uint32Array([1, 1]);\n  assert.throws(() => validateDocumentModel(duplicate), /duplicate ID/);
});

test('split children preserve parent lineage and source membership', () => {
  const parent = fixture().components[0];
  const children = createComponentChildren(parent, [
    { gaussianIds: new Uint32Array([1]), vertices: new Float32Array([0, 0, 0]) },
    { gaussianIds: new Uint32Array([2]), vertices: new Float32Array([1, 0, 0]) },
  ], { idFactory: ids });
  assert.equal(children.length, 2);
  assert.ok(children.every(child => child.parentIds.includes('cap')));
  assert.deepEqual([...children[0].gaussianIds], [1]);
  assert.notEqual(children[0].id, children[1].id);
});

test('transaction rollback, undo and redo restore exact typed-array state', () => {
  const history = new DocumentHistory(fixture());
  history.transact('move cap', model => { model.components[0].vertices[0] = 5; });
  assert.equal(history.current.components[0].vertices[0], 5);
  assert.equal(history.undo(), true);
  assert.equal(history.current.components[0].vertices[0], 0);
  assert.equal(history.redo(), true);
  assert.equal(history.current.components[0].vertices[0], 5);
  assert.throws(() => history.transact('invalid membership', model => {
    model.components[0].gaussianIds = new Uint32Array([999]);
  }), /unknown Gaussian ID/);
  assert.equal(history.current.components[0].vertices[0], 5);
  assert.equal(history.current.components[0].gaussianIds[0], 1);
});

test('mesh-authored components may exist without Gaussian membership', () => {
  const model = createDocumentModel({
    documentId: 'mesh-only-doc',
    components: [{ id: 'platform', gaussianIds: [], geometrySource: 'mesh-authored' }],
  });
  assert.equal(model.components[0].geometrySource, 'mesh-authored');
  assert.equal(validateDocumentModel(model).componentCount, 1);
});
