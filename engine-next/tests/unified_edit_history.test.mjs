import test from 'node:test';
import assert from 'node:assert/strict';
import { UnifiedEditHistory } from '../../js/modules/document-model.js';

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
  const history = makeHistory(state);

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
  assert.throws(() => history.transact('async mistake', async () => {
    state.gaussian[0] = 9;
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
