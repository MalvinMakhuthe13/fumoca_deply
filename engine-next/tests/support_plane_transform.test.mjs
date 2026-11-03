import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportPlaneTransform } from '../../js/modules/support-plane-transform.js';

test('tilted support plane is rotated to y=0 and its object side points +Y', () => {
  const normal = [-0.4472135955, 0.894427191, 0];
  const transform = buildSupportPlaneTransform(normal, 0.25);
  const planePoint = normal.map(value => value * 0.25);
  const leveledOrigin = transform.transformPoint(planePoint);
  const objectPoint = normal.map((value, index) => value * 0.25 + value * 0.4);
  const leveledObject = transform.transformPoint(objectPoint);
  assert.ok(Math.hypot(...leveledOrigin) < 1e-6);
  assert.ok(Math.abs(leveledObject[0]) < 1e-6);
  assert.ok(Math.abs(leveledObject[1] - 0.4) < 1e-6);
  assert.ok(Math.abs(leveledObject[2]) < 1e-6);
  assert.ok(Math.abs(transform.normal[1] - 0.894427191) < 1e-6);
});

test('plane normalization scales its offset and handles a downward normal', () => {
  const transform = buildSupportPlaneTransform([0, -2, 0], -4);
  assert.deepEqual(transform.normal, [-0, 1, -0]);
  assert.equal(transform.offset, 2);
  assert.deepEqual(transform.transformPoint([0, 2, 0]), [0, 0, 0]);
});

test('Gaussian positions and wxyz rotations are transformed together', () => {
  const transform = buildSupportPlaneTransform([-0.4472135955, 0.894427191, 0], 0);
  const positions = transform.transformPositionArray(new Float32Array([0, 0, 0, -0.4472136, 0.8944272, 0]));
  assert.ok(Math.abs(positions[0]) < 1e-6);
  assert.ok(Math.abs(positions[1]) < 1e-6);
  assert.ok(Math.abs(positions[3]) < 1e-6);
  assert.ok(Math.abs(positions[4] - 1) < 1e-6);
  const rotations = transform.transformGaussianRotationsWxyz(new Float32Array([1, 0, 0, 0]));
  assert.ok(Math.abs(Math.hypot(...rotations) - 1) < 1e-6);
  const transformedNormal = transform.transformPoint([-0.4472135955, 0.894427191, 0]);
  assert.ok(Math.abs(transformedNormal[1] - 1) < 1e-6);
});

test('invalid support planes and malformed arrays are rejected', () => {
  assert.throws(() => buildSupportPlaneTransform([0, 0, 0], 0), /degenerate/);
  assert.throws(() => buildSupportPlaneTransform([0, NaN, 1], 0), /finite/);
  const transform = buildSupportPlaneTransform([0, 1, 0], 0);
  assert.throws(() => transform.transformPositionArray(new Float32Array([0, 1])), /divisible by three/);
  assert.throws(() => transform.transformGaussianRotationsWxyz(new Float32Array([1, 0, 0])), /divisible by four/);
});
