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

// Non-zero pivot stays, offset rotates
const pivotHinge = {
  joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 2, y: 0, z: 0 }, limits: { min: -Math.PI, max: Math.PI } },
  local: { position: { x: 3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
};
const p0 = Eval.evaluate(pivotHinge, 0);
assert(near(p0.local.position.x, 3), 'Offset at zero is 3');
const p90 = Eval.evaluate(pivotHinge, Math.PI / 2);
// Point at x=3 relative to pivot at x=2 is +1 on x. After 90 deg about Y: +1 on z (or -z depending on convention).
assert(near(p90.local.position.x, 2, 1e-4), 'Pivot x stays 2');
assert(near(Math.abs(p90.local.position.z), 1, 1e-4), 'Offset rotates to z=±1');

// Translated and rotated parent, expected world
const parentT = { position: { x: 5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const childT = Eval.evaluate(fixed, 0, parentT);
assert(near(childT.world.position.x, 6), 'Translated parent: world x = 5 + 1');

// Non-axis-aligned prismatic
const diag = { joint: { kind: 'prismatic', axis: { x: 0.6, y: 0.8, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: 2 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
const d = Eval.evaluate(diag, 1);
assert(near(d.local.position.x, 0.6) && near(d.local.position.y, 0.8), 'Non-aligned axis displacement');

// Invalid values
assert(Eval.evaluate(hinge, NaN).reason === 'non_finite_value', 'NaN value rejected');
assert(Eval.evaluate(hinge, Infinity).reason === 'non_finite_value', 'Infinity value rejected');
const zq = { joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 0 } } };
assert(Eval.evaluate(zq, 0).reason === 'zero_quaternion', 'Zero quaternion rejected');
const nq = { joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 2 } } };
assert(Eval.evaluate(nq, 0).reason === 'quaternion_not_normalized', 'Non-normalized quaternion rejected');
const za = { joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
assert(Eval.evaluate(za, 0).reason === 'zero_axis', 'Zero axis rejected');
const ul = { joint: { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 1, max: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };
assert(Eval.evaluate(ul, 0).reason === 'invalid_limits', 'Unordered limits rejected');
const badParent = { position: { x: NaN, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
assert(Eval.evaluate(hinge, 0, badParent).reason === 'invalid_parent_position', 'Malformed parent rejected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
