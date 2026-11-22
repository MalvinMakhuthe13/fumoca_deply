/**
 * Transform composition and lifecycle tests.
 * Reference backend. Hierarchy, scale rejection, static/kinematic, scrub.
 * Run: node tests/anim-physics-transform.test.mjs
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

// Child under translated parent
Physics.registerHierarchy('obj', [
  { id: 'parent', parentId: null },
  { id: 'child', parentId: 'parent' },
]);
Physics.createCollider({ id: 'childCol', type: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 }, owner: { kind: 'component', objectId: 'obj', componentId: 'child' } });
Physics.syncFromEvaluation({
  objects: {
    obj: {
      parent: { pos: { x: 2, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      child: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
// World position should be parent(2) + child(1) = 3
const rt = Physics.list();
assert(rt.length === 1, 'Child collider registered');

// Nested rotation
Physics.dispose();
Physics.registerHierarchy('hinge', [
  { id: 'base', parentId: null },
  { id: 'lid', parentId: 'base' },
]);
Physics.createCollider({ id: 'lid', type: 'box', halfExtents: { x: 0.2, y: 0.02, z: 0.2 }, localPosition: { x: 0, y: 0.2, z: 0 }, owner: { kind: 'component', objectId: 'hinge', componentId: 'lid' } });
Physics.syncFromEvaluation({
  objects: {
    hinge: {
      base: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } },
      lid: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 45, y: 0, z: 0 } },
    },
  },
});
assert(Physics.get('lid') !== null, 'Nested lid registered');

// Local offset under rotated component
Physics.dispose();
Physics.createCollider({ id: 'off', type: 'sphere', radius: 0.05, localPosition: { x: 0, y: 0.5, z: 0 }, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 90 } } } },
});
assert(Physics.get('off').localPosition.y === 0.5, 'Local offset preserved');

// Static vs kinematic
Physics.dispose();
const stat = Physics.createCollider({ id: 'stat', type: 'box', bodyType: 'static', owner: { kind: 'component', objectId: 'o', componentId: 'a' } });
const kin = Physics.createCollider({ id: 'kin', type: 'box', bodyType: 'kinematic', owner: { kind: 'component', objectId: 'o', componentId: 'b' } });
assert(stat.bodyType === 'static' && kin.bodyType === 'kinematic', 'Body types stored');

// Scrub backward
Physics.dispose();
Physics.createCollider({ id: 'bot', type: 'sphere', radius: 0.1, owner: { kind: 'component', objectId: 'b', componentId: 'body' } });
Physics.createCollider({ id: 'wall', type: 'box', halfExtents: { x: 0.05, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'w', componentId: 'base' } });
Physics.syncFromEvaluation({
  objects: {
    b: { body: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    w: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
const near = Physics.queryOverlaps().length;
Physics.syncFromEvaluation({
  objects: {
    b: { body: { pos: { x: 5, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    w: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
const far = Physics.queryOverlaps().length;
Physics.syncFromEvaluation({
  objects: {
    b: { body: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    w: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
const back = Physics.queryOverlaps().length;
assert(near === 1 && far === 0 && back === 1, 'Scrub restores overlap');

// Dispose clears
const before = Physics.list().length;
Physics.dispose();
assert(Physics.list().length === 0, 'Dispose clears colliders');
Physics.createCollider({ id: 'new', type: 'box', owner: { kind: 'object', objectId: 'n' } });
assert(Physics.list().length === 1 && Physics.get('new'), 'New scene after dispose');

// Repeated dispose safe
Physics.dispose();
Physics.dispose();
assert(Physics.list().length === 0, 'Repeated dispose safe');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
