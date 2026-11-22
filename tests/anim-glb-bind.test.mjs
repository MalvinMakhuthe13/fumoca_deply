/**
 * GLB bind proof. Uses a Three.js hierarchy as a stand-in for a loaded GLB.
 * Run: node tests/anim-glb-bind.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/workspace/artifacts/package.json');
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
