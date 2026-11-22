/**
 * Dynamic body and fixed-step tests.
 * Reference backend for contract. Rapier path tested when available.
 * Run: node tests/anim-physics-dynamic.test.mjs
 */
globalThis.window = globalThis;
const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

Physics.dispose();
Physics.setBackend('reference');

const dyn = Physics.createCollider({ id: 'dyn', type: 'box', bodyType: 'dynamic', mass: 2, gravityScale: 1, linearDamping: 0.2, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
assert(dyn.bodyType === 'dynamic' && dyn.mass === 2 && dyn.gravityScale === 1, 'Dynamic options stored');
assert(dyn.linearDamping === 0.2, 'Damping stored');

const kin = Physics.createCollider({ id: 'kin', type: 'box', bodyType: 'kinematic', owner: { kind: 'component', objectId: 'o', componentId: 'k' } });
const stat = Physics.createCollider({ id: 'stat', type: 'box', bodyType: 'static', owner: { kind: 'component', objectId: 'o', componentId: 's' } });
assert(kin.bodyType === 'kinematic' && stat.bodyType === 'static', 'Kinematic and static preserved');

// step without rapier is a no-op
const stepResult = Physics.step(1/60);
assert(stepResult.stepped === 0 && stepResult.reason === 'not_rapier', 'No step on reference backend');

// evaluate/sync does not step
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 2, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, k: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, s: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
assert(Physics.getWorldPose('dyn')?.position.y === 2, 'Sync places dynamic initial pose');

// reset
const resetResult = Physics.reset();
assert(resetResult.ok === true && resetResult.simTime === 0, 'Reset clears sim time');

// No duplicate on repeated sync
const before = Physics.list().length;
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 2, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, k: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, s: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
assert(Physics.list().length === before, 'Repeated sync does not duplicate colliders');

// Existing phase 2 still works
Physics.dispose();
Physics.createCollider({ id: 'a', type: 'box', owner: { kind: 'component', objectId: 'a', componentId: 'c' } });
Physics.createCollider({ id: 'b', type: 'box', owner: { kind: 'component', objectId: 'b', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { a: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } }, b: { c: { pos: { x: 0.4, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
assert(Physics.queryOverlaps().length === 1, 'Reference overlap still works');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
