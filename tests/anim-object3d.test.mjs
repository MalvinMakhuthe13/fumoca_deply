/**
 * Real THREE.Object3D attachment tests.
 * Requires: npm install three
 * Run: node tests/anim-object3d.test.mjs
 */
import * as THREE from 'three';

globalThis.window = globalThis;
globalThis.THREE = THREE;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { default: Master } = await import('../js/modules/anim-master.js');
const { default: Skeleton } = await import('../js/modules/anim-skeleton.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function approx(a, b, eps = 0.001) { return Math.abs(a - b) < eps; }

const world = new THREE.Object3D();
world.name = 'world';
const hand = new THREE.Object3D();
hand.name = 'hand';
hand.position.set(0, 1, 0);
const coolerBase = new THREE.Object3D();
coolerBase.name = 'coolerBase';
coolerBase.position.set(2, 0, 0);
const lid = new THREE.Object3D();
lid.name = 'lid';
lid.position.set(0, 0.3, 0);
const bottle = new THREE.Object3D();
bottle.name = 'bottle';
bottle.position.set(1, 0, 0);
bottle.scale.set(1.5, 1.5, 1.5);
bottle.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);

world.add(hand);
world.add(coolerBase);
coolerBase.add(lid);
world.add(bottle);

Master.setSkeletonBinding('char', new Map([['hand', hand]]));
Master.setObjectBinding('bottle', new Map([['body', bottle]]));
Master.setObjectBinding('cooler', new Map([['base', coolerBase], ['lid', lid]]));

Master.setInteractions([
  {
    type: 'grasp', time: 1.0,
    target: { objectId: 'bottle', componentId: 'body' },
    parent: { skeletonId: 'char', boneId: 'hand' },
    offset: { x: 0, y: 0.1, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  },
  { type: 'release', time: 3.0, target: { objectId: 'bottle', componentId: 'body' } },
]);

Master.evaluate(0.5);
assert(bottle.parent === world, 'Bottle starts on world');
const origPos = bottle.position.clone();
const origQuat = bottle.quaternion.clone();
const origScale = bottle.scale.clone();

Master.evaluate(1.5);
assert(bottle.parent === hand, 'Bottle attaches to hand');
assert(approx(bottle.position.y, 0.1), 'Local offset applied');
assert(approx(bottle.quaternion.w, 1), 'Attachment orientation applied');

world.updateMatrixWorld(true);
const wp = new THREE.Vector3();
bottle.getWorldPosition(wp);
assert(approx(wp.y, 1.1, 0.01), 'World position reflects hand + offset');

Master.evaluate(3.5);
assert(bottle.parent === world, 'Release restores parent');
assert(approx(bottle.position.x, origPos.x) && approx(bottle.position.y, origPos.y), 'Position restored');
assert(approx(bottle.quaternion.w, origQuat.w, 0.01), 'Quaternion restored');
assert(approx(bottle.scale.x, origScale.x), 'Scale restored');

Master.evaluate(1.5);
assert(bottle.parent === hand, 'Forward to grasp');
Master.evaluate(0.5);
assert(bottle.parent === world, 'Scrub back restores parent');
assert(approx(bottle.scale.x, 1.5), 'Scale still correct after scrub');

const pos1 = bottle.position.clone();
Master.evaluate(1.5);
Master.evaluate(1.5);
Master.evaluate(1.5);
const pos2 = bottle.position.clone();
assert(bottle.parent === hand, 'Repeated eval no drift');

assert(lid.parent === coolerBase, 'Lid remains on cooler base');

const sk = Skeleton.createSkeleton('qtest', 'Q');
const bone = Skeleton.addBone('qtest', 'b');
Skeleton.setBoneQuaternion('qtest', bone.id, { x: 0, y: 0, z: 0, w: 1 });
Skeleton.capturePose('qtest', 0);
const q90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
Skeleton.setBoneQuaternion('qtest', bone.id, { x: q90.x, y: q90.y, z: q90.z, w: q90.w });
Skeleton.capturePose('qtest', 2);

const skMid = Skeleton.evaluate('qtest', 1);
Master.addSkeleton(Skeleton.serialize('qtest'));
const masterMid = Master.evaluate(1);
const mq = masterMid.skeletons.qtest[bone.id].quat;
assert(Math.abs(skMid[bone.id].quat.y - mq.y) < 0.01, 'Skeleton and master slerp agree');

const q170 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 170 * Math.PI / 180);
Skeleton.setBoneQuaternion('qtest', bone.id, { x: q170.x, y: q170.y, z: q170.z, w: q170.w });
Skeleton.capturePose('qtest', 4);
const skNear = Skeleton.evaluate('qtest', 3);
const nlen = Math.hypot(skNear[bone.id].quat.x, skNear[bone.id].quat.y, skNear[bone.id].quat.z, skNear[bone.id].quat.w);
assert(Math.abs(nlen - 1) < 0.001, 'Near-180 normalized in skeleton');

const sk2 = Skeleton.createSkeleton('qtest2', 'Q2');
const b2 = Skeleton.addBone('qtest2', 'b');
Skeleton.setBoneQuaternion('qtest2', b2.id, { x: q90.x, y: q90.y, z: q90.z, w: q90.w });
Skeleton.capturePose('qtest2', 0);
const qNeg = new THREE.Quaternion(-q90.x, -q90.y, -q90.z, -q90.w);
Skeleton.setBoneQuaternion('qtest2', b2.id, { x: qNeg.x, y: qNeg.y, z: qNeg.z, w: qNeg.w });
Skeleton.capturePose('qtest2', 2);
const skOpp = Skeleton.evaluate('qtest2', 1);
const real = new THREE.Quaternion(q90.x, q90.y, q90.z, q90.w).slerp(qNeg, 0.5);
assert(Math.abs(skOpp[b2.id].quat.y - real.y) < 0.02, 'Opposite-sign shortest path');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
