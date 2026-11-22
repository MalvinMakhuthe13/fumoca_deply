/**
 * Pure tests for FumocaMaster evaluation contracts.
 * Run: node tests/anim-master.test.mjs
 */
globalThis.window = globalThis;
globalThis.THREE = {
  Quaternion: class {
    constructor(x=0,y=0,z=0,w=1){ this.x=x;this.y=y;this.z=z;this.w=w; }
    slerpQuaternions(a,b,t){
      this.x = a.x + (b.x-a.x)*t;
      this.y = a.y + (b.y-a.y)*t;
      this.z = a.z + (b.z-a.z)*t;
      this.w = a.w + (b.w-a.w)*t;
    }
  },
  Vector3: class { constructor(x=0,y=0,z=0){ this.x=x;this.y=y;this.z=z; } },
};

const { default: Master } = await import('../js/modules/anim-master.js');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('PASS:', msg);
}

Master.setDuration(4);
Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { pose: { version: 1, position: {x:0,y:0,z:5}, target: {x:0,y:0,z:0}, quaternion: {x:0,y:0,z:0,w:1}, fov: 60, zoom: 1 } } },
  { time_offset: 2, viewport_anchor: { pose: { version: 1, position: {x:2,y:1,z:4}, target: {x:0,y:0,z:0}, quaternion: {x:0,y:0.1,z:0,w:0.99}, fov: 50, zoom: 1.2 } } },
]);
const mid = Master.evaluate(1);
assert(mid.camera && !mid.camera.cssOnly, 'mid-point has camera pose');
assert(mid.camera.position.x > 0 && mid.camera.position.x < 2, 'position interpolates');
assert(mid.camera.fov > 50 && mid.camera.fov < 60, 'fov interpolates');

Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { x: 50, y: 42, wx: 1, wy: 2, wz: 3 } },
  { time_offset: 2, viewport_anchor: { x: 60, y: 40, wx: 1, wy: 2, wz: 3 } },
]);
const leg = Master.evaluate(1);
assert(leg.camera && leg.camera.cssOnly === true, 'legacy returns cssOnly');
assert(!leg.camera.position, 'legacy does not invent camera position');

Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { pose: { version: 1, position: {x:0,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
  { time_offset: 0, viewport_anchor: { pose: { version: 1, position: {x:1,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
  { time_offset: 2, viewport_anchor: { pose: { version: 1, position: {x:2,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
]);
const dup = Master.evaluate(1);
assert(dup.camera && dup.camera.position, 'duplicate timestamps do not crash');

Master.setDuration(10);
Master.evaluate(3.5);
assert(Math.abs(Master.getTime() - 3.5) < 0.01, 'scrub sets time');
Master.pause();
assert(Math.abs(Master.getTime() - 3.5) < 0.01, 'pause keeps time');

Master.addSkeleton({
  id: 'char1',
  bones: [{ id: 'arm', name: 'arm' }],
  poses: [
    { time: 0, bones: [{ id: 'arm', rot: {x:0,y:0,z:0,w:1}, pos: {x:0,y:0,z:0} }] },
    { time: 2, bones: [{ id: 'arm', rot: {x:0,y:0.5,z:0,w:0.86}, pos: {x:0.2,y:0,z:0} }] },
  ],
});
const sk = Master.evaluate(1);
assert(sk.skeletons.char1 && sk.skeletons.char1.arm, 'skeleton evaluates');
assert(sk.skeletons.char1.arm.pos.x > 0 && sk.skeletons.char1.arm.pos.x < 0.2, 'bone position interpolates');

Master.addObject({
  id: 'cooler',
  components: [{ id: 'lid', name: 'lid', type: 'hinge', axis: 'x' }],
  tracks: [
    { time: 0, components: [{ id: 'lid', rot: {x:0,y:0,z:0}, pos: {x:0,y:0,z:0}, state: 'closed' }] },
    { time: 1, components: [{ id: 'lid', rot: {x:90,y:0,z:0}, pos: {x:0,y:0,z:0}, state: 'open' }] },
  ],
});
const obj = Master.evaluate(0.5);
assert(obj.objects.cooler && obj.objects.cooler.lid, 'object evaluates');
assert(obj.objects.cooler.lid.rot.x > 0 && obj.objects.cooler.lid.rot.x < 90, 'hinge angle interpolates');

Master.setInteractions([
  { type: 'grasp', target: 'bottle', time: 1.0, params: { to: 'char1', bone: 'hand' } },
  { type: 'release', target: 'bottle', time: 3.0 },
]);
const ix1 = Master.evaluate(1.5);
assert(ix1.interactions.bottle && ix1.interactions.bottle.attached === true, 'grasp attaches');
const ix2 = Master.evaluate(3.5);
assert(ix2.interactions.bottle && ix2.interactions.bottle.attached === false, 'release detaches');

const ser = Master.serialize();
assert(ser.version === 1 && Array.isArray(ser.camera) && Array.isArray(ser.skeletons), 'serialize has versioned payload');

console.log(process.exitCode ? 'SOME TESTS FAILED' : 'ALL TESTS PASSED');
