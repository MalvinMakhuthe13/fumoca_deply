import assert from 'node:assert/strict';
import { advancePosterMotionPhase, applyPosterLiveTransform, applyPosterMotionRotation, computePosterWorldTransform, posterMotionSpeed } from '../js/modules/poster-live-transform.js';

assert.equal(posterMotionSpeed('still'), 0);
assert.equal(posterMotionSpeed('gentle'), 0.35);
assert.equal(posterMotionSpeed('normal'), 0.8);
assert.equal(posterMotionSpeed('dynamic'), 1.5);
assert.equal(posterMotionSpeed('unknown'), 0, 'Unknown motion levels safely remain still');

assert.ok(advancePosterMotionPhase(0, 1, 0.016) > 0, 'Motion phase advances with elapsed frame time');
assert.equal(advancePosterMotionPhase(1, 0, 0.016), 0, 'Still mode resets motion phase');
assert.equal(advancePosterMotionPhase(1, 1, 0), 1, 'Zero elapsed time does not advance motion');
assert.ok(advancePosterMotionPhase(6.27, 1, 0.05) < Math.PI * 2, 'Motion phase wraps without discontinuous overflow');
assert.equal(advancePosterMotionPhase(0, 1, 1), 0.05, 'Frame delta is capped to prevent tab-resume jumps');

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


class MockVector3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  applyQuaternion() { return this; }
  normalize() { return this; }
}

let motionAxis, motionAngle, multiplied = false;
const motionGroup = { quaternion: { multiply(q) { multiplied = true; this.last = q; } } };
class MockQuaternion {
  setFromAxisAngle(axis, angle) { motionAxis = axis; motionAngle = angle; return this; }
}
assert.equal(applyPosterMotionRotation({Vector3:MockVector3,Quaternion:MockQuaternion},motionGroup,0.75),true);
assert.equal(multiplied,true,'Motion yaw multiplies the freshly-applied base orientation');
assert.equal(motionAngle,0.75);
assert.equal(applyPosterMotionRotation({},motionGroup,0.75),false);

let projectionUpdated = false;
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

const posterAspectApplied = applyPosterLiveTransform({
  THREE: { Vector3: MockVector3 },
  group: mockGroup,
  camera: mockCamera,
  center: base.center,
  composition: { aspectRatio: 0.8, object: { x: 0.75, y: 0.25, scale: 1, rotation: 0 } },
  enabled: true,
});
assert.equal(posterAspectApplied, true);
assert.ok(Math.abs(mockGroup.position.x - 6) < 1e-9,
  'Poster X coordinates must use the artboard aspect ratio instead of the wider editor camera aspect');
assert.ok(Math.abs(mockGroup.position.y - 8) < 1e-9,
  'Poster Y coordinates remain normalized to the same fixed artboard');



// Multiple poster subjects must retain independent camera-plane transforms and
// independent motion phases when they share one published Spark scene.
const subjectA = {
  id: 'subject-a',
  center: { x: 0, y: 0, z: 0 },
  object: { x: 0.2, y: 0.3, scale: 0.65, rotation: -18, z: 2 },
};
const subjectB = {
  id: 'subject-b',
  center: { x: 0, y: 0, z: 0 },
  object: { x: 0.8, y: 0.7, scale: 1.8, rotation: 42, z: 8 },
};
const worldA = computePosterWorldTransform({
  center: subjectA.center, cameraPosition: base.cameraPosition,
  cameraRight: base.cameraRight, cameraUp: base.cameraUp,
  fov: base.fov, aspect: base.aspect, object: subjectA.object,
});
const worldB = computePosterWorldTransform({
  center: subjectB.center, cameraPosition: base.cameraPosition,
  cameraRight: base.cameraRight, cameraUp: base.cameraUp,
  fov: base.fov, aspect: base.aspect, object: subjectB.object,
});
assert.notDeepEqual(worldA.position, worldB.position, 'Each subject must keep its own poster-space position and pivot');
assert.notEqual(worldA.scale, worldB.scale, 'Each subject must keep its own scale');
assert.notEqual(worldA.rotation, worldB.rotation, 'Each subject must keep its own base rotation');
const distanceToCamera = (position) => Math.hypot(
  base.cameraPosition.x - position.x,
  base.cameraPosition.y - position.y,
  base.cameraPosition.z - position.z,
);
assert.ok(distanceToCamera(worldB.position) < distanceToCamera(worldA.position),
  'A higher poster depth layer moves the subject toward the camera along its view direction');

const subjectPhases = new Map([['subject-a', 0.25], ['subject-b', 1.1]]);
let yawA = null, yawB = null;
const makeMotionGroup = (capture) => ({
  quaternion: {
    multiply(q) { capture(q.angle); },
  },
});
class CaptureQuaternion {
  setFromAxisAngle(axis, angle) { this.angle = angle; return this; }
}
const motionA = makeMotionGroup(angle => { yawA = angle; });
const motionB = makeMotionGroup(angle => { yawB = angle; });
assert.equal(applyPosterMotionRotation({ Vector3: MockVector3, Quaternion: CaptureQuaternion }, motionA, subjectPhases.get(subjectA.id)), true);
assert.equal(applyPosterMotionRotation({ Vector3: MockVector3, Quaternion: CaptureQuaternion }, motionB, subjectPhases.get(subjectB.id)), true);
assert.equal(yawA, 0.25, 'Subject A must receive only its own motion phase');
assert.equal(yawB, 1.1, 'Subject B must receive only its own motion phase');

console.log('Poster live transform math tests passed.');
