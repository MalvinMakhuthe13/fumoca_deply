/**
 * Dynamic scene binding tests.
 * Run: node tests/anim-physics-binding.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;

const rapierRequire = createRequire(import.meta.url);
const rapierUrl = pathToFileURL(rapierRequire.resolve('@dimforge/rapier3d-compat')).href;
const rapierMod = await import(rapierUrl);
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 0.05) { return Math.abs(a - b) < eps; }

await Physics.initRapier(rapierMod);
Physics.setGravity({ x: 0, y: -9.81, z: 0 });

function makeNode() {
  const n = new THREE.Object3D();
  n.position.set(0, 0, 0);
  n.quaternion.set(0, 0, 0, 1);
  return n;
}

// Root node fall
const root = makeNode();
Physics.createCollider({ id: 'root', type: 'sphere', bodyType: 'dynamic', radius: 0.1, mass: 1, owner: { kind: 'object', objectId: 'r' } });
Physics.bindSceneNode('root', { node: root });
Physics.syncFromEvaluation({ objects: { r: { c: { pos: { x: 0, y: 2, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
for (let i = 0; i < 10; i++) Physics.step(1/60);
const applied = Physics.applyDynamicPoses();
assert(applied.applied === 1, 'Root binding applied');
assert(root.position.y < 2, 'Root node fell');

// Translated parent
Physics.dispose();
await Physics.initRapier(rapierMod);
const parent = makeNode();
parent.position.set(5, 0, 0);
parent.updateMatrixWorld(true);
const child = makeNode();
child.parent = parent;
Physics.createCollider({ id: 'child', type: 'sphere', bodyType: 'dynamic', radius: 0.1, mass: 1, owner: { kind: 'object', objectId: 'c' } });
Physics.bindSceneNode('child', { node: child, parent });
Physics.syncFromEvaluation({ objects: { c: { c: { pos: { x: 5, y: 2, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
Physics.applyDynamicPoses();
assert(near(child.position.x, 0, 0.2), 'Translated parent: local x near 0');

// Local offset
Physics.dispose();
await Physics.initRapier(rapierMod);
const off = makeNode();
Physics.createCollider({ id: 'off', type: 'sphere', bodyType: 'dynamic', radius: 0.1, mass: 1, localPosition: { x: 0, y: 0.5, z: 0 }, owner: { kind: 'object', objectId: 'o' } });
Physics.bindSceneNode('off', { node: off, localPosition: { x: 0, y: 0.5, z: 0 } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 1, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
Physics.applyDynamicPoses();
assert(near(off.position.y, 1.0, 0.2), 'Local offset removed: node at owner pose');

// Duplicate bind rejected
const dup = Physics.bindSceneNode('off', { node: off });
assert(dup.ok === false && dup.reason === 'already_bound', 'Duplicate bind rejected');

// Unbind
assert(Physics.unbindSceneNode('off') === true, 'Unbind succeeds');
assert(Physics.getBinding('off') === null, 'Binding gone');

// Reset restores
Physics.dispose();
await Physics.initRapier(rapierMod);
const bottle = makeNode();
Physics.createCollider({ id: 'bot', type: 'sphere', bodyType: 'dynamic', radius: 0.1, mass: 1, owner: { kind: 'object', objectId: 'b' } });
Physics.bindSceneNode('bot', { node: bottle });
Physics.syncFromEvaluation({ objects: { b: { c: { pos: { x: 0, y: 1.5, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
for (let i = 0; i < 20; i++) Physics.step(1/60);
Physics.applyDynamicPoses();
const fallen = bottle.position.y;
Physics.reset();
Physics.applyDynamicPoses();
assert(bottle.position.y > fallen, 'Reset restores node higher than fallen');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
