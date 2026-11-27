/**
 * Press eases on the master clock. One RAF. Reversible. No drift.
 * Run: node tests/anim-ease.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
await import('../js/modules/anim-joint-eval.js');
const { default: Objects } = await import('../js/modules/anim-object.js');
const { default: Master } = await import('../js/modules/anim-master.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

const obj = Objects.createObject('lid', 'Lid');
const base = Objects.addComponent('lid', 'Base', 'fixed');
base.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const door = Objects.addComponent('lid', 'Door', 'hinge', base.id);
Objects.defineJoint('lid', door.id, {
  kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 },
  limits: { min: 0, max: Math.PI / 2 },
});
door.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('lid', door.id, 0);
Objects.captureKeyframe('lid', 0);
Objects.setJointValue('lid', door.id, Math.PI / 2);
Objects.captureKeyframe('lid', 2);
const baseNode = new THREE.Object3D();
const doorNode = new THREE.Object3D();
baseNode.add(doorNode);
Master.addObject(Objects.get('lid'));
Master.setObjectBinding('lid', new Map([[base.id, baseNode], [door.id, doorNode]]));
Master.evaluate(0);
const closed = doorNode.position.clone();

const easeAt = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
let rafCalls = 0;
globalThis.requestAnimationFrame = () => { rafCalls++; return rafCalls; };
globalThis.cancelAnimationFrame = () => {};

const started = Master.easeJoint('lid', door.id, Math.PI / 2, 1, 2);
assert(started.ok && started.from === 0 && started.to === Math.PI / 2, 'Ease starts at the closed value');
Master.play();
assert(rafCalls === 1, 'Play shares the gesture clock');
Master.advanceGestures(0.25);
const mid = Master.getGesture('lid', door.id);
assert(mid && near(mid.value, (Math.PI / 2) * easeAt(0.25)), 'Quarter time uses the cosine ease');
assert(mid.value < (Math.PI / 2) * 0.25, 'Ease is not a linear snap');
const reversedFrom = mid.value;
const rev = Master.easeJoint('lid', door.id, 0, 1, 0);
assert(rev.ok && near(rev.from, reversedFrom), 'Reverse starts from the current value');
Master.advanceGestures(0.25);
const back = Master.getGesture('lid', door.id);
assert(back && back.value < reversedFrom, 'Reverse moves back toward closed');
Master.advanceGestures(1);
assert(Master.gesturesIdle(), 'Reverse settles');
assert(near(door.jointValue, 0), 'Settled closed value is exact');
Master.evaluate(0);
doorNode.updateWorldMatrix(true, true);
assert(near(doorNode.position.x, closed.x) && near(doorNode.position.z, closed.z), 'Settled closed pose matches the start');

Master.easeJoint('lid', door.id, Math.PI / 2, 0.4, 2);
Master.advanceGestures(0.4);
Master.evaluate(2);
const openPos = doorNode.position.clone();
assert(near(door.jointValue, Math.PI / 2), 'Open value is exact');
for (let i = 0; i < 20; i++) {
  Master.easeJoint('lid', door.id, 0, 0.4, 0);
  Master.advanceGestures(0.4);
  Master.easeJoint('lid', door.id, Math.PI / 2, 0.4, 2);
  Master.advanceGestures(0.4);
}
assert(Master.gesturesIdle(), 'Idle after 20 cycles');
assert(near(door.jointValue, Math.PI / 2), 'No drift in the joint value');
Master.evaluate(2);
doorNode.updateWorldMatrix(true, true);
assert(near(doorNode.position.x, openPos.x) && near(doorNode.position.y, openPos.y) && near(doorNode.position.z, openPos.z), 'No drift in the open pose');
Master.easeJoint('lid', door.id, 0, 0.4, 0);
Master.advanceGestures(0.4);
Master.evaluate(0);
doorNode.updateWorldMatrix(true, true);
assert(near(doorNode.position.x, closed.x) && near(doorNode.position.z, closed.z), 'Closed pose still matches after the cycles');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
