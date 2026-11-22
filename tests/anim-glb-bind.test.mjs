/**
 * GLB bind proof. Uses a Three.js hierarchy as a stand-in for a loaded GLB.
 * Run: node tests/anim-glb-bind.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
await import('../js/modules/anim-joint-eval.js');
await import('../js/modules/anim-object.js');
await import('../js/modules/anim-master.js');
await import('../js/modules/anim-studio-init.js');
const { default: Bind } = await import('../js/modules/anim-glb-bind.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

const root = new THREE.Object3D(); root.name = 'Cooler';
const lid = new THREE.Object3D(); lid.name = 'Lid';
lid.position.set(0, 0.3, 0);
root.add(lid);

const bound = Bind.bindFromScene(root, { objectId: 'cooler', name: 'Cooler' });
assert(bound.ok && bound.bound === 2, 'Bound root and lid');

const lidId = lid.userData.fumocaComponentId;
const hinge = Bind.setHinge('cooler', lidId, { x: 1, y: 0, z: 0 }, { min: 0, max: Math.PI / 2 });
assert(hinge.ok, 'Hinge defined');
Bind.keyframe('cooler', lidId, 0, 0);
Bind.keyframe('cooler', lidId, 1, Math.PI / 2);

const closed = Bind.scrub(0);
assert(!closed.objects.cooler[lidId].jointError, 'Closed has no error');
const open = Bind.scrub(1);
assert(!open.objects.cooler[lidId].jointError, 'Open has no error');
assert(lid.rotation.x !== 0 || Math.abs(lid.quaternion.x) > 0.1 || Math.abs(lid.position.z) > 0.01, 'Lid moved');
const back = Bind.scrub(0);
assert(near(lid.position.y, 0.3), 'Scrub back restores');

const rig = new THREE.Group(); rig.name = 'Rig';
const tripod = new THREE.Object3D(); tripod.name = 'Tripod';
tripod.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
tripod.position.set(0.2, 0, 0);
const body = new THREE.Object3D(); body.name = 'Body';
body.position.set(0, 0.5, 0);
rig.add(tripod); rig.add(body);
const rigBound = Bind.bindFromScene(rig, { objectId: 'cam', name: 'Camera' });
assert(rigBound.ok, 'Sibling rig bound');
const bodyId = body.userData.fumocaComponentId;
Bind.setHinge('cam', bodyId, { x: 1, y: 0, z: 0 }, { min: 0, max: 1 }, { x: 0, y: 0.2, z: 0 });
Bind.keyframe('cam', bodyId, 0, 0);
Bind.keyframe('cam', bodyId, 1, 1);
const qBefore = tripod.quaternion.clone();
const pBefore = tripod.position.clone();
Bind.scrub(1);
assert(near(tripod.quaternion.y, qBefore.y) && near(tripod.quaternion.w, qBefore.w), 'Static sibling quaternion stays');
assert(near(tripod.position.x, pBefore.x) && near(tripod.position.y, pBefore.y), 'Static sibling position stays');
assert(Math.abs(body.quaternion.x) > 0.1 || Math.abs(body.position.z) > 0.01, 'Hinged sibling moved');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
