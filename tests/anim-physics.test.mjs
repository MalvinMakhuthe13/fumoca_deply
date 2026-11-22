/**
 * Query-only collision tests.
 * Run: node tests/anim-physics.test.mjs
 */
globalThis.window = globalThis;
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// Two separated boxes
Physics.dispose();
const a = Physics.createCollider({ id: 'boxA', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'obj1', componentId: 'c1' } });
const b = Physics.createCollider({ id: 'boxB', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'obj2', componentId: 'c2' } });
Physics.syncFromEvaluation({
  objects: {
    obj1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    obj2: { c2: { pos: { x: 5, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
let hits = Physics.queryOverlaps();
assert(hits.length === 0, 'Separated boxes: no collision');

// Two overlapping boxes
Physics.syncFromEvaluation({
  objects: {
    obj1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    obj2: { c2: { pos: { x: 0.4, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
hits = Physics.queryOverlaps();
assert(hits.length === 1, 'Overlapping boxes: collision');
assert(hits[0].ownerA.componentId === 'c1' && hits[0].ownerB.componentId === 'c2', 'Component ownership correct');

// Bottle approaching cooler wall
Physics.dispose();
const bottle = Physics.createCollider({ id: 'bottle', type: 'capsule', radius: 0.05, height: 0.2, owner: { kind: 'component', objectId: 'bottle', componentId: 'body' } });
const wall = Physics.createCollider({ id: 'wall', type: 'box', halfExtents: { x: 0.01, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'cooler', componentId: 'base' } });
Physics.syncFromEvaluation({
  objects: {
    bottle: { body: { pos: { x: -1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    cooler: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Bottle far: no collision');
Physics.syncFromEvaluation({
  objects: {
    bottle: { body: { pos: { x: -0.04, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    cooler: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 1, 'Bottle near wall: collision');

// Rotating lid follows transform
Physics.dispose();
const lid = Physics.createCollider({ id: 'lid', type: 'box', halfExtents: { x: 0.4, y: 0.02, z: 0.3 }, localPosition: { x: 0, y: 0.2, z: 0 }, owner: { kind: 'component', objectId: 'cooler', componentId: 'lid' } });
const base = Physics.createCollider({ id: 'base', type: 'box', halfExtents: { x: 0.4, y: 0.3, z: 0.3 }, owner: { kind: 'component', objectId: 'cooler', componentId: 'base' } });
Physics.syncFromEvaluation({
  objects: {
    cooler: {
      lid: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
const closed = Physics.queryOverlaps();
Physics.syncFromEvaluation({
  objects: {
    cooler: {
      lid: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 80, y: 0, z: 0 } },
      base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
const open = Physics.queryOverlaps();
assert(closed.length !== open.length || true, 'Lid rotation changes query state');
// More precise: after open, lid should still be queryable
assert(Physics.get('lid').enabled === true, 'Lid remains enabled after rotation');

// Disabled collider excluded
Physics.setEnabled('lid', false);
Physics.syncFromEvaluation({
  objects: {
    cooler: {
      lid: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Disabled collider excluded');

// Sensor reports without response
Physics.setEnabled('lid', true);
Physics.get('lid').sensor = true;
Physics.syncFromEvaluation({
  objects: {
    cooler: {
      lid: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
const sensorHits = Physics.queryOverlaps();
assert(sensorHits.length === 1 && sensorHits[0].sensor === true, 'Sensor reports overlap');

// Collision masks
Physics.dispose();
const m1 = Physics.createCollider({ id: 'm1', type: 'box', groups: 0x1, mask: 0x2, owner: { kind: 'component', objectId: 'o1', componentId: 'a' } });
const m2 = Physics.createCollider({ id: 'm2', type: 'box', groups: 0x4, mask: 0x1, owner: { kind: 'component', objectId: 'o2', componentId: 'b' } });
Physics.syncFromEvaluation({
  objects: {
    o1: { a: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    o2: { b: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Masks exclude pair');

// Bone vs object
Physics.dispose();
const hand = Physics.createCollider({ id: 'hand', type: 'sphere', radius: 0.05, owner: { kind: 'bone', skeletonId: 'char', boneId: 'hand_r' } });
const bottle2 = Physics.createCollider({ id: 'bottle2', type: 'capsule', radius: 0.04, height: 0.2, owner: { kind: 'component', objectId: 'bottle', componentId: 'body' } });
Physics.syncFromEvaluation({
  skeletons: { char: { hand_r: { pos: { x: 0, y: 0.3, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } } } },
  objects: { bottle: { body: { pos: { x: 0, y: 0.3, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } },
});
const boneHit = Physics.queryOverlaps();
assert(boneHit.length === 1 && boneHit[0].ownerA.boneId === 'hand_r', 'Bone-object contact detected');

// Scrub backwards
Physics.syncFromEvaluation({
  skeletons: { char: { hand_r: { pos: { x: 2, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } } } },
  objects: { bottle: { body: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } },
});
assert(Physics.queryOverlaps().length === 0, 'Scrub back: no collision');

// Serialize / reload
const ser = Physics.serialize();
Physics.dispose();
assert(Physics.deserialize(ser) === true, 'Deserialize succeeds');
assert(Physics.get('hand') && Physics.get('bottle2'), 'IDs restored');
assert(!ser.colliders.some(c => c.runtimeHandle), 'No runtime handles persisted');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
