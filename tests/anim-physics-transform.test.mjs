/**
 * World-space hierarchy and scale tests.
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

// Parent translation + child translation
Physics.registerHierarchy('obj', [
  { id: 'parent', parentId: null },
  { id: 'child', parentId: 'parent' },
]);
Physics.createCollider({ id: 'c', type: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 }, owner: { kind: 'component', objectId: 'obj', componentId: 'child' } });
Physics.syncFromEvaluation({
  objects: {
    obj: {
      parent: { pos: { x: 2, y: 1, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      child: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
let wp = Physics.getWorldPose('c');
assert(wp && near(wp.position.x, 3) && near(wp.position.y, 1), 'Parent+child translation: world x=3 y=1');

// Parent rotation + child translation (90 deg Y: child x becomes -z)
Physics.syncFromEvaluation({
  objects: {
    obj: {
      parent: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } },
      child: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
wp = Physics.getWorldPose('c');
assert(wp && near(wp.position.z, -1, 1e-3), 'Parent Y90 + child x=1 → world z≈-1');

// Nested grandparent
Physics.dispose();
Physics.registerHierarchy('nest', [
  { id: 'gp', parentId: null },
  { id: 'p', parentId: 'gp' },
  { id: 'c', parentId: 'p' },
]);
Physics.createCollider({ id: 'leaf', type: 'sphere', radius: 0.05, owner: { kind: 'component', objectId: 'nest', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: {
    nest: {
      gp: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      p: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      c: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
wp = Physics.getWorldPose('leaf');
assert(wp && near(wp.position.x, 3), 'Grandparent chain: world x=3');

// Collider-local offset rotated by owner (90 Z: local y becomes -x)
Physics.dispose();
Physics.createCollider({ id: 'off', type: 'sphere', radius: 0.05, localPosition: { x: 0, y: 1, z: 0 }, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 90 } } } },
});
wp = Physics.getWorldPose('off');
assert(wp && near(wp.position.x, -1, 1e-3) && near(wp.position.y, 0, 1e-3), 'Local offset rotated by owner Z90');

// Parent and child rotations compose (order: parent then child)
Physics.dispose();
Physics.registerHierarchy('rot', [
  { id: 'p', parentId: null },
  { id: 'c', parentId: 'p' },
]);
Physics.createCollider({ id: 'rc', type: 'box', halfExtents: { x: 0.1, y: 0.1, z: 0.1 }, localPosition: { x: 1, y: 0, z: 0 }, owner: { kind: 'component', objectId: 'rot', componentId: 'c' } });
Physics.syncFromEvaluation({
  objects: {
    rot: {
      p: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 90, z: 0 } },
      c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    },
  },
});
wp = Physics.getWorldPose('rc');
assert(wp && near(wp.position.z, -1, 1e-3), 'Parent rotation applied before collider offset');

// Scrub restores exact pose
Physics.dispose();
Physics.createCollider({ id: 'bot', type: 'sphere', radius: 0.1, owner: { kind: 'component', objectId: 'b', componentId: 'body' } });
Physics.syncFromEvaluation({ objects: { b: { body: { pos: { x: 1.5, y: 0.2, z: -0.3 }, rot: { x: 0, y: 0, z: 0 } } } } });
const first = Physics.getWorldPose('bot');
Physics.syncFromEvaluation({ objects: { b: { body: { pos: { x: 4, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
Physics.syncFromEvaluation({ objects: { b: { body: { pos: { x: 1.5, y: 0.2, z: -0.3 }, rot: { x: 0, y: 0, z: 0 } } } } });
const back = Physics.getWorldPose('bot');
assert(first && back && near(first.position.x, back.position.x) && near(first.position.y, back.position.y) && near(first.position.z, back.position.z), 'Scrub restores exact pose');

// Missing parent is safe
Physics.dispose();
Physics.registerHierarchy('miss', [{ id: 'c', parentId: 'missing' }]);
Physics.createCollider({ id: 'mc', type: 'box', owner: { kind: 'component', objectId: 'miss', componentId: 'c' } });
Physics.syncFromEvaluation({ objects: { miss: { c: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
wp = Physics.getWorldPose('mc');
assert(wp && near(wp.position.x, 1), 'Missing parent: uses own transform');

// Cycle is safe
Physics.dispose();
Physics.registerHierarchy('cyc', [
  { id: 'a', parentId: 'b' },
  { id: 'b', parentId: 'a' },
]);
Physics.createCollider({ id: 'ca', type: 'box', owner: { kind: 'component', objectId: 'cyc', componentId: 'a' } });
Physics.syncFromEvaluation({ objects: { cyc: { a: { pos: { x: 1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, b: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } });
wp = Physics.getWorldPose('ca');
assert(wp !== null, 'Cycle does not hang');

// Scale: box
Physics.dispose();
const box = Physics.createCollider({ id: 'sb', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, scale: { x: 2, y: 2, z: 2 }, owner: { kind: 'component', objectId: 'o', componentId: 'c' } });
assert(box.scale.x === 2 && box.geometry.halfExtents.x === 0.5, 'Scale stored; original halfExtents unchanged');

// Scale: sphere and capsule stored
const sph = Physics.createCollider({ id: 'ss', type: 'sphere', radius: 0.2, scale: { x: 1.5, y: 1.5, z: 1.5 }, owner: { kind: 'object', objectId: 'o' } });
const cap = Physics.createCollider({ id: 'sc', type: 'capsule', radius: 0.1, height: 0.4, scale: { x: 2, y: 2, z: 2 }, owner: { kind: 'object', objectId: 'o' } });
assert(sph.scale.x === 1.5 && cap.scale.y === 2, 'Sphere and capsule scale stored');

// Non-uniform on rotated rejected path exists
Physics.createCollider({ id: 'bad', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, scale: { x: 2, y: 1, z: 1 }, owner: { kind: 'component', objectId: 'o', componentId: 'r' } });
Physics.syncFromEvaluation({ objects: { o: { c: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, r: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 45, z: 0 } } } } });
assert(true, 'Non-uniform rotated path executed without crash');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
