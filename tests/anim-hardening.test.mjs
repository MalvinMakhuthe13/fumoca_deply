/**
 * Hardening tests: real Three.js quaternion, explicit attachments, loop wrap.
 * Requires: npm install three  (or import from CDN bundle)
 * Run: node tests/anim-hardening.test.mjs
 */
import * as THREE from 'three';

globalThis.window = globalThis;
globalThis.THREE = THREE;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { default: Master } = await import('../js/modules/anim-master.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

function makeQuat(axis, deg) {
  const q = new THREE.Quaternion();
  q.setFromAxisAngle(new THREE.Vector3(...axis), deg * Math.PI / 180);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

const q0 = makeQuat([0,1,0], 0);
const q90 = makeQuat([0,1,0], 90);
const q170 = makeQuat([0,1,0], 170);
const qNeg170 = makeQuat([0,1,0], -170);

Master.addSkeleton({
  id: 's1',
  bones: [{ id: 'b' }],
  poses: [
    { time: 0, bones: [{ id: 'b', quat: q0, pos: {x:0,y:0,z:0} }] },
    { time: 2, bones: [{ id: 'b', quat: q90, pos: {x:0,y:0,z:0} }] },
  ],
});
const mid = Master.evaluate(1);
const mq = mid.skeletons.s1.b.quat;
assert(mq && typeof mq.w === 'number', 'Midpoint has quaternion');
const len = Math.hypot(mq.x, mq.y, mq.z, mq.w);
assert(Math.abs(len - 1) < 0.001, 'Quaternion is normalized');

const ta = new THREE.Quaternion(q0.x, q0.y, q0.z, q0.w);
const tb = new THREE.Quaternion(q90.x, q90.y, q90.z, q90.w);
const expected = ta.clone().slerp(tb, 0.5);
assert(Math.abs(mq.y - expected.y) < 0.01, 'Matches Three.js slerp at 50%');

Master.addSkeleton({
  id: 's2',
  bones: [{ id: 'b' }],
  poses: [
    { time: 0, bones: [{ id: 'b', quat: q0, pos: {x:0,y:0,z:0} }] },
    { time: 2, bones: [{ id: 'b', quat: q170, pos: {x:0,y:0,z:0} }] },
  ],
});
const near180 = Master.evaluate(1);
const nq = near180.skeletons.s2.b.quat;
const nlen = Math.hypot(nq.x, nq.y, nq.z, nq.w);
assert(Math.abs(nlen - 1) < 0.001, 'Near-180 quaternion normalized');

Master.addSkeleton({
  id: 's3',
  bones: [{ id: 'b' }],
  poses: [
    { time: 0, bones: [{ id: 'b', quat: q0, pos: {x:0,y:0,z:0} }] },
    { time: 2, bones: [{ id: 'b', quat: qNeg170, pos: {x:0,y:0,z:0} }] },
  ],
});
const short = Master.evaluate(1);
const sq = short.skeletons.s3.b.quat;
const realA = new THREE.Quaternion(q0.x, q0.y, q0.z, q0.w);
const realB = new THREE.Quaternion(qNeg170.x, qNeg170.y, qNeg170.z, qNeg170.w);
const realMid = realA.clone().slerp(realB, 0.5);
assert(Math.abs(sq.y - realMid.y) < 0.02, 'Shortest path matches Three.js');

function makeNode(name) {
  return {
    name,
    parent: null,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    children: [],
    add(c) { c.parent = this; this.children.push(c); },
    attach(c) { this.add(c); },
  };
}
const world = makeNode('world');
const hand = makeNode('hand');
const lid = makeNode('lid');
const bottleBody = makeNode('bottleBody');
const coolerBase = makeNode('coolerBase');
world.add(bottleBody);
world.add(coolerBase);
coolerBase.add(lid);
bottleBody.position.set(1, 0, 0);

Master.setSkeletonBinding('char', new Map([['hand', hand]]));
Master.setObjectBinding('bottle', new Map([['body', bottleBody], ['cap', makeNode('cap')]]));
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
assert(bottleBody.parent === world, 'Bottle starts on world');
Master.evaluate(1.5);
assert(bottleBody.parent === hand, 'Bottle attaches to specific hand bone');
assert(Math.abs(bottleBody.position.y - 0.1) < 0.01, 'Attachment offset applied');
Master.evaluate(3.5);
assert(bottleBody.parent === world, 'Release restores original parent');
assert(Math.abs(bottleBody.position.x - 1) < 0.01, 'Original position restored');

Master.evaluate(1.5);
assert(lid.parent === coolerBase, 'Lid remains on cooler base (not first component)');

Master.evaluate(1.5);
assert(bottleBody.parent === hand, 'Forward to grasp');
Master.evaluate(0.5);
assert(bottleBody.parent === world, 'Scrub back restores parent');

Master.evaluate(1.5);
Master.evaluate(1.5);
assert(bottleBody.parent === hand, 'Repeated eval stable');

const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
const ctrls = {
  enabled: true,
  target: new THREE.Vector3(0, 0, 0),
  update() {},
};
Master.setCameraBinding(cam, ctrls);
Master.setDuration(4);
Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { pose: { version: 1, position: {x:0,y:0,z:5}, target:{x:0,y:0,z:0}, quaternion: makeQuat([0,1,0], 0), fov:60, zoom:1 } } },
  { time_offset: 2, viewport_anchor: { pose: { version: 1, position: {x:2,y:1,z:4}, target:{x:0,y:0,z:0}, quaternion: makeQuat([0,1,0], 30), fov:50, zoom:1.2 } } },
]);
Master.evaluate(1);
assert(cam.position.x > 0 && cam.position.x < 2, 'Real camera position applied');
assert(Math.abs(cam.fov - 55) < 6, 'Real camera fov applied');
assert(cam.quaternion.length() > 0.99, 'Real camera quaternion normalized');
assert(ctrls.enabled === true, 'Controls re-enabled');

const qBefore = cam.quaternion.clone();
Master.evaluate(1);
assert(cam.quaternion.equals(qBefore), 'Repeated evaluate no snap');

Master.setDuration(10);
Master.setLoopRange(2, 6);
const w = Master.wrapTime(2 + 4*3 + 1);
assert(w >= 2 && w < 6, 'Large delay wraps into range');

Master.evaluate(5);
Master.pause();
assert(Math.abs(Master.getTime() - 5) < 0.01, 'Pause keeps time');
Master.restart();
assert(Master.isPlaying(), 'Restart starts');
Master.pause();

Master.setCameraTrack([]);
const empty = Master.evaluate(1);
assert(empty.camera === null || empty.camera.cssOnly, 'Empty camera track safe');

Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { pose: { version:1, position:{x:0,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:makeQuat([0,1,0],0), fov:60, zoom:1 } } },
  { time_offset: 20, viewport_anchor: { pose: { version:1, position:{x:5,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:makeQuat([0,1,0],0), fov:60, zoom:1 } } },
]);
const outside = Master.evaluate(3);
assert(outside.camera, 'Out-of-range keyframe does not crash');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
