/**
 * Pure mechanical evaluator tests.
 * Run: node tests/anim-joint-eval.test.mjs
 */
globalThis.window = globalThis;
const { default: Eval } = await import('../js/modules/anim-joint-eval.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

const fixed = { joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
const fr = Eval.evaluate(fixed, 5);
assert(fr.ok && near(fr.local.position.x, 1), 'Fixed preserves position');

const hinge = { joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: Math.PI / 2 } }, local: { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
const h0 = Eval.evaluate(hinge, 0);
assert(near(h0.local.position.x, 1) && near(h0.local.position.z, 0), 'Hinge at zero');
const h90 = Eval.evaluate(hinge, Math.PI / 2);
assert(near(h90.local.position.z, 1, 1e-4) || near(h90.local.position.z, -1, 1e-4), 'Hinge at pi/2 rotates');
const hMax = Eval.evaluate(hinge, Math.PI);
assert(hMax.value === Math.PI / 2, 'Hinge clamps to max');
const hMin = Eval.evaluate(hinge, -1);
assert(hMin.value === 0, 'Hinge clamps to min');

const slide = { joint: { kind: 'prismatic', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: 0.4 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
assert(near(Eval.evaluate(slide, 0.2).local.position.x, 0.2), 'Prismatic positive');
assert(Eval.evaluate(slide, 1).value === 0.4, 'Prismatic clamps max');
assert(Eval.evaluate(slide, -1).value === 0, 'Prismatic clamps min');

const lift = { joint: { kind: 'lift', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: 0.4 } }, local: { position: { x: 0, y: 0.12, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
assert(near(Eval.evaluate(lift, 0.2).local.position.y, 0.32), 'Lift along axis');
assert(Eval.evaluate(lift, 1).value === 0.4, 'Lift clamps');

// Pivot invariance: point at pivot stays
const hinged = { joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: -Math.PI, max: Math.PI } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
const pv = Eval.evaluate(hinged, Math.PI / 3);
assert(near(pv.local.position.x, 0) && near(pv.local.position.y, 0) && near(pv.local.position.z, 0), 'Pivot stays stationary');

// Rotated parent
const parent = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) } };
const child = Eval.evaluate(hinge, 0, parent);
assert(child.ok && child.world, 'Rotated parent produces world');

// Nested: parent result feeds child
const parentEval = Eval.evaluate(fixed, 0);
const nested = Eval.evaluate(hinge, 0, parentEval.world);
assert(nested.ok, 'Nested hierarchy evaluates');

// Deterministic
const a = Eval.evaluate(hinge, 0.5);
const b = Eval.evaluate(hinge, 0.5);
assert(JSON.stringify(a) === JSON.stringify(b), 'Deterministic');

// Unsupported
assert(Eval.evaluate({ joint: { kind: 'threaded' } }, 0).reason === 'unsupported_joint', 'Threaded unsupported');
assert(Eval.evaluate({ joint: { kind: 'snap' } }, 0).reason === 'unsupported_joint', 'Snap unsupported');

// Invalid does not mutate
const bad = { joint: null };
const before = JSON.stringify(bad);
assert(Eval.evaluate(bad, 0).ok === false, 'Invalid returns error');
assert(JSON.stringify(bad) === before, 'Input not mutated');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
