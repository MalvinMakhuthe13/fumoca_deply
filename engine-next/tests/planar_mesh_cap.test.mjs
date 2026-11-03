import test from 'node:test';
import assert from 'node:assert/strict';
import { capPlanarBoundaryLoops } from '../../js/modules/planar-mesh-cap.js';

function openPrism(points) {
  const vertices = [];
  for (const [x, z] of points) vertices.push(x, 0, z);
  for (const [x, z] of points) vertices.push(x, 1, z);
  const triangles = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    triangles.push(i, j, count + j, i, count + j, count + i);
  }
  return { vertices: new Float32Array(vertices), triangles: new Uint32Array(triangles) };
}

function boundaryEdgeCount(mesh) {
  const edges = new Map(), faces = mesh.triangles;
  for (let i = 0; i < faces.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = faces[i + j], b = faces[i + (j + 1) % 3];
      const key = a < b ? a + ':' + b : b + ':' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  return [...edges.values()].filter(count => count === 1).length;
}

test('caps a planar convex support base and faces outward below the object', () => {
  const mesh = openPrism([[0,0], [2,0], [2,2], [0,2]]);
  const result = capPlanarBoundaryLoops(mesh, { normal: [0,1,0], offset: 0 });
  assert.equal(result.cappedLoops, 1);
  assert.equal(result.cappedTriangles, 2);
  assert.equal(boundaryEdgeCount(result.mesh), 4); // only the uncapped top remains open
  for (let i = mesh.triangles.length; i < result.mesh.triangles.length; i += 3) {
    const ids = result.mesh.triangles.slice(i, i + 3);
    const a = ids[0] * 3, b = ids[1] * 3, c = ids[2] * 3;
    const ab = [result.mesh.vertices[b] - result.mesh.vertices[a], result.mesh.vertices[b+1] - result.mesh.vertices[a+1], result.mesh.vertices[b+2] - result.mesh.vertices[a+2]];
    const ac = [result.mesh.vertices[c] - result.mesh.vertices[a], result.mesh.vertices[c+1] - result.mesh.vertices[a+1], result.mesh.vertices[c+2] - result.mesh.vertices[a+2]];
    const normalY = ab[2] * ac[0] - ab[0] * ac[2];
    assert.ok(normalY < 0);
  }
});

test('ear-clips a concave support base without filling outside its outline', () => {
  const mesh = openPrism([[0,0], [2,0], [2,1], [1,1], [1,2], [0,2]]);
  const result = capPlanarBoundaryLoops(mesh, { normal: [0,1,0], offset: 0 });
  assert.equal(result.cappedLoops, 1);
  assert.equal(result.cappedTriangles, 4);
  assert.equal(boundaryEdgeCount(result.mesh), 6);
});

test('accepted near-planar base vertices are snapped onto the exact support plane', () => {
  const mesh = openPrism([[0,0], [2,0], [2,2], [0,2]]);
  mesh.vertices[3 * 3 + 1] = 0.0005;
  const result = capPlanarBoundaryLoops(mesh, { normal: [0,1,0], offset: 0, tolerance: 0.001 });
  assert.equal(result.cappedLoops, 1);
  for (let vertex = 0; vertex < 4; vertex++) {
    assert.ok(Math.abs(result.mesh.vertices[vertex * 3 + 1]) < 1e-8);
  }
  assert.equal(mesh.vertices[3 * 3 + 1], 0.0005); // source geometry remains untouched
});

test('refuses to cap non-planar loops and leaves the original mesh untouched', () => {
  const mesh = openPrism([[0,0], [2,0], [2,2], [0,2]]);
  mesh.vertices[3 * 3 + 1] = 0.02;
  const result = capPlanarBoundaryLoops(mesh, { normal: [0,1,0], offset: 0, tolerance: 0.001 });
  assert.equal(result.unchanged, true);
  assert.equal(result.cappedLoops, 0);
  assert.equal(result.skippedNonPlanar, 1);
  assert.equal(result.mesh, mesh);
});

test('rejects invalid indices and degenerate planes', () => {
  const mesh = openPrism([[0,0], [1,0], [1,1]]);
  assert.throws(() => capPlanarBoundaryLoops(mesh, { normal: [0,0,0], offset: 0 }), /degenerate/);
  assert.throws(() => capPlanarBoundaryLoops({
    vertices: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
    triangles: new Uint32Array([0,1,3]),
  }, { normal: [0,1,0], offset: 0 }), /outside its vertex array/);
});
