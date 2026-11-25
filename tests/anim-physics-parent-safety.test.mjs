/**
 * Parent transform safety and restart semantics.
 * Run: node tests/anim-physics-parent-safety.test.mjs
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
const { default: Master } = await import('../js/modules/anim-master.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

await Physics.initRapier(rapierMod);

function bind(id, parent) {
  const node = new THREE.Object3D();
  node.parent = parent || null;
  Physics.createCollider({ id, type: 'sphere', bodyType: 'dynamic', radius: 0.1, owner: { kind: 'object', objectId: id } });
  Physics.bindSceneNode(id, { node, parent: parent || null });
  Physics.syncFromEvaluation({ objects: { [id]: { c: { pos: { x: 0, y: 1, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
  return Physics.applyDynamicPoses();
}

const translated = new THREE.Object3D();
translated.position.set(3, 0, 0);
translated.updateMatrixWorld(true);
assert(bind('t', translated).applied === 1, 'Translated parent applied');

Physics.dispose();
await Physics.initRapier(rapierMod);
const rotated = new THREE.Object3D();
rotated.rotation.y = Math.PI / 3;
rotated.updateMatrixWorld(true);
assert(bind('r', rotated).applied === 1, 'Rotated parent applied');

Physics.dispose();
await Physics.initRapier(rapierMod);
const uniform = new THREE.Object3D();
uniform.scale.set(2, 2, 2);
uniform.updateMatrixWorld(true);
assert(bind('u', uniform).applied === 1, 'Uniform scale applied');

Physics.dispose();
await Physics.initRapier(rapierMod);
const nonUni = new THREE.Object3D();
nonUni.scale.set(2, 1, 1);
nonUni.updateMatrixWorld(true);
const nu = bind('nu', nonUni);
assert(nu.failed >= 1 && nu.errors[0]?.reason === 'non_uniform_parent_scale', 'Non-uniform rejected');

Physics.dispose();
await Physics.initRapier(rapierMod);
const singular = new THREE.Object3D();
singular.scale.set(0, 1, 1);
singular.updateMatrixWorld(true);
const sg = bind('sg', singular);
assert(sg.failed >= 1, 'Singular rejected');

Physics.dispose();
await Physics.initRapier(rapierMod);
const shear = new THREE.Object3D();
shear.matrix.makeBasis(
  new THREE.Vector3(1, 0.5, 0).normalize(),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1)
);
shear.matrixAutoUpdate = false;
shear.updateMatrixWorld(true);
const sh = bind('sh', shear);
assert(sh.failed >= 1 && sh.errors[0]?.reason === 'sheared_parent', 'Shear rejected');

// Nested rotated
Physics.dispose();
await Physics.initRapier(rapierMod);
const gp = new THREE.Object3D();
gp.rotation.y = Math.PI / 4;
const p = new THREE.Object3D();
p.rotation.x = Math.PI / 6;
p.parent = gp;
gp.updateMatrixWorld(true);
assert(bind('nest', p).applied === 1, 'Nested rotated parents applied');

// Restart semantics
assert(typeof Master.reset === 'function', 'Master.reset exists');
assert(typeof Master.restart === 'function', 'Master.restart exists');
const stopResult = Master.stop();
assert(stopResult.physicsReset === false, 'stop does not reset physics');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
