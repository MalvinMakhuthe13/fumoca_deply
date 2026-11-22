/**
 * Binding lifecycle and parent safety.
 * Run: node tests/anim-physics-binding-lifecycle.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
const rapierRequire = createRequire(import.meta.url);
const rapierMod = await import(pathToFileURL(rapierRequire.resolve('@dimforge/rapier3d-compat')).href);
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

await Physics.initRapier(rapierMod);
const node = new THREE.Object3D();
Physics.createCollider({ id: 'c1', type: 'box', bodyType: 'dynamic', owner: { kind: 'component', objectId: 'o', componentId: 'a' } });
Physics.bindSceneNode('c1', { node, objectId: 'o', componentId: 'a' });
assert(Physics.getBinding('c1') !== null, 'Binding exists');

Physics.removeCollider('c1');
assert(Physics.getBinding('c1') === null, 'Remove clears binding');

Physics.createCollider({ id: 'c1', type: 'box', bodyType: 'dynamic', owner: { kind: 'component', objectId: 'o', componentId: 'a' } });
Physics.bindSceneNode('c1', { node, objectId: 'o', componentId: 'a' });
const base = Physics.getBodyCount();
Physics.setEnabled('c1', false);
assert(Physics.getBodyCount() === base - 1, 'Disable removes body');
assert(Physics.getBinding('c1') !== null, 'Disable keeps binding');
Physics.setEnabled('c1', true);
assert(Physics.getBodyCount() === base, 'Re-enable restores body');
assert(Physics.getBinding('c1') !== null, 'Re-enable does not duplicate binding');

Physics.dispose();
assert(Physics.getBinding('c1') === null && Physics.list().length === 0, 'Dispose clears bindings');

// Rotated parent
await Physics.initRapier(rapierMod);
const parent = new THREE.Object3D();
parent.rotation.y = Math.PI / 2;
parent.updateMatrixWorld(true);
const child = new THREE.Object3D();
child.parent = parent;
Physics.createCollider({ id: 'rot', type: 'sphere', bodyType: 'dynamic', radius: 0.1, owner: { kind: 'object', objectId: 'r' } });
Physics.bindSceneNode('rot', { node: child, parent });
Physics.syncFromEvaluation({ objects: { r: { c: { pos: { x: 0, y: 1, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
const result = Physics.applyDynamicPoses();
assert(result.applied === 1, 'Rotated parent applied');

// Singular parent
const singular = new THREE.Object3D();
singular.scale.set(0, 0, 0);
singular.updateMatrixWorld(true);
Physics.createCollider({ id: 'rot2', type: 'box', bodyType: 'dynamic', owner: { kind: 'object', objectId: 's' } });
Physics.bindSceneNode('rot2', { node: new THREE.Object3D(), parent: singular });
Physics.syncFromEvaluation({ objects: { s: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
const bad = Physics.applyDynamicPoses();
assert(bad.failed >= 1, 'Singular parent rejected');

// Ownership
assert(Physics.isSimulationOwned('o', 'a') === false, 'Removed collider not owned');
Physics.createCollider({ id: 'own', type: 'box', bodyType: 'dynamic', owner: { kind: 'component', objectId: 'obj', componentId: 'comp' } });
Physics.bindSceneNode('own', { node: new THREE.Object3D(), objectId: 'obj', componentId: 'comp' });
assert(Physics.isSimulationOwned('obj', 'comp') === true, 'Dynamic binding is simulation owned');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
