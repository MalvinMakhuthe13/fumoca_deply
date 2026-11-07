import assert from 'node:assert/strict';
import { applyPosterLiveTransform, computePosterWorldTransform } from '../js/modules/poster-live-transform.js';

const base = {
  center: { x: 2, y: 3, z: 4 },
  cameraPosition: { x: 2, y: 3, z: 14 },
  cameraRight: { x: 1, y: 0, z: 0 },
  cameraUp: { x: 0, y: 1, z: 0 },
  fov: 90,
  aspect: 2,
};
const centered = computePosterWorldTransform({ ...base, object: { x: 0.5, y: 0.5, scale: 1, rotation: 0 } });
assert.deepEqual(centered.position, { x: 2, y: 3, z: 4 });
assert.equal(centered.scale, 1);
assert.equal(centered.rotation, 0);
const layered = computePosterWorldTransform({ ...base, object: { x: 0.5, y: 0.5, scale: 1, rotation: 0, z: 11 } });
assert.ok(layered.position.z > centered.position.z, 'Higher layer depth moves the subject toward the camera');
assert.ok(Math.abs(layered.position.z - 5) < 1e-9);

const moved = computePosterWorldTransform({ ...base, object: { x: 0.75, y: 0.25, scale: 1.5, rotation: 90 } });
assert.ok(Math.abs(moved.position.x - 12) < 1e-9);
assert.ok(Math.abs(moved.position.y - 8) < 1e-9);
assert.equal(moved.position.z, 4);
assert.equal(moved.scale, 1.5);
assert.ok(Math.abs(moved.rotation - (Math.PI / 2)) < 1e-9);

const disabled = computePosterWorldTransform({ ...base, enabled: false, object: { x: 1, y: 0, scale: 4, rotation: 180 } });
assert.deepEqual(disabled, { position: { x: 2, y: 3, z: 4 }, scale: 1, rotation: 0 });

const clamped = computePosterWorldTransform({ ...base, object: { x: 5, y: -1, scale: 99, rotation: 900 } });
assert.ok(clamped.position.x > 2);
assert.ok(clamped.position.y > 3);
assert.equal(clamped.scale, 4);
assert.equal(clamped.rotation, 2 * Math.PI);


let projectionUpdated = false;
class MockVector3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  applyQuaternion() { return this; }
  normalize() { return this; }
}
const mockGroup = {
  position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  scale: { setScalar(value) { this.value = value; } },
  quaternion: { setFromAxisAngle(axis, angle) { this.axis = axis; this.angle = angle; } },
};
const mockCamera = {
  position: { x: 2, y: 3, z: 14 },
  quaternion: {},
  fov: 90,
  aspect: 2,
  updateMatrixWorld() { projectionUpdated = true; },
};
const applied = applyPosterLiveTransform({
  THREE: { Vector3: MockVector3 },
  group: mockGroup,
  camera: mockCamera,
  center: base.center,
  composition: { object: { x: 0.75, y: 0.25, scale: 1.5, rotation: 90 } },
  enabled: true,
});
assert.equal(applied, true);
assert.equal(projectionUpdated, true);
assert.ok(Math.abs(mockGroup.position.x - 12) < 1e-9);
assert.ok(Math.abs(mockGroup.position.y - 8) < 1e-9);
assert.equal(mockGroup.scale.value, 1.5);
assert.ok(Math.abs(mockGroup.quaternion.angle - Math.PI / 2) < 1e-9);
assert.equal(applyPosterLiveTransform({}), false);

console.log('Poster live transform math tests passed.');
