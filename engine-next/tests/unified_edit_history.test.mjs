import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedEditHistory, createDocumentModel, syncDocumentComponentsFromMesh, validateDocumentModel } from '../../js/modules/document-model.js';

function fixture() {
  return {
    gaussian: new Float32Array([0, 1, 2]),
    alive: new Uint8Array([1, 1, 1]),
    selected: new Uint8Array([0, 0, 0]),
    document: {
      documentId: 'history-doc',
      activeComponentId: 'object',
      components: [
        { id: 'object', visible: true, gaussianIds: new Uint32Array([1, 2]), vertices: new Float32Array([0, 1, 2]) },
        { id: 'platform', visible: true, gaussianIds: new Uint32Array(), vertices: new Float32Array([10, 11, 12]) },
      ],
      lineage: [],
      metadata: { revision: 1 },
    },
  };
}
function clone(value) {
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}
function makeHistory(state, restoreHook = null) {
  return new UnifiedEditHistory({
    limit: 5,
    maxBytes: 8 * 1024 * 1024,
    capture: () => clone(state),
    restore: (snapshot, context) => {
      if (restoreHook) restoreHook(snapshot, context);
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, clone(snapshot));
    },
  });
}
const equal = (a, b) => assert.deepEqual(a, b);

test('one journal orders Gaussian edits, component transforms, visibility, trim, split, cap and deletion', () => {
  const state = fixture();
  const history = new UnifiedEditHistory({
    capture: () => clone(state),
    restore: (snapshot) => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, clone(snapshot));
    },
    limit: 10,
  });

  state.gaussian[0] = 99;
  history.commit('Gaussian brush edit');
  state.document.components[0].vertices[0] = 42;
  history.commit('Component transform');
  state.document.components[1].visible = false;
  history.commit('Platform visibility');
  state.alive[1] = 0;
  state.document.components[0].gaussianIds = new Uint32Array([1]);
  history.commit('Trim object splats');
  state.document.components.push({ id: 'object-split-b', visible: true, gaussianIds: new Uint32Array([2]), vertices: new Float32Array([3, 4, 5]) });
  state.document.components[0].vertices = new Float32Array([0, 1, 2, 3]);
  state.document.components[0].lineage = ['object'];
  history.commit('Split component');
  state.document.components[0].vertices = new Float32Array([0, 1, 2, 3, 4]);
  history.commit('Cap support boundary');
  state.document.components = state.document.components.filter(item => item.id !== 'object-split-b');
  history.commit('Delete component');

  const labels = [];
  while (history.canUndo()) {
    labels.push(history.state().undoLabel);
    assert.equal(history.undo(), true);
  }
  assert.deepEqual(labels, [
    'Delete component',
    'Cap support boundary',
    'Split component',
    'Trim object splats',
    'Platform visibility',
    'Component transform',
    'Gaussian brush edit',
  ]);
  equal(state, fixture());

  let redos = 0;
  while (history.canRedo()) { history.redo(); redos++; }
  assert.equal(redos, 7);
  assert.equal(history.state().undoLabel, 'Delete component');
  assert.equal(state.document.components.some(item => item.id === 'object-split-b'), false);
  assert.equal(state.document.components.find(item => item.id === 'platform').visible, false);
});

test('snapshots are detached and undo restores typed-array bytes, selection and lineage', () => {
  const state = fixture();
  const history = makeHistory(state);
  state.gaussian[1] = 88;
  state.selected[2] = 1;
  state.document.lineage.push({ operation: 'trim', parentId: 'object' });
  history.commit('Atomic scene edit');

  state.gaussian[1] = 1234;
  state.document.components[0].vertices[0] = -500;
  history.undo();
  assert.deepEqual([...state.gaussian], [0, 1, 2]);
  assert.deepEqual([...state.selected], [0, 0, 0]);
  assert.deepEqual(state.document.lineage, []);
  history.redo();
  assert.deepEqual([...state.gaussian], [0, 88, 2]);
  assert.deepEqual(state.document.lineage, [{ operation: 'trim', parentId: 'object' }]);
});

test('a failed transaction restores every affected domain and records no history entry', () => {
  const state = fixture();
  const history = makeHistory(state);
  const original = clone(state);
  assert.throws(() => history.transact('bad cross-domain operation', () => {
    state.gaussian[0] = 500;
    state.alive[2] = 0;
    state.document.components[0].vertices[0] = 90;
    state.document.components[1].visible = false;
    throw new Error('validation rejected operation');
  }), /validation rejected/);
  equal(state, original);
  assert.equal(history.canUndo(), false);
  assert.equal(history.state().count, 0);
});

test('async mutations are rejected and rolled back instead of producing partial snapshots', () => {
  const state = fixture();
  const history = makeHistory(state);
  assert.throws(() => history.transact('async mistake', () => {
    state.gaussian[0] = 9;
    return Promise.resolve('late completion');
  }), /must be synchronous/);
  assert.deepEqual([...state.gaussian], [0, 1, 2]);
  assert.equal(history.canUndo(), false);
});

test('a new edit after undo discards the redo branch', () => {
  const state = fixture();
  const history = makeHistory(state);
  state.gaussian[0] = 5;
  history.commit('First');
  state.gaussian[0] = 6;
  history.commit('Second');
  history.undo();
  assert.equal(history.canRedo(), true);
  state.gaussian[0] = 7;
  history.commit('Replacement');
  assert.equal(history.canRedo(), false);
  assert.equal(history.state().undoLabel, 'Replacement');
});

test('coalescing merges consecutive gestures with the same key but preserves the earliest before-state', () => {
  const state = fixture();
  const history = makeHistory(state);
  state.document.components[0].vertices[0] = 1;
  history.commit('Move component', { coalesceKey: 'component:object:move' });
  state.document.components[0].vertices[0] = 2;
  history.commit('Move component', { coalesceKey: 'component:object:move' });
  assert.equal(history.state().count, 1);
  history.undo();
  assert.equal(state.document.components[0].vertices[0], 0);
  history.redo();
  assert.equal(state.document.components[0].vertices[0], 2);
});

test('bounded history evicts oldest transactions without breaking cursor or redo', () => {
  const state = fixture();
  const history = makeHistory(state);
  for (let i = 1; i <= 7; i++) {
    state.gaussian[0] = i;
    history.commit('Edit ' + i);
  }
  assert.equal(history.state().count, 5);
  for (let i = 0; i < 5; i++) history.undo();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
  assert.equal(state.gaussian[0], 2);
});

test('restore failures do not advance undo/redo cursor', () => {
  const state = fixture();
  let fail = false;
  const history = makeHistory(state, () => { if (fail) throw new Error('renderer refused snapshot'); });
  state.gaussian[0] = 8;
  history.commit('Edit');
  fail = true;
  assert.throws(() => history.undo(), /renderer refused snapshot/);
  assert.equal(history.state().cursor, 1);
  assert.equal(history.canUndo(), true);
  assert.equal(history.state().error, 'renderer refused snapshot');
});

test('partially failed undo and redo restores are rolled back before cursor movement', () => {
  const state = fixture();
  let failUndoOnce = true;
  let failRedoOnce = true;
  const history = new UnifiedEditHistory({
    capture: () => clone(state),
    restore: (snapshot, context) => {
      if (context.direction === 'undo' && failUndoOnce) {
        failUndoOnce = false;
        state.gaussian[0] = -101; // simulate a renderer/model adapter failing mid-restore
        throw new Error('undo restore failed halfway');
      }
      if (context.direction === 'redo' && failRedoOnce) {
        failRedoOnce = false;
        state.gaussian[0] = -202;
        throw new Error('redo restore failed halfway');
      }
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, clone(snapshot));
    },
  });

  state.gaussian[0] = 10;
  history.commit('Move and clean');
  assert.throws(() => history.undo(), /undo restore failed halfway/);
  assert.equal(state.gaussian[0], 10);
  assert.equal(history.state().cursor, 1);
  assert.equal(history.canUndo(), true);

  assert.equal(history.undo(), true);
  assert.equal(state.gaussian[0], 0);
  assert.equal(history.state().cursor, 0);

  assert.throws(() => history.redo(), /redo restore failed halfway/);
  assert.equal(state.gaussian[0], 0);
  assert.equal(history.state().cursor, 0);
  assert.equal(history.canRedo(), true);

  assert.equal(history.redo(), true);
  assert.equal(state.gaussian[0], 10);
  assert.equal(history.state().cursor, 1);
});

test('uncommitted gesture does not create extra history entries', () => {
  const state = fixture();
  const history = makeHistory(state);
  state.gaussian[0] = 1;
  state.gaussian[0] = 2;
  state.gaussian[0] = 3;
  history.commit('Single pointer gesture');
  assert.equal(history.state().count, 1);
  history.undo();
  assert.equal(state.gaussian[0], 0);
});

test('a single oversized snapshot is never retained beyond the configured byte budget', () => {
  const state = { positions: new Float32Array(140_000) };
  const history = new UnifiedEditHistory({
    maxBytes: 1024 * 1024,
    capture: () => ({ positions: new Float32Array(state.positions) }),
    restore: (snapshot) => { state.positions.set(snapshot.positions); },
  });

  state.positions[0] = 17;
  assert.equal(history.commit('Large scan-wide edit'), false);
  assert.equal(history.state().count, 0);
  assert.equal(history.state().bytes, 0);
  assert.equal(history.canUndo(), false);
  assert.match(history.state().error, /exceeds the 1048576-byte history budget/);

  // The oversized edit is now the baseline; later small edits remain undoable.
  state.positions = new Float32Array([1, 2, 3]);
  history.clear();
  state.positions[0] = 9;
  assert.equal(history.commit('Small follow-up'), true);
  assert.equal(history.canUndo(), true);
  history.undo();
  assert.deepEqual([...state.positions], [1, 2, 3]);
});


test('identical before and after snapshots are not recorded', () => {
  const state = { positions: new Float32Array([1, 2, 3]), visible: true };
  const history = new UnifiedEditHistory({
    capture: () => ({ positions: state.positions, visible: state.visible }),
    restore: snapshot => {
      state.positions = snapshot.positions;
      state.visible = snapshot.visible;
    },
  });

  assert.equal(history.commit('No-op gesture'), false);
  assert.equal(history.state().count, 0);
  assert.equal(history.state().bytes, 0);

  state.positions[1] = 7;
  assert.equal(history.commit('Actual edit'), true);
  assert.equal(history.state().count, 1);
  assert.equal(history.canUndo(), true);
});


test('cancelPending restores the pre-mutation baseline without adding history', () => {
  const state = { positions: new Float32Array([1, 2, 3]), visible: true };
  const history = new UnifiedEditHistory({
    capture: () => ({ positions: state.positions, visible: state.visible }),
    restore: snapshot => {
      state.positions = snapshot.positions;
      state.visible = snapshot.visible;
    },
  });

  state.positions[0] = 99;
  state.visible = false;
  assert.equal(history.cancelPending(), true);
  assert.deepEqual([...state.positions], [1, 2, 3]);
  assert.equal(state.visible, true);
  assert.equal(history.state().count, 0);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});

test('cancelPending rolls back to the mutated state if baseline restoration fails', () => {
  const state = { value: 1, failNext: false };
  const history = new UnifiedEditHistory({
    capture: () => ({ value: state.value }),
    restore: snapshot => {
      if (state.failNext) {
        state.failNext = false;
        throw new Error('restore failed');
      }
      state.value = snapshot.value;
    },
  });

  state.value = 2;
  state.failNext = true;
  assert.throws(() => history.cancelPending(), /restore failed/);
  assert.equal(state.value, 2);
  assert.match(history.state().error, /restore failed/);
});


test('coalesced edits cannot exceed the configured history byte budget', () => {
  const state = { positions: new Float32Array(220_000) };
  const history = new UnifiedEditHistory({
    maxBytes: 1024 * 1024,
    capture: () => ({ positions: new Float32Array(state.positions) }),
    restore: snapshot => { state.positions = new Float32Array(snapshot.positions); },
  });

  // Each individual before/after pair fits. Merging must retain the earliest
  // before-state, making the combined pair exceed the budget.
  state.positions = new Float32Array(20_000);
  assert.equal(history.commit('Component drag', { coalesceKey: 'component:car:transform' }), true);
  assert.equal(history.state().count, 1);
  assert.ok(history.state().bytes <= 1024 * 1024);

  state.positions = new Float32Array(220_000);
  assert.equal(history.commit('Component drag', { coalesceKey: 'component:car:transform' }), false);
  assert.equal(history.state().count, 0);
  assert.equal(history.state().bytes, 0);
  assert.equal(history.canUndo(), false);
  assert.match(history.state().error, /coalesced snapshot exceeds the 1048576-byte history budget/);
});


test('live mesh reconciliation keeps link and unlink membership canonical through undo and redo', () => {
  const state = {
    documentModel: createDocumentModel({
      documentId: 'mesh-sync-doc',
      gaussianIds: new Uint32Array([1, 2, 3]),
      nextGaussianId: 4,
      activeComponentId: 'object',
      components: [
        { id: 'object', gaussianIds: new Uint32Array([1]), visible: true },
        { id: 'platform', gaussianIds: new Uint32Array([2, 3]), visible: true, supportSurfaceCandidate: true },
      ],
    }),
    nifMeshComponents: [
      { id: 'object', gaussianIds: new Uint32Array([1, 2]), visible: true },
      { id: 'platform', gaussianIds: new Uint32Array([3]), visible: true, supportSurfaceCandidate: true },
    ],
    activeMeshComponentId: 'object',
  };
  const history = new UnifiedEditHistory({
    capture: () => clone(state),
    restore: snapshot => Object.assign(state, clone(snapshot)),
  });

  state.documentModel = syncDocumentComponentsFromMesh(
    state.documentModel, state.nifMeshComponents, state.activeMeshComponentId
  );
  history.commit('Link selected splats');
  validateDocumentModel(state.documentModel);
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'object').gaussianIds], [1, 2]);
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'platform').gaussianIds], [3]);

  state.nifMeshComponents[0].gaussianIds = new Uint32Array([1]);
  state.nifMeshComponents[1].gaussianIds = new Uint32Array([2, 3]);
  state.documentModel = syncDocumentComponentsFromMesh(
    state.documentModel, state.nifMeshComponents, state.activeMeshComponentId
  );
  history.commit('Unlink selected splats');
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'object').gaussianIds], [1]);

  history.undo();
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'object').gaussianIds], [1, 2]);
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'platform').gaussianIds], [3]);
  history.redo();
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'object').gaussianIds], [1]);
  assert.deepEqual([...state.documentModel.components.find(c => c.id === 'platform').gaussianIds], [2, 3]);
  validateDocumentModel(state.documentModel);
});

test('live mesh reconciliation preserves deleted ancestors and inserts split children with exclusive lineage', () => {
  const model = createDocumentModel({
    documentId: 'split-sync-doc',
    gaussianIds: new Uint32Array([1, 2, 3, 4]),
    nextGaussianId: 5,
    activeComponentId: 'parent',
    components: [
      { id: 'parent', gaussianIds: new Uint32Array([1, 2, 3, 4]), visible: true },
    ],
  });
  const synced = syncDocumentComponentsFromMesh(model, [
    { id: 'child-a', parentIds: ['parent'], gaussianIds: new Uint32Array([1, 2]), visible: true,
      provenance: { operation: 'plane-split', sourceComponentId: 'parent' } },
    { id: 'child-b', parentIds: ['parent'], gaussianIds: new Uint32Array([3, 4]), visible: true,
      provenance: { operation: 'plane-split', sourceComponentId: 'parent' } },
  ], 'child-a');

  validateDocumentModel(synced);
  assert.equal(synced.components.length, 3);
  const parent = synced.components.find(c => c.id === 'parent');
  assert.equal(parent.deleted, true);
  assert.deepEqual([...parent.gaussianIds], [1, 2, 3, 4]);
  assert.deepEqual(synced.components.find(c => c.id === 'child-a').parentIds, ['parent']);
  assert.deepEqual(synced.components.find(c => c.id === 'child-b').parentIds, ['parent']);
  assert.equal(synced.activeComponentId, 'child-a');
});

test('live mesh reconciliation rejects duplicate Gaussian ownership without mutating the source model', () => {
  const model = createDocumentModel({
    documentId: 'duplicate-sync-doc',
    gaussianIds: new Uint32Array([1, 2]),
    nextGaussianId: 3,
    components: [{ id: 'object', gaussianIds: new Uint32Array([1]) }],
  });
  assert.throws(() => syncDocumentComponentsFromMesh(model, [
    { id: 'object', gaussianIds: new Uint32Array([1, 2]) },
    { id: 'platform', gaussianIds: new Uint32Array([2]) },
  ], 'object'), /owned by both/);
  assert.deepEqual([...model.components[0].gaussianIds], [1]);
  assert.equal(model.components.length, 1);
});


test('history byte budget includes plain arrays, strings and component metadata', () => {
  const state = {
    metadata: {
      componentName: 'vehicle-body',
      provenance: { operation: 'support-plane-trim', sourceComponentId: 'vehicle-root' },
      gaussianIds: Array.from({ length: 90_000 }, (_, index) => index + 1),
    },
  };
  const history = new UnifiedEditHistory({
    maxBytes: 1024 * 1024,
    capture: () => ({ metadata: state.metadata }),
    restore: snapshot => { state.metadata = snapshot.metadata; },
  });

  state.metadata = {
    componentName: 'vehicle-body-edited',
    provenance: { operation: 'support-plane-trim', sourceComponentId: 'vehicle-root' },
    gaussianIds: Array.from({ length: 90_000 }, (_, index) => index + 2),
  };
  assert.equal(history.commit('Update component metadata'), false);
  assert.equal(history.state().bytes, 0);
  assert.match(history.state().error, /exceeds the 1048576-byte history budget/);
});


test('history snapshots clone and compare DataView bytes exactly', () => {
  const sourceBuffer = new Uint8Array([90, 1, 2, 3, 91]).buffer;
  const state = { view: new DataView(sourceBuffer, 1, 3) };
  const history = new UnifiedEditHistory({
    capture: () => ({ view: state.view }),
    restore: snapshot => { state.view = snapshot.view; },
  });

  state.view.setUint8(1, 77);
  assert.equal(history.commit('Edit DataView'), true);
  history.undo();
  assert.deepEqual(
    [...new Uint8Array(state.view.buffer, state.view.byteOffset, state.view.byteLength)],
    [1, 2, 3],
  );
  history.redo();
  assert.deepEqual(
    [...new Uint8Array(state.view.buffer, state.view.byteOffset, state.view.byteLength)],
    [1, 77, 3],
  );
});

test('history snapshots reject renderer-class instances instead of flattening prototypes', () => {
  class RendererHandle { constructor() { this.id = 'renderer-object'; } }
  const history = new UnifiedEditHistory({
    capture: () => ({ renderer: new RendererHandle() }),
    restore: () => {},
  });
  assert.throws(() => history.commit('Unsafe renderer snapshot'), /history snapshots must contain plain data/);
});
