/**
 * Scale behavior and static contract tests.
 * Run: node tests/anim-physics-transform.test.mjs
 */
globalThis.window = globalThis;
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-4) { return Math.abs(a - b) < eps; }

Physics.dispose();
Physics.setBackend('reference');

// Box scale changes effective overlap
Physics.createCollider({ id: 'small', type: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 }, owner: { kind: 'component', objectId: 'a', componentId: 'c' } });
Physics.createCollider({ id: 'big', type: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 }, scale: { x: 3, y: 3, z: 3 }, owner: { kind: 'component', objectId: 'b', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: {
    a: { c: { pos: { x: 0.25, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
const hits = Physics.queryOverlaps();
assert(hits.some(h => (h.colliderA === 'big' && h.colliderB === 'small') || (h.colliderA === 'small' && h.colliderB === 'big')), 'Scaled box overlaps unscaled box at 0.25');
assert(Physics.get('big').geometry.halfExtents.x === 0.1, 'Original halfExtents unchanged');

// Repeated sync does not compound
const before = Physics.get('big').geometry.halfExtents.x;
Physics.syncFromEvaluation({
  objects: {
    a: { c: { pos: { x: 0.25, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.get('big').geometry.halfExtents.x === before, 'Repeated sync does not compound scale');

// Sphere uniform scale stored and original unchanged
Physics.dispose();
const sph = Physics.createCollider({ id: 'sph', type: 'sphere', radius: 0.2, scale: { x: 2, y: 2, z: 2 }, owner: { kind: 'object', objectId: 'o' } });
assert(sph.geometry.radius === 0.2 && sph.scale.x === 2, 'Sphere original radius unchanged');

// Capsule uniform scale
const cap = Physics.createCollider({ id: 'cap', type: 'capsule', radius: 0.1, height: 0.4, scale: { x: 1.5, y: 1.5, z: 1.5 }, owner: { kind: 'object', objectId: 'o' } });
assert(cap.geometry.radius === 0.1 && cap.geometry.height === 0.4, 'Capsule original dimensions unchanged');


// Sphere effective radius and repeated sync: the target is outside the
// unscaled radius (0.2 + 0.05) but inside the scaled radius (0.4 + 0.05).
Physics.dispose();
Physics.createCollider({ id: 'sphere_scaled', type: 'sphere', radius: 0.2, scale: { x: 2, y: 2, z: 2 }, owner: { kind: 'component', objectId: 'sphere', componentId: 'body' } });
Physics.createCollider({ id: 'sphere_target', type: 'sphere', radius: 0.05, owner: { kind: 'component', objectId: 'target', componentId: 'body' } });
const sphereEval = { objects: {
  sphere: { body: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  target: { body: { pos: { x: 0.35, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
} };
Physics.syncFromEvaluation(sphereEval);
assert(Physics.queryOverlaps().some(h => [h.colliderA, h.colliderB].includes('sphere_scaled')), 'Scaled sphere effective radius creates overlap beyond unscaled radius');
for (let i = 0; i < 5; i++) Physics.syncFromEvaluation(sphereEval);
assert(Physics.queryOverlaps().some(h => [h.colliderA, h.colliderB].includes('sphere_scaled')), 'Repeated sphere sync preserves effective radius without compounding');
assert(Physics.get('sphere_scaled').geometry.radius === 0.2, 'Sphere source radius remains unchanged after repeated sync');

// Capsule effective radial and axial dimensions, plus repeat stability.
Physics.dispose();
Physics.createCollider({ id: 'capsule_scaled', type: 'capsule', radius: 0.1, height: 0.4, scale: { x: 2, y: 1.5, z: 2 }, owner: { kind: 'component', objectId: 'capsule', componentId: 'body' } });
Physics.createCollider({ id: 'cap_radial_target', type: 'sphere', radius: 0.05, owner: { kind: 'component', objectId: 'radial', componentId: 'body' } });
Physics.createCollider({ id: 'cap_axial_target', type: 'sphere', radius: 0.05, owner: { kind: 'component', objectId: 'axial', componentId: 'body' } });
const capsuleEval = { objects: {
  capsule: { body: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  radial: { body: { pos: { x: 0.22, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  axial: { body: { pos: { x: 0, y: 0.48, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
} };
Physics.syncFromEvaluation(capsuleEval);
let capsuleHits = Physics.queryOverlaps();
assert(capsuleHits.some(h => [h.colliderA, h.colliderB].includes('cap_radial_target')), 'Capsule scaled radius affects radial overlap');
assert(capsuleHits.some(h => [h.colliderA, h.colliderB].includes('cap_axial_target')), 'Capsule scaled height affects axial overlap');
for (let i = 0; i < 5; i++) Physics.syncFromEvaluation(capsuleEval);
capsuleHits = Physics.queryOverlaps();
assert(capsuleHits.some(h => [h.colliderA, h.colliderB].includes('cap_radial_target')) && capsuleHits.some(h => [h.colliderA, h.colliderB].includes('cap_axial_target')), 'Repeated capsule sync preserves effective radius and height');
assert(Physics.get('capsule_scaled').geometry.radius === 0.1 && Physics.get('capsule_scaled').geometry.height === 0.4, 'Capsule source dimensions remain unchanged');

// Unsupported geometry must not silently become a default box in reference mode.
Physics.dispose();
Physics.createCollider({ id: 'unsupported_hull', type: 'convexHull', points: [], owner: { kind: 'component', objectId: 'u', componentId: 'c' } });
Physics.createCollider({ id: 'supported_box', type: 'box', owner: { kind: 'component', objectId: 'b', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: {
  u: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  b: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
} });
assert(!Physics.queryOverlaps().some(h => [h.colliderA, h.colliderB].includes('unsupported_hull')), 'Unsupported shape excluded from reference overlap results');

// Non-uniform sphere rejected
Physics.dispose();
Physics.createCollider({ id: 'ns', type: 'sphere', radius: 0.2, scale: { x: 2, y: 1, z: 1 }, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
const ns = Physics.getLastScaleResult('ns');
assert(ns && ns.ok === false && ns.reason === 'non_uniform_sphere_unsupported', 'Non-uniform sphere rejected');

// Non-uniform capsule rejected
Physics.dispose();
Physics.createCollider({ id: 'nc', type: 'capsule', radius: 0.1, height: 0.4, scale: { x: 2, y: 1, z: 1 }, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
const nc = Physics.getLastScaleResult('nc');
assert(nc && nc.ok === false && nc.reason === 'non_uniform_capsule_unsupported', 'Non-uniform capsule rejected');

// Non-uniform rotated box rejected
Physics.dispose();
Physics.createCollider({ id: 'nb', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, scale: { x: 2, y: 1, z: 1 }, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 45, z: 0 } } } } });
const nb = Physics.getLastScaleResult('nb');
assert(nb && nb.ok === false && nb.reason === 'non_uniform_scale_on_rotated_primitive', 'Non-uniform rotated box rejected');

// Invalid scale falls back to 1
Physics.dispose();
const bad = Physics.createCollider({ id: 'bad', type: 'box', scale: { x: -1, y: 0, z: NaN }, owner: { kind: 'object', objectId: 'o' } });
assert(bad.scale.x === 1 && bad.scale.y === 1 && bad.scale.z === 1, 'Invalid scale falls back to 1');

// Static translation change detected
Physics.dispose();
Physics.createCollider({ id: 'st', type: 'box', bodyType: 'static', owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
assert(Physics.getStaticMoved('st') === true, 'Static translation change detected');

// Static rotation change detected
Physics.dispose();
Physics.createCollider({ id: 'sr', type: 'box', bodyType: 'static', owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } } } } });
assert(Physics.getStaticMoved('sr') === true, 'Static rotation change detected');

// q and -q equivalent: no false move
Physics.dispose();
Physics.createCollider({ id: 'sq', type: 'box', bodyType: 'static', owner: { kind: 'bone', skeletonId: 'sk', boneId: 'bone' } });
Physics.syncFromEvaluation({ skeletons: { sk: { bone: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0.7071067811865475, w: 0.7071067811865476 } } } } });
Physics.syncFromEvaluation({ skeletons: { sk: { bone: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: -0.7071067811865475, w: -0.7071067811865476 } } } } });
assert(Physics.getStaticMoved('sq') !== true, 'Opposite q/-q quaternion values represent equivalent static orientation');

// Kinematic follows
Physics.dispose();
Physics.createCollider({ id: 'k', type: 'box', bodyType: 'kinematic', owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 2, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } } } } });
const kp = Physics.getWorldPose('k');
assert(kp && near(kp.position.x, 2), 'Kinematic follows translation');
assert(kp?.quaternion && near(Math.abs(kp.quaternion.y), Math.SQRT1_2) && near(Math.abs(kp.quaternion.w), Math.SQRT1_2), 'Kinematic follows evaluated rotation quaternion');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
