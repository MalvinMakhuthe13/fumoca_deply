import test from 'node:test';
import assert from 'node:assert/strict';
import { findGaussianRowsBelowSupportPlane } from '../../js/modules/support-plane-trim.js';

test('trim planner finds only live members below a tilted support plane', () => {
  const result = findGaussianRowsBelowSupportPlane({
    positions: new Float32Array([
      0, 0, 0,       // on plane
      -0.2, 0, 0,    // below tilted plane
      0.2, 0, 0,     // above tilted plane
      -0.8, 0, 0,    // belongs to another component
      -0.1, 0, 0,    // already deleted
    ]),
    gaussianIds: new Uint32Array([1,2,3,4,5]),
    componentGaussianIds: new Uint32Array([1,2,3,5]),
    alive: new Uint8Array([1,1,1,1,0]),
    normal: [1, 1, 0],
    offset: 0,
    tolerance: 0.05,
  });
  assert.deepEqual([...result.rows], [1]);
  assert.equal(result.considered, 3);
  assert.equal(result.alreadyDead, 1);
  assert.equal(result.retained, 2);
  assert.ok(result.signedDistances[0] < -0.05);
});

test('trim planner normalizes plane scale and offset consistently', () => {
  const result = findGaussianRowsBelowSupportPlane({
    positions: new Float32Array([0,1,0, 0,3,0]),
    gaussianIds: new Uint32Array([10,11]),
    componentGaussianIds: new Uint32Array([10,11]),
    normal: [0,2,0],
    offset: 4,
  });
  assert.deepEqual([...result.rows], [0]);
  assert.deepEqual(result.normal, [0,1,0]);
  assert.equal(result.offset, 2);
});

test('trim planner refuses missing membership, invalid masks and malformed planes', () => {
  const base = {
    positions: new Float32Array([0,0,0]),
    gaussianIds: new Uint32Array([1]),
    componentGaussianIds: new Uint32Array([1]),
    normal: [0,1,0], offset: 0,
  };
  assert.throws(() => findGaussianRowsBelowSupportPlane({ ...base, componentGaussianIds: [] }), /no Gaussian membership/);
  assert.throws(() => findGaussianRowsBelowSupportPlane({ ...base, alive: new Uint8Array(2) }), /alive mask/);
  assert.throws(() => findGaussianRowsBelowSupportPlane({ ...base, normal: [0,0,0] }), /degenerate/);
  assert.throws(() => findGaussianRowsBelowSupportPlane({ ...base, tolerance: -1 }), /finite/);
});


test('anisotropic Gaussian extent is measured along the rotated plane normal', () => {
  const base = {
    positions: new Float32Array([0, 0.5, 0]),
    gaussianIds: new Uint32Array([21]),
    componentGaussianIds: new Uint32Array([21]),
    scalesXYZ: new Float32Array([2, 0.1, 0.1]),
    sigmaMultiplier: 1,
    normal: [0, 1, 0],
    offset: 0,
  };
  const unrotated = findGaussianRowsBelowSupportPlane(base);
  assert.equal(unrotated.rows.length, 0);
  const half = Math.SQRT1_2;
  const rotated = findGaussianRowsBelowSupportPlane({
    ...base,
    rotationsWXYZ: new Float32Array([half, 0, 0, half]),
  });
  assert.deepEqual([...rotated.rows], [0]);
  assert.ok(rotated.projectedRadii[0] > 1.99);
});

test('zero sigma trims by Gaussian centre only and input arrays remain unchanged', () => {
  const positions = new Float32Array([0, -0.1, 0, 0, 0.1, 0]);
  const originalPositions = positions.slice();
  const scalesXYZ = new Float32Array([10, 10, 10, 10, 10, 10]);
  const result = findGaussianRowsBelowSupportPlane({
    positions,
    gaussianIds: new Uint32Array([31, 32]),
    componentGaussianIds: new Uint32Array([31, 32]),
    scalesXYZ,
    sigmaMultiplier: 0,
    normal: [0, 1, 0],
    offset: 0,
  });
  assert.deepEqual([...result.rows], [0]);
  assert.deepEqual([...positions], [...originalPositions]);
  assert.deepEqual([...scalesXYZ], [10, 10, 10, 10, 10, 10]);
});
