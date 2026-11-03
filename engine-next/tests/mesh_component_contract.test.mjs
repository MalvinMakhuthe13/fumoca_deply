import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeshComponent, normalizeMeshComponents } from '../../js/modules/mesh-component-contract.js';

const vertices = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
const faces = new Uint16Array([0,1,2]);

test('worker NIF and browser extractor aliases normalize to the same component shape', () => {
  const browser = normalizeMeshComponent({
    id: 'mesh-a', vertices, triangles: faces, colours: new Uint8Array(9).fill(128),
    visible: false, watertight: true, stats: { openEdges: 0 },
  });
  const worker = normalizeMeshComponent({
    id: 'mesh-a', positions: vertices, faces, colors: new Uint8Array(9).fill(128),
    visible: false, watertight: true, diagnostics: { openEdges: 0 },
  });
  assert.deepEqual(Array.from(browser.vertices), Array.from(worker.vertices));
  assert.deepEqual(Array.from(browser.triangles), Array.from(worker.triangles));
  assert.deepEqual(Array.from(browser.colours), Array.from(worker.colours));
  assert.equal(browser.visible, false);
  assert.equal(browser.watertight, true);
  assert.deepEqual(browser.diagnostics, { openEdges: 0 });
});

test('component arrays, indices, colors and Gaussian memberships are validated', () => {
  assert.throws(() => normalizeMeshComponent({ id: 'bad', vertices, triangles: [-1, 1, 2] }), /invalid uint32 index/);
  assert.throws(() => normalizeMeshComponent({ id: 'bad', vertices, triangles: [0, 1, 3] }), /outside its vertex array/);
  assert.throws(() => normalizeMeshComponent({ id: 'bad', vertices, triangles: [0, 1, 2], colours: [0, 0] }), /colour count/);
  assert.throws(() => normalizeMeshComponent({ id: 'bad', vertices, triangles: [0, 1, 2], gaussianIds: [-1] }), /invalid or duplicate identity/);
  assert.throws(() => normalizeMeshComponent({ id: 'bad', vertices, triangles: [0, 1, 2], gaussianIds: [1, 1] }), /invalid or duplicate identity/);
});

test('component collection rejects duplicate IDs and retains support flags', () => {
  const component = {
    id: 'support', vertices, triangles: faces,
    supportSurfaceCandidate: true, gaussianIds: new Uint32Array([5, 6]),
  };
  const normalized = normalizeMeshComponents([component]);
  assert.equal(normalized[0].supportSurfaceCandidate, true);
  assert.deepEqual(Array.from(normalized[0].gaussianIds), [5, 6]);
  assert.throws(() => normalizeMeshComponents([component, component]), /IDs must be unique/);
});
