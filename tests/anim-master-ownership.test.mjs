/**
 * Master timeline ownership with real physics.
 * Run: node tests/anim-master-ownership.test.mjs
 */
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
const rapierRequire = createRequire(import.meta.url);
const rapierMod = await import(pathToFileURL(rapierRequire.resolve('@dimforge/rapier3d-compat')).href);
const { default: Physics } = await import('../js/modules/anim-physics.js');
const { default: Master } = await import('../js/modules/anim-master.js');
const { default: Objects } = await import('../js/modules/anim-object.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 0.1) { return Math.abs(a - b) < eps; }

await Physics.initRapier(rapierMod);
Physics.setGravity({ x: 0, y: -9.81, z: 0 });

const bottle = Objects.createObject('bottle', 'Bottle');
const body = Objects.addComponent('bottle', 'Body', 'transform');
Objects.setComponentTransform('bottle', body.id, { x: 0, y: 0, z: 0 }, { x: 0, y: 1.2, z: 0 });
Objects.captureKeyframe('bottle', 0);
Objects.setComponentTransform('bottle', body.id, { x: 0, y: 0, z: 0 }, { x: 0.4, y: 1.2, z: 0 });
Objects.captureKeyframe('bottle', 1);
Master.addObject(bottle);
Master.setDuration(2);
Master.setInteractions([
  { type: 'grasp', time: 0.2, target: { objectId: 'bottle', componentId: body.id }, colliderId: 'bottle' },
  { type: 'release', time: 0.8, target: { objectId: 'bottle', componentId: body.id }, colliderId: 'bottle' },
]);

const node = new THREE.Object3D();
const map = new Map([[body.id, node]]);
Master.setObjectBinding('bottle', map);
Physics.createCollider({ id: 'bottle', type: 'capsule', bodyType: 'kinematic', radius: 0.04, height: 0.2, mass: 0.4, owner: { kind: 'component', objectId: 'bottle', componentId: body.id } });
Physics.bindSceneComponent('bottle', body.id, { node, colliderId: 'bottle' });

const ev0 = Master.evaluate(0);
Physics.applyDynamicPoses();
const y0 = node.position.y;
assert(y0 > 1, 'Initial pose applied');

const evGrasp = Master.evaluate(0.3);
Physics.applyDynamicPoses();
assert(Physics.get('bottle').bodyType === 'kinematic', 'Grasp keeps kinematic');
assert(near(node.position.y, y0, 0.2), 'Grasp no jump');

const bodiesBefore = Physics.getBodyCount();
Master.evaluate(0.3);
assert(Physics.getBodyCount() === bodiesBefore, 'Repeated evaluate does not recreate bodies');

const evRelease = Master.evaluate(0.9);
Physics.applyDynamicPoses();
assert(Physics.get('bottle').bodyType === 'dynamic', 'Release transfers to dynamic');
const yRelease = node.position.y;

for (let i = 0; i < 20; i++) Physics.step(1/60);
Physics.applyDynamicPoses();
assert(node.position.y < yRelease, 'Gravity moves bottle after release');

Master.reset();
Physics.applyDynamicPoses();
assert(near(node.position.y, y0, 0.2), 'Reset restores authored pose');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
