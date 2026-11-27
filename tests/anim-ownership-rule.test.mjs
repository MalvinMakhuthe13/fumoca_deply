/**
 * A hinged part and a dynamic body never both write the same node.
 * Run: node tests/anim-ownership-rule.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
const rapierMod = await import(pathToFileURL(require.resolve('@dimforge/rapier3d-compat')).href);
await import('../js/modules/anim-joint-eval.js');
const { default: Objects } = await import('../js/modules/anim-object.js');
const { default: Master } = await import('../js/modules/anim-master.js');
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

Physics.dispose();
await Physics.initRapier(rapierMod);
Physics.setGravity({ x: 0, y: -9.81, z: 0 });

const obj = Objects.createObject('cooler', 'Cooler');
const base = Objects.addComponent('cooler', 'Base', 'fixed');
base.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const lid = Objects.addComponent('cooler', 'Lid', 'hinge', base.id);
Objects.defineJoint('cooler', lid.id, {
  kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0.2, z: 0 },
  limits: { min: 0, max: 1 },
});
lid.local = { position: { x: 0, y: 0.4, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const bottle = Objects.addComponent('cooler', 'Bottle', 'fixed', base.id);
bottle.local = { position: { x: 0.3, y: 1.2, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('cooler', lid.id, 0);
Objects.captureKeyframe('cooler', 0);
Objects.setJointValue('cooler', lid.id, 1);
Objects.captureKeyframe('cooler', 1);

const baseNode = new THREE.Object3D();
const lidNode = new THREE.Object3D();
const bottleNode = new THREE.Object3D();
baseNode.add(lidNode);
baseNode.add(bottleNode);
Master.addObject(Objects.get('cooler'));
Master.setObjectBinding('cooler', new Map([[base.id, baseNode], [lid.id, lidNode], [bottle.id, bottleNode]]));

Physics.createCollider({ id: 'floor', type: 'box', bodyType: 'static', halfExtents: { x: 2, y: 0.05, z: 2 }, localPosition: { x: 0, y: -0.05, z: 0 } });
Physics.createCollider({ id: 'lid-body', type: 'box', bodyType: 'dynamic', halfExtents: { x: 0.2, y: 0.02, z: 0.2 }, owner: { kind: 'component', objectId: 'cooler', componentId: lid.id } });
Physics.createCollider({ id: 'bottle-body', type: 'box', bodyType: 'dynamic', halfExtents: { x: 0.05, y: 0.1, z: 0.05 }, owner: { kind: 'component', objectId: 'cooler', componentId: bottle.id } });
Physics.bindSceneNode('lid-body', { node: lidNode, objectId: 'cooler', componentId: lid.id });
Physics.bindSceneNode('bottle-body', { node: bottleNode, objectId: 'cooler', componentId: bottle.id });

Master.evaluate(1);
assert(Physics.poseOwner('cooler', lid.id) === 'authored', 'Hinge owns the lid even if a dynamic body is bound');
assert(Physics.poseOwner('cooler', bottle.id) === 'simulation', 'Dynamic bottle is simulation-owned');
const lidWrittenByJoint = lidNode.quaternion.clone();
assert(Math.abs(lidWrittenByJoint.x) > 0.1, 'Joint writer moved the lid');

const lidBefore = lidNode.position.clone();
const lidQuat = lidNode.quaternion.clone();
Physics.syncFromEvaluation({
  objects: {
    cooler: {
      [lid.id]: { pos: { x: lidNode.position.x, y: lidNode.position.y, z: lidNode.position.z }, rot: { x: 0, y: 0, z: 0 } },
      [bottle.id]: { pos: { x: 0.3, y: 1.2, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
for (let i = 0; i < 25; i++) Physics.step(1 / 60);
const posed = Physics.applyDynamicPoses();
assert(near(lidNode.position.x, lidBefore.x) && near(lidNode.position.y, lidBefore.y) && near(lidNode.position.z, lidBefore.z), 'Physics did not move the hinged lid');
assert(near(lidNode.quaternion.x, lidQuat.x) && near(lidNode.quaternion.w, lidQuat.w), 'Physics did not rotate the hinged lid');
assert(bottleNode.position.y < 1.2, 'Physics moved the bottle');
assert(posed.skipped >= 1, 'Authored lid was skipped by the dynamic writer');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
