/**
 * Deterministic interaction ownership and scrub tests.
 * Run: node tests/anim-ownership-scrub.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/workspace/artifacts/package.json');
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
const rapierRequire = createRequire('/tmp/package.json');
const rapierMod = await import(pathToFileURL(rapierRequire.resolve('@dimforge/rapier3d-compat')).href);
const { default: Physics } = await import('../js/modules/anim-physics.js');
const { default: Master } = await import('../js/modules/anim-master.js');
const { default: Objects } = await import('../js/modules/anim-object.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

await Physics.initRapier(rapierMod);
const bottle = Objects.createObject('bottle', 'Bottle');
const body = Objects.addComponent('bottle', 'Body', 'transform');
Objects.setComponentTransform('bottle', body.id, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
Objects.captureKeyframe('bottle', 0);
Master.addObject(bottle);
Master.setDuration(6);
Master.setInteractions([
  { type: 'grasp', time: 2, target: { objectId: 'bottle', componentId: body.id }, colliderId: 'bottle', _seq: 0 },
  { type: 'release', time: 4, target: { objectId: 'bottle', componentId: body.id }, colliderId: 'bottle', _seq: 1 },
]);
const node = new THREE.Object3D();
Master.setObjectBinding('bottle', new Map([[body.id, node]]));
Physics.createCollider({ id: 'bottle', type: 'capsule', bodyType: 'kinematic', radius: 0.04, height: 0.2, owner: { kind: 'component', objectId: 'bottle', componentId: body.id } });
Physics.bindSceneComponent('bottle', body.id, { node, colliderId: 'bottle' });

const base = Physics.getTransitionCount();
Master.evaluate(1);
assert(Physics.get('bottle').bodyType === 'kinematic', 'Before grasp: kinematic');
Master.evaluate(2);
assert(Physics.get('bottle').bodyType === 'kinematic', 'At grasp: kinematic');
Master.evaluate(3);
assert(Physics.get('bottle').bodyType === 'kinematic', 'Between: kinematic');
Master.evaluate(4);
assert(Physics.get('bottle').bodyType === 'dynamic', 'At release: dynamic');
Master.evaluate(5);
assert(Physics.get('bottle').bodyType === 'dynamic', 'After release: dynamic');
const afterForward = Physics.getTransitionCount();
assert(afterForward - base === 1, 'Only one transition across the timeline');

Master.evaluate(5);
Master.evaluate(5);
assert(Physics.getTransitionCount() === afterForward, 'Repeated evaluate after release does not recreate');

Master.evaluate(2);
assert(Physics.get('bottle').bodyType === 'kinematic', 'Scrub back to grasp: kinematic');
Master.evaluate(0);
assert(Physics.get('bottle').bodyType === 'kinematic', 'Scrub before grasp: kinematic');
const afterBack = Physics.getTransitionCount();
assert(afterBack - afterForward === 1, 'One transition on scrub back');

Master.evaluate(0);
assert(Physics.getTransitionCount() === afterBack, 'Repeated scrub does not recreate');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
