import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/0.180.0/build/three.module.js';
import { ViewController } from '../js/modules/view-settings.js';

// What the owner locks in Studio stays locked for visitors, whatever else runs.
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
const cam = new THREE.PerspectiveCamera();
const orbit = { target: new THREE.Vector3(), enableZoom: true, enableRotate: true, enablePan: true, minDistance: 0, maxDistance: Infinity, update() {} };
let current = orbit;
const vc = new ViewController(THREE, cam, orbit, { lockZoom: true, lockRotate: true, zoomMin: 0.5, zoomMax: 2, startView: { position: [0, 0, 4], target: [0, 0, 0] } }, { getControls: () => current, getCamera: () => cam });
vc.apply();
assert.equal(orbit.enableZoom, false); assert.equal(orbit.enableRotate, false); assert.equal(orbit.enablePan, false);
assert.equal(orbit.minDistance, 2); assert.equal(orbit.maxDistance, 8);
// a re-fit / poster / camera-mode button unlocks and throws the camera away
orbit.enableZoom = true; orbit.enableRotate = true; orbit.minDistance = 0; orbit.maxDistance = Infinity; cam.position.set(0, 0, 40);
assert.equal(vc.enforce(), true);
assert.equal(orbit.enableZoom, false); assert.equal(orbit.enableRotate, false);
assert.equal(orbit.maxDistance, 8); assert.ok(Math.abs(cam.position.z - 8) < 1e-9, 'camera brought back inside the zoom limit');
assert.equal(vc.enforce(), false, 'nothing to do when it already holds');
// the viewer swaps orbit → trackball: the new controls get the same locks
const tb = { target: new THREE.Vector3(), noZoom: false, noRotate: false, noPan: false, noRoll: false, minDistance: 0, maxDistance: Infinity, update() {} };
current = tb; vc.enforce();
assert.equal(tb.noZoom, true); assert.equal(tb.noRotate, true); assert.equal(tb.noPan, true); assert.equal(tb.maxDistance, 8);
// limits only (no lock): zoom stays on, inside the range
const o2 = { target: new THREE.Vector3(), enableZoom: false, enableRotate: true, enablePan: false, minDistance: 0, maxDistance: Infinity, update() {} };
const v2 = new ViewController(THREE, cam, o2, { zoomMin: 0.5, zoomMax: 2, allowPan: true, startView: { position: [0, 0, 4], target: [0, 0, 0] } });
v2.apply(); assert.equal(o2.enableZoom, true); assert.equal(o2.enablePan, true); assert.equal(o2.minDistance, 2);
vc.dispose(); v2.dispose();
console.log('view locks: all checks passed');
