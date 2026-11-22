/**
 * Hotspot offsets live in the component frame, so they rotate with the hinge.
 * Run: node tests/anim-anchor.test.mjs
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

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-4) { return Math.abs(a - b) < eps; }

const obj = Objects.createObject('cam', 'Camera');
const tripod = Objects.addComponent('cam', 'Tripod', 'fixed');
tripod.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const body = Objects.addComponent('cam', 'Body', 'hinge', tripod.id);
Objects.defineJoint('cam', body.id, {
  kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 },
  limits: { min: 0, max: Math.PI / 2 },
});
body.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('cam', body.id, 0);
Objects.captureKeyframe('cam', 0);
Objects.setJointValue('cam', body.id, Math.PI / 2);
Objects.captureKeyframe('cam', 2);
const tripodNode = new THREE.Object3D();
const bodyNode = new THREE.Object3D();
tripodNode.add(bodyNode);
Master.addObject(Objects.get('cam'));
Master.setObjectBinding('cam', new Map([[tripod.id, tripodNode], [body.id, bodyNode]]));
const anchor = { objectId: 'cam', componentId: body.id, offset: { x: 0, y: 0, z: 1 }, label: 'Body' };
Master.setAnchors([anchor]);

const closed = Master.evaluate(0);
const c = closed.anchors[0].world;
assert(near(c.x, 1) && near(c.y, 0) && near(c.z, 1), 'Closed offset is in front of the body');
assert(near(c.quaternion.w, 1), 'Closed orientation is identity');

const open = Master.evaluate(2);
const o = open.anchors[0].world;
assert(near(o.x, 1, 1e-3) && near(o.y, 0, 1e-3) && near(o.z, -1, 1e-3), 'Open offset swung around Y with the body');
assert(Math.abs(o.quaternion.y) > 0.5, 'Orientation follows the hinge');
const worldAgain = Master.resolveAnchor(anchor);
assert(near(worldAgain.x, o.x) && near(worldAgain.quaternion.y, o.quaternion.y), 'resolveAnchor matches the evaluated anchor');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
