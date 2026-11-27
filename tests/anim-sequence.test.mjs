/**
 * One press can run an ordered sequence on the master clock.
 * Run: node tests/anim-sequence.test.mjs
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

const obj = Objects.createObject('pair', 'Pair');
const root = Objects.addComponent('pair', 'Root', 'fixed');
root.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const head = Objects.addComponent('pair', 'Lamp head', 'hinge', root.id);
const body = Objects.addComponent('pair', 'Camera body', 'hinge', root.id);
for (const part of [head, body]) {
  Objects.defineJoint('pair', part.id, { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: 1 } });
  part.local = { position: { x: 0, y: 0.2, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  Objects.setJointValue('pair', part.id, 0);
}
Objects.captureKeyframe('pair', 0);
Objects.setJointValue('pair', head.id, 1);
Objects.setJointValue('pair', body.id, 1);
Objects.captureKeyframe('pair', 2);
Objects.setJointValue('pair', head.id, 0);
Objects.setJointValue('pair', body.id, 0);
const rootNode = new THREE.Object3D();
const headNode = new THREE.Object3D();
const bodyNode = new THREE.Object3D();
rootNode.add(headNode); rootNode.add(bodyNode);
Master.addObject(Objects.get('pair'));
Master.setObjectBinding('pair', new Map([[root.id, rootNode], [head.id, headNode], [body.id, bodyNode]]));
Master.evaluate(0);

let rafs = 0;
globalThis.requestAnimationFrame = () => { rafs += 1; return rafs; };
globalThis.cancelAnimationFrame = () => {};
const started = Master.playSequence([
  { objectId: 'pair', componentId: head.id, to: 1, duration: 0.2, endTime: null },
  { objectId: 'pair', componentId: body.id, to: 1, duration: 0.2, endTime: null },
]);
assert(started.ok, 'Sequence accepted');
assert(Master.getGesture('pair', head.id) && !Master.getGesture('pair', body.id), 'Lamp head moves first');
Master.play();
assert(rafs === 1, 'Sequence uses the one master clock');
Master.advanceGestures(0.2);
assert(near(head.jointValue, 1), 'Lamp head finished');
assert(Master.getGesture('pair', body.id), 'Camera body starts after the head');
assert(near(body.jointValue, 0) || Master.getGesture('pair', body.id).elapsed === 0, 'Camera body has not moved yet');
Master.advanceGestures(0.2);
assert(near(body.jointValue, 1), 'Camera body finishes second');
assert(Master.gesturesIdle(), 'Sequence is idle');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
