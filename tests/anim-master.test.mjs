/**
 * Integration tests for FumocaMaster + FumocaSkeleton + FumocaObjectAnim
 * Run: node tests/anim-master.test.mjs
 */
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.window = globalThis;
globalThis.THREE = {
  Quaternion: class {
    constructor(x=0,y=0,z=0,w=1){ this.x=x;this.y=y;this.z=z;this.w=w; }
    set(x,y,z,w){ this.x=x;this.y=y;this.z=z;this.w=w; return this; }
    slerpQuaternions(a,b,t){
      this.x=a.x+(b.x-a.x)*t; this.y=a.y+(b.y-a.y)*t;
      this.z=a.z+(b.z-a.z)*t; this.w=a.w+(b.w-a.w)*t;
    }
  },
  Vector3: class {
    constructor(x=0,y=0,z=0){ this.x=x;this.y=y;this.z=z; }
    set(x,y,z){ this.x=x;this.y=y;this.z=z; return this; }
  },
};

const { default: Skeleton } = await import('../js/modules/anim-skeleton.js');
const { default: ObjectAnim } = await import('../js/modules/anim-object.js');
const { default: Master } = await import('../js/modules/anim-master.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const sk = Skeleton.createSkeleton('char1', 'Test');
const arm = Skeleton.addBone('char1', 'arm');
Skeleton.setBoneEuler('char1', arm.id, { x: 0, y: 45, z: 0 });
assert(arm.localQuat && typeof arm.localQuat.w === 'number', 'Euler sets quaternion');
Skeleton.capturePose('char1', 0);
Skeleton.setBoneEuler('char1', arm.id, { x: 0, y: 90, z: 0 });
Skeleton.capturePose('char1', 2);
const skEval = Skeleton.evaluate('char1', 1);
assert(skEval[arm.id] && skEval[arm.id].quat, 'Skeleton evaluate returns quat');

const skData = Skeleton.serialize('char1');
Master.addSkeleton(skData);
const masterSk = Master.evaluate(1);
assert(masterSk.skeletons.char1 && masterSk.skeletons.char1[arm.id], 'Master evaluates skeleton from FumocaSkeleton');
assert(masterSk.skeletons.char1[arm.id].quat, 'Master returns quaternion');

const obj = ObjectAnim.createObject('cooler', 'Cooler');
const lid = ObjectAnim.addComponent('cooler', 'lid', 'hinge');
ObjectAnim.setComponentTransform('cooler', lid.id, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 'closed');
ObjectAnim.captureKeyframe('cooler', 0);
ObjectAnim.setComponentTransform('cooler', lid.id, { x: 90, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 'open');
ObjectAnim.captureKeyframe('cooler', 1);
const objData = ObjectAnim.serialize('cooler');
Master.addObject(objData);
const masterObj = Master.evaluate(0.5);
assert(masterObj.objects.cooler && masterObj.objects.cooler[lid.id], 'Master evaluates object from FumocaObjectAnim');
assert(masterObj.objects.cooler[lid.id].rot.x > 0 && masterObj.objects.cooler[lid.id].rot.x < 90, 'Hinge interpolates');

const cam = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  fov: 60, zoom: 1,
  updateProjectionMatrix() {},
};
const ctrls = {
  enabled: true,
  target: new THREE.Vector3(),
  update() { this._updated = true; },
};
Master.setCameraBinding(cam, ctrls);
Master.setDuration(4);
Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { pose: { version: 1, position: {x:0,y:0,z:5}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
  { time_offset: 2, viewport_anchor: { pose: { version: 1, position: {x:2,y:1,z:4}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0.2,z:0,w:0.98}, fov:50, zoom:1.2 } } },
]);
Master.evaluate(1);
assert(cam.position.x > 0 && cam.position.x < 2, 'Camera position applied');
assert(cam.quaternion.y > 0, 'Camera quaternion applied');
assert(Math.abs(cam.fov - 55) < 6, 'Camera fov applied');
assert(ctrls.enabled === true, 'Controls re-enabled after apply');

Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { x:50, y:42, wx:1, wy:2, wz:3 } },
  { time_offset: 2, viewport_anchor: { x:60, y:40, wx:1, wy:2, wz:3 } },
]);
const leg = Master.evaluate(1);
assert(leg.camera && leg.camera.cssOnly === true, 'Legacy is cssOnly');

const scene = {
  world: { name: 'world', children: [], add(c){ c.parent=this; this.children.push(c); }, attach(c){ this.add(c); } },
  hand: { name: 'hand', children: [], add(c){ c.parent=this; this.children.push(c); }, attach(c){ this.add(c); } },
};
const bottle = {
  name: 'bottle',
  parent: scene.world,
  position: new THREE.Vector3(1, 0, 0),
  quaternion: new THREE.Quaternion(0,0,0,1),
};
scene.world.children.push(bottle);
Master.setObjectBinding('bottle', new Map([['body', bottle]]));
Master.setSkeletonBinding('char1', new Map([['hand', scene.hand]]));
Master.setInteractions([
  { type: 'grasp', time: 1.0, target: { objectId: 'bottle', componentId: 'body' }, parent: { skeletonId: 'char1', boneId: 'hand' }, offset: {x:0,y:0.1,z:0} },
  { type: 'release', time: 3.0, target: { objectId: 'bottle', componentId: 'body' } },
]);

Master.evaluate(0.5);
assert(bottle.parent === scene.world, 'Before grasp: parent is world');
Master.evaluate(1.5);
assert(bottle.parent === scene.hand, 'During grasp: parent is hand');
assert(Math.abs(bottle.position.y - 0.1) < 0.01, 'Offset applied');
Master.evaluate(3.5);
assert(bottle.parent === scene.world, 'After release: parent restored');
assert(Math.abs(bottle.position.x - 1) < 0.01, 'Original position restored');

Master.evaluate(1.5);
assert(bottle.parent === scene.hand, 'Forward to grasp');
Master.evaluate(0.5);
assert(bottle.parent === scene.world, 'Scrub back restores parent');

Master.evaluate(1.5);
const r1 = Master.evaluate(1.5);
assert(bottle.parent === scene.hand, 'Repeated eval stays attached');
assert(r1.interactions.bottle.attached === true, 'Repeated eval same state');

Master.setDuration(10);
Master.setLoopRange(2, 6);
Master.evaluate(5);
Master.pause();
assert(Math.abs(Master.getTime() - 5) < 0.01, 'Pause keeps time');
Master.restart();
assert(Master.isPlaying(), 'Restart starts playing');
Master.pause();
assert(!Master.isPlaying(), 'Pause stops');

Master.setCameraTrack([
  { time_offset: 0, viewport_anchor: { pose: { version:1, position:{x:0,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
  { time_offset: 0, viewport_anchor: { pose: { version:1, position:{x:1,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
  { time_offset: 2, viewport_anchor: { pose: { version:1, position:{x:2,y:0,z:0}, target:{x:0,y:0,z:0}, quaternion:{x:0,y:0,z:0,w:1}, fov:60, zoom:1 } } },
]);
const dup = Master.evaluate(1);
assert(dup.camera && !dup.camera.cssOnly, 'Duplicate timestamps handled');

const store = { meta: { hotspots: [{id:'h1'}], other: 'keep' } };
window._fumocaSupabase = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { meta: store.meta }, error: null }) }) }),
    update: (payload) => ({ eq: async () => { store.meta = payload.meta; return { error: null }; } }),
  }),
};
const saveRes = await Master.persist('test-id');
assert(saveRes.ok === true, 'Persist succeeds');
assert(store.meta.hotspots && store.meta.hotspots.length === 1, 'Unrelated metadata retained');
assert(store.meta.anim_timeline && store.meta.anim_timeline.version === 1, 'Timeline saved');
assert(store.meta.anim_timeline.revision === 1, 'Revision incremented');

store.meta.anim_timeline.revision = 5;
const conflict = await Master.persist('test-id');
assert(conflict.ok === false && conflict.error.includes('Revision'), 'Revision conflict detected');

window._fumocaSupabase = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }),
  }),
};
const errRes = await Master.persist('test-id');
assert(errRes.ok === false && errRes.error.includes('db down'), 'Supabase error surfaced');

const ser = Master.serialize();
assert(ser.version === 1 && Array.isArray(ser.skeletons) && Array.isArray(ser.objects), 'Serialize complete');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
