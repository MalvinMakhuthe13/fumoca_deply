/**
 * Studio scene integration: registry, handoff, cooler fixture.
 * Run: node tests/anim-physics-studio-integration.test.mjs
 */
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/workspace/artifacts/package.json');
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
const rapierRequire = createRequire('/tmp/package.json');
const rapierMod = await import(pathToFileURL(rapierRequire.resolve('@dimforge/rapier3d-compat')).href);
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 0.05) { return Math.abs(a - b) < eps; }

await Physics.initRapier(rapierMod);
Physics.setGravity({ x: 0, y: -9.81, z: 0 });

// Registry
const baseNode = new THREE.Object3D();
const lidNode = new THREE.Object3D();
const bottleNode = new THREE.Object3D();
lidNode.parent = baseNode;

assert(Physics.registerSceneObject('cooler', 'base', { node: baseNode }).ok, 'Register base');
assert(Physics.registerSceneObject('cooler', 'base', { node: baseNode }).ok === false, 'Duplicate rejected');
assert(Physics.registerSceneObject('cooler', 'missing', {}).reason === 'missing_node', 'Missing node rejected');
assert(Physics.registerSceneObject('cooler', 'lid', { node: lidNode, parent: baseNode }).ok, 'Register lid');
assert(Physics.registerSceneObject('bottle', 'body', { node: bottleNode }).ok, 'Register bottle');

// Colliders
Physics.createCollider({ id: 'floor', type: 'box', bodyType: 'static', halfExtents: { x: 2, y: 0.05, z: 2 }, owner: { kind: 'component', objectId: 'scene', componentId: 'floor' } });
Physics.createCollider({ id: 'base', type: 'box', bodyType: 'static', halfExtents: { x: 0.4, y: 0.3, z: 0.3 }, owner: { kind: 'component', objectId: 'cooler', componentId: 'base' } });
Physics.createCollider({ id: 'lid', type: 'box', bodyType: 'kinematic', halfExtents: { x: 0.4, y: 0.02, z: 0.3 }, localPosition: { x: 0, y: 0.3, z: 0 }, owner: { kind: 'component', objectId: 'cooler', componentId: 'lid' } });
Physics.createCollider({ id: 'bottle', type: 'capsule', bodyType: 'kinematic', radius: 0.04, height: 0.2, mass: 0.4, owner: { kind: 'component', objectId: 'bottle', componentId: 'body' } });
Physics.bindSceneNode('bottle', { node: bottleNode, objectId: 'bottle', componentId: 'body' });

Physics.syncFromEvaluation({
  objects: {
    cooler: {
      base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      lid: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
    bottle: { body: { pos: { x: 0, y: 0.4, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
Physics.applyDynamicPoses();
const initialY = bottleNode.position.y;

const handoff = Physics.transitionBodyType('bottle', 'dynamic');
assert(handoff.ok === true, 'Handoff to dynamic');
Physics.applyDynamicPoses();
assert(near(bottleNode.position.y, initialY, 0.15), 'No jump on kinematic-to-dynamic');

for (let i = 0; i < 30; i++) { Physics.step(1/60); Physics.applyDynamicPoses(); }
const fallenY = bottleNode.position.y;
assert(fallenY < initialY, 'Bottle falls after release');

const back = Physics.transitionBodyType('bottle', 'kinematic');
assert(back.ok === true, 'Handoff to kinematic');
Physics.applyDynamicPoses();
assert(near(bottleNode.position.y, fallenY, 0.15), 'No jump on dynamic-to-kinematic');
Physics.transitionBodyType('bottle', 'dynamic');

Physics.reset();
Physics.applyDynamicPoses();
assert(near(bottleNode.position.y, 0.4, 0.15), 'Reset restores authored pose Y 0.4');

// Unload
const countBefore = Physics.getBodyCount();
Physics.removeCollider('bottle');
Physics.unregisterSceneObject('bottle', 'body');
assert(Physics.getSceneObject('bottle', 'body') === null, 'Unregister clears registry');
assert(Physics.getBodyCount() === countBefore - 1, 'Unload removes body');

// Reload
Physics.createCollider({ id: 'bottle', type: 'capsule', bodyType: 'kinematic', radius: 0.04, height: 0.2, owner: { kind: 'component', objectId: 'bottle', componentId: 'body' } });
Physics.registerSceneObject('bottle', 'body', { node: bottleNode });
assert(Physics.getSceneObject('bottle', 'body') !== null, 'Reload registers again');

Physics.dispose();
assert(Physics.list().length === 0, 'Dispose clears all');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
