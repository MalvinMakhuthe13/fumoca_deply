import test from 'node:test';
import assert from 'node:assert/strict';
import { assignGaussianMemberships } from '../../js/modules/gaussian-component-membership.js';

function component(id, minX, maxX) {
  return {
    id,
    vertices: new Float32Array([
      minX,0,0, maxX,0,0, minX,1,0,
      maxX,1,0,
    ]),
    triangles: new Uint32Array([0,1,2, 1,3,2]),
    colours: null,
    gaussianIds: new Uint32Array(),
    diagnostics: {},
  };
}

test('Gaussian IDs are assigned to clearly separated component bounds', () => {
  const components = [component('left', 0, 1), component('right', 10, 11)];
  const positions = new Float32Array([0.2,0.2,0, 0.8,0.7,0, 10.2,0.2,0, 10.8,0.7,0, 30,0,0]);
  const ids = new Uint32Array([11,12,21,22,31]);
  const result = assignGaussianMemberships(components, {
    positions, gaussianIds: ids, alive: new Uint8Array([1,1,1,1,1]), margin: 0.1,
  });
  assert.equal(result.assignedCount, 4);
  assert.equal(result.unassignedCount, 1);
  assert.deepEqual([...result.components[0].gaussianIds], [11,12]);
  assert.deepEqual([...result.components[1].gaussianIds], [21,22]);
  assert.equal(result.components[0].diagnostics.gaussian_membership_method, 'conservative-unambiguous-aabb');
});

test('overlapping component bounds are left ambiguous instead of guessing ownership', () => {
  const components = [component('a', 0, 2), component('b', 1, 3)];
  const result = assignGaussianMemberships(components, {
    positions: new Float32Array([1.5,0.2,0]),
    gaussianIds: new Uint32Array([7]),
    margin: 0.2,
  });
  assert.equal(result.assignedCount, 0);
  assert.equal(result.ambiguousCount, 1);
  assert.equal(result.components[0].gaussianIds.length, 0);
  assert.equal(result.components[1].gaussianIds.length, 0);
});

test('membership respects alive and selected-only masks and preserves existing assignments', () => {
  const components = [component('one', 0, 2)];
  const result = assignGaussianMemberships(components, {
    positions: new Float32Array([0.2,0.2,0, 0.8,0.2,0, 1.2,0.2,0]),
    gaussianIds: new Uint32Array([1,2,3]),
    alive: new Uint8Array([1,1,0]),
    selected: new Uint8Array([0,1,1]),
    selectedOnly: true,
    margin: 0.1,
  });
  assert.deepEqual([...result.components[0].gaussianIds], [2]);
  const preserved = assignGaussianMemberships([{
    ...components[0], gaussianIds: new Uint32Array([1]),
  }], {
    positions: new Float32Array([0.2,0.2,0]),
    gaussianIds: new Uint32Array([1]),
  });
  assert.equal(preserved.preserved, true);
  assert.deepEqual([...preserved.components[0].gaussianIds], [1]);
});

test('partially persisted memberships are retained while only missing components are filled', () => {
  const components = [
    { ...component('known', 0, 1), gaussianIds: new Uint32Array([99]) },
    component('missing', 10, 11),
  ];
  const result = assignGaussianMemberships(components, {
    positions: new Float32Array([0.2,0.2,0, 10.2,0.2,0]),
    gaussianIds: new Uint32Array([1,2]),
    margin: 0.1,
  });
  assert.deepEqual([...result.components[0].gaussianIds], [99]);
  assert.deepEqual([...result.components[1].gaussianIds], [2]);
});

test('identity and position array lengths must agree', () => {
  assert.throws(() => assignGaussianMemberships([component('one',0,1)], {
    positions: new Float32Array([0,0,0]), gaussianIds: new Uint32Array([1,2]),
  }), /identity count must match/);
});


test('membership rejects duplicate ownership and identities outside the source document', () => {
  const left = { ...component('left', 0, 1), gaussianIds: new Uint32Array([1]) };
  const right = { ...component('right', 10, 11), gaussianIds: new Uint32Array([1]) };
  const args = { positions: new Float32Array([0.2,0.2,0]), gaussianIds: new Uint32Array([1]) };
  assert.throws(() => assignGaussianMemberships([left, right], args), /assigned to multiple mesh components/);
  assert.throws(() => assignGaussianMemberships([
    { ...component('stale', 0, 1), gaussianIds: new Uint32Array([99]) },
  ], args), /invalid, duplicate or unknown Gaussian identity/);
});

test('mesh-authored support platforms are never auto-assigned Gaussian ownership', () => {
  const platform = {
    ...component('platform', 0, 2),
    geometrySource: 'mesh-authored',
    supportSurfaceCandidate: true,
  };
  const result = assignGaussianMemberships([platform], {
    positions: new Float32Array([0.2,0.2,0, 1.2,0.2,0]),
    gaussianIds: new Uint32Array([1,2]),
  });
  assert.equal(result.assignedCount, 0);
  assert.equal(result.unassignedCount, 2);
  assert.deepEqual([...result.components[0].gaussianIds], []);
});

test('empty component list reports all eligible live splats as unassigned', () => {
  const result = assignGaussianMemberships([], {
    positions: new Float32Array([0,0,0, 1,1,1, 2,2,2]),
    gaussianIds: new Uint32Array([1,2,3]),
    alive: new Uint8Array([1,0,1]),
  });
  assert.equal(result.assignedCount, 0);
  assert.equal(result.unassignedCount, 2);
  assert.equal(result.preserved, true);
});
