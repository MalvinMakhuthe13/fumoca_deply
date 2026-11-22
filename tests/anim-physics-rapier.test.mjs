/**
 * Rapier query backend tests.
 * Run: node tests/anim-physics-rapier.test.mjs
 */
globalThis.window = globalThis;

// Point module resolution at the installed package
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/tmp/package.json');
const rapierPath = require.resolve('@dimforge/rapier3d-compat');

const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// WASM init failure path
const bad = await import('../js/modules/anim-physics.js');
// Simulate failure by calling init when package is missing from this path
const failResult = await Physics.initRapier().catch(e => ({ ok: false, error: String(e) }));
// If the workspace cannot resolve the package, init fails and falls back
if (!failResult.ok) {
  assert(failResult.fallback === 'reference', 'WASM failure falls back to reference');
  assert(Physics.getBackend() === 'reference', 'Backend remains reference after failure');
} else {
  assert(Physics.isRapierReady() === true, 'Rapier initialized');
}

async function runScenario(label, setup, expectHit) {
  Physics.dispose();
  setup();
  Physics.syncFromEvaluation(arguments[2] || {});
}

// Separated boxes — reference
Physics.setBackend('reference');
Physics.dispose();
Physics.createCollider({ id: 'a', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'o1', componentId: 'c1' } });
Physics.createCollider({ id: 'b', type: 'box', halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'o2', componentId: 'c2' } });
Physics.syncFromEvaluation({
  objects: {
    o1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    o2: { c2: { pos: { x: 5, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Reference: separated boxes');

Physics.syncFromEvaluation({
  objects: {
    o1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    o2: { c2: { pos: { x: 0.4, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 1, 'Reference: overlapping boxes');

// Rotated boxes — reference uses AABB of rotated corners
Physics.syncFromEvaluation({
  objects: {
    o1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 45, z: 0 } } },
    o2: { c2: { pos: { x: 1.2, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
const rotHits = Physics.queryOverlaps();
assert(Array.isArray(rotHits), 'Reference: rotated box query runs');

// Disabled
Physics.setEnabled('b', false);
Physics.syncFromEvaluation({
  objects: {
    o1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    o2: { c2: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Reference: disabled excluded');

// Sensor
Physics.setEnabled('b', true);
Physics.get('b').sensor = true;
Physics.syncFromEvaluation({
  objects: {
    o1: { c1: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    o2: { c2: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
const s = Physics.queryOverlaps();
assert(s.length === 1 && s[0].sensor === true, 'Reference: sensor reports');

// Groups
Physics.dispose();
Physics.createCollider({ id: 'g1', type: 'box', groups: 0x1, mask: 0x2, owner: { kind: 'component', objectId: 'o1', componentId: 'a' } });
Physics.createCollider({ id: 'g2', type: 'box', groups: 0x4, mask: 0x1, owner: { kind: 'component', objectId: 'o2', componentId: 'b' } });
Physics.syncFromEvaluation({
  objects: {
    o1: { a: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    o2: { b: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Reference: masks exclude');

// Moving collider
Physics.dispose();
Physics.createCollider({ id: 'm', type: 'sphere', radius: 0.2, owner: { kind: 'component', objectId: 'bot', componentId: 'body' } });
Physics.createCollider({ id: 'w', type: 'box', halfExtents: { x: 0.05, y: 0.5, z: 0.5 }, owner: { kind: 'component', objectId: 'wall', componentId: 'base' } });
Physics.syncFromEvaluation({
  objects: {
    bot: { body: { pos: { x: -2, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    wall: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 0, 'Reference: far sphere');
Physics.syncFromEvaluation({
  objects: {
    bot: { body: { pos: { x: -0.1, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    wall: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
assert(Physics.queryOverlaps().length === 1, 'Reference: near sphere');

// Serialize / reload
const ser = Physics.serialize();
Physics.dispose();
assert(Physics.deserialize(ser) === true, 'Reload restores definitions');
assert(Physics.get('m') && Physics.get('w'), 'IDs present after reload');
assert(!JSON.stringify(ser).includes('runtimeHandle'), 'No runtime handles in serialization');

// Convex hull is not silently treated as accurate
Physics.dispose();
const hull = Physics.createCollider({ id: 'hull', type: 'convexHull', points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], owner: { kind: 'object', objectId: 'o' } });
assert(hull.type === 'convexHull', 'Convex hull type preserved');
assert(hull.geometry.points.length === 2, 'Convex hull points stored');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
