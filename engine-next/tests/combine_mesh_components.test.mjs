import test from 'node:test';
import assert from 'node:assert/strict';
import { combineMeshComponents } from '../../js/modules/mesh-component-contract.js';

const tri = (id, x, visible = true, colours = null) => ({
  id, visible,
  vertices: new Float32Array([x,0,0, x+1,0,0, x,1,0]),
  triangles: new Uint32Array([0,1,2]),
  colours,
});

test('combines disconnected components with correctly offset indices and colours', () => {
  const mesh = combineMeshComponents([
    tri('a', 0, true, new Uint8Array([255,0,0, 255,0,0, 255,0,0])),
    tri('b', 3, true, null),
  ]);
  assert.equal(mesh.componentCount, 2);
  assert.equal(mesh.vertices.length, 18);
  assert.deepEqual([...mesh.triangles], [0,1,2, 3,4,5]);
  assert.deepEqual([...mesh.colours.slice(0,9)], [255,0,0,255,0,0,255,0,0]);
  assert.deepEqual([...mesh.colours.slice(9)], new Array(9).fill(200));
});

test('visible-only export omits hidden components without changing source records', () => {
  const hidden = tri('hidden', 10, false);
  const visible = tri('visible', 0, true);
  const mesh = combineMeshComponents([hidden, visible], { visibleOnly: true });
  assert.deepEqual(mesh.componentIds, ['visible']);
  assert.equal(mesh.vertices.length, 9);
  assert.equal(mesh.triangles.length, 3);
  assert.equal(hidden.visible, false);
  assert.equal(hidden.vertices[0], 10);
});

test('an empty component collection returns valid empty typed arrays', () => {
  const mesh = combineMeshComponents([]);
  assert.equal(mesh.vertices.length, 0);
  assert.equal(mesh.triangles.length, 0);
  assert.equal(mesh.colours, null);
});
