import assert from 'node:assert/strict';
import { computePosterWorldTransform } from '../js/modules/poster-live-transform.js';

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

console.log('Poster live transform math tests passed.');
