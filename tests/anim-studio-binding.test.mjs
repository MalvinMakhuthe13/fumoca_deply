/**
 * Object-to-master adapter proof.
 * Run: node tests/anim-studio-binding.test.mjs
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
const { default: Studio } = await import('../js/modules/anim-studio-init.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

const obj = Objects.createObject('glb', 'GLB');
const root = Objects.addComponent('glb', 'Root', 'fixed');
root.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const frame = Objects.addComponent('glb', 'Frame', 'fixed', root.id);
frame.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const lid = Objects.addComponent('glb', 'Lid', 'hinge', frame.id);
Objects.defineJoint('glb', lid.id, { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: Math.PI / 2 } });
lid.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('glb', lid.id, 0);
Objects.captureKeyframe('glb', 0);
Objects.setJointValue('glb', lid.id, Math.PI / 2);
Objects.captureKeyframe('glb', 1);

const rootNode = new THREE.Object3D();
const frameNode = new THREE.Object3D();
const lidNode = new THREE.Object3D();
rootNode.add(frameNode);
frameNode.add(lidNode);
const map = new Map([[root.id, rootNode], [frame.id, frameNode], [lid.id, lidNode]]);

const reg = Studio.registerArticulatedObject(Objects.get('glb'), map);
assert(reg.ok === true && reg.bound === 3 && reg.missing.length === 0, 'Adapter registered all components');

const closed = Master.evaluate(0);
assert(!closed.objects.glb[lid.id].jointError, 'Closed has no jointError');
assert(near(lidNode.position.x, 1), 'Closed lid local x is 1');

const open = Master.evaluate(1);
assert(!open.objects.glb[lid.id].jointError, 'Open has no jointError');
assert(near(lidNode.position.z, -1, 1e-3), 'Open lid local z is -1');

const again = Master.evaluate(0);
assert(near(lidNode.position.x, 1) && near(lidNode.position.z, 0, 1e-3), 'Scrub back is deterministic');
assert(lidNode.parent === frameNode && frameNode.parent === rootNode, 'Hierarchy intact');

const saved = Master.serialize();
assert(saved.objects.some(o => o.id === 'glb'), 'Object survives master serialize');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
