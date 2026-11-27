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
Physics.createCollider({ id: 'sq', type: 'box', bodyType: 'static', owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
// Same orientation via Euler 0 again
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
assert(Physics.getStaticMoved('sq') !== true, 'Equivalent orientation does not flag static');

// Kinematic follows
Physics.dispose();
Physics.createCollider({ id: 'k', type: 'box', bodyType: 'kinematic', owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 2, y: 0, z: 0 }, rot: { x: 0, y: 45, z: 0 } } } } });
const kp = Physics.getWorldPose('k');
assert(kp && near(kp.position.x, 2), 'Kinematic follows translation');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Sphere effective radius: overlap that unscaled would miss
Physics.dispose();
Physics.createCollider({ id: 'ss', type: 'sphere', radius: 0.1, scale: { x: 3, y: 3, z: 3 }, owner: { kind: 'component', objectId: 'a', componentId: 'c' } });
Physics.createCollider({ id: 'su', type: 'sphere', radius: 0.1, owner: { kind: 'component', objectId: 'b', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: {
    a: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { c: { pos: { x: 0.35, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().some(h => h.colliderA === 'ss' || h.colliderB === 'ss'), 'Scaled sphere overlaps at 0.35 (unscaled radius 0.1 would not)');
assert(Physics.get('ss').geometry.radius === 0.1, 'Sphere radius unchanged after sync');
Physics.syncFromEvaluation({
  objects: {
    a: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { c: { pos: { x: 0.35, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.get('ss').geometry.radius === 0.1, 'Repeated sphere sync does not compound');

// Capsule effective
Physics.dispose();
Physics.createCollider({ id: 'cs', type: 'capsule', radius: 0.05, height: 0.2, scale: { x: 2, y: 2, z: 2 }, owner: { kind: 'component', objectId: 'a', componentId: 'c' } });
Physics.createCollider({ id: 'cu', type: 'box', halfExtents: { x: 0.05, y: 0.05, z: 0.05 }, owner: { kind: 'component', objectId: 'b', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: {
    a: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { c: { pos: { x: 0.12, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 1, 'Scaled capsule overlaps at 0.12');
assert(Physics.get('cs').geometry.radius === 0.05 && Physics.get('cs').geometry.height === 0.2, 'Capsule dimensions unchanged');

// q/-q equivalence via direct quaternion path
Physics.dispose();
Physics.createCollider({ id: 'qq', type: 'box', bodyType: 'static', owner: { kind: 'bone', skeletonId: 's', boneId: 'b' } });
Physics.syncFromEvaluation({ skeletons: { s: { b: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } } } } });
Physics.syncFromEvaluation({ skeletons: { s: { b: { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: -1 } } } } });
assert(Physics.getStaticMoved('qq') !== true, 'q and -q are equivalent for static');

// Kinematic rotation quaternion
Physics.dispose();
Physics.createCollider({ id: 'kr', type: 'box', bodyType: 'kinematic', owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } } } } });
const kr = Physics.getWorldPose('kr');
assert(kr && Math.abs(kr.quaternion.y) > 0.5, 'Kinematic Y90 produces non-zero quaternion y');

// Unsupported excluded from overlaps
Physics.dispose();
Physics.createCollider({ id: 'ok', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'a', componentId: 'c' } });
Physics.createCollider({ id: 'bad', type: 'sphere', radius: 0.5, scale: { x: 2, y: 1, z: 1 }, owner: { kind: 'component', objectId: 'b', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: {
    a: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Unsupported sphere excluded from overlaps');
assert(Physics.getLastScaleResult('bad')?.ok === false, 'Unsupported shape has rejection result');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
