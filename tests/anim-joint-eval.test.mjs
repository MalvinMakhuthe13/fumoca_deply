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

assert(Eval.evaluate(hinge).reason === 'non_finite_value', 'Undefined value rejected');
assert(Eval.evaluate(hinge, null).reason === 'non_finite_value', 'Null value rejected');
assert(Eval.evaluate(hinge, '0').reason === 'non_finite_value', 'Numeric string rejected');
assert(Eval.evaluate(fixed, 0).ok === true, 'Explicit zero accepted');

assert(Eval.evaluate(hinge, 0, {}).reason === 'invalid_parent_position', 'Missing parent position rejected');
assert(Eval.evaluate(hinge, 0, { position: { x: 0, y: 0, z: 0 } }).reason === 'invalid_parent_quaternion', 'Missing parent rotation rejected');
assert(Eval.evaluate(hinge, 0, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 0 } }).reason === 'invalid_parent_quaternion', 'Zero parent quaternion rejected');
assert(Eval.evaluate(hinge, 0, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 2 } }).reason === 'invalid_parent_quaternion', 'Non-normalized parent quaternion rejected');

// Translated AND rotated parent: parent at (1,0,0), rotated 90 deg about Y, local (1,0,0)
const y90 = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
const both = Eval.evaluate(fixed, 0, { position: { x: 1, y: 0, z: 0 }, rotation: y90 });
// Local (1,0,0) rotated 90 about Y becomes (0,0,-1) or (0,0,1). Plus parent (1,0,0).
assert(near(both.world.position.x, 1, 1e-4), 'Rotated+translated parent x stays 1');
assert(near(Math.abs(both.world.position.z), 1, 1e-4), 'Rotated+translated parent z is ±1');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Three-level hierarchy. Expectations calculated independently.
// Parent: local (1,0,0), rot 90° Y. Child: local (1,0,0), rot 90° X. Grandchild: local (0,1,0), identity.
const qY90 = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
const qX90 = { x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) };
const parentComp = { joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 1, y: 0, z: 0 }, rotation: qY90 } };
const childComp = { joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 1, y: 0, z: 0 }, rotation: qX90 } };
const grandComp = { joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } };

const parentResult = Eval.evaluate(parentComp, 0);
const childResult = Eval.evaluate(childComp, 0, parentResult.world);
const grandchildResult = Eval.evaluate(grandComp, 0, childResult.world);

assert(near(parentResult.world.position.x, 1) && near(parentResult.world.position.y, 0) && near(parentResult.world.position.z, 0), 'Parent world position (1,0,0)');
assert(near(parentResult.world.rotation.y, qY90.y, 1e-6) && near(parentResult.world.rotation.w, qY90.w, 1e-6), 'Parent world rotation 90° Y');

// R_y(90)*(1,0,0) = (0,0,-1); parent pos (1,0,0) => child world (1,0,-1)
assert(near(childResult.world.position.x, 1, 1e-4) && near(childResult.world.position.y, 0, 1e-4) && near(childResult.world.position.z, -1, 1e-4), 'Child world position (1,0,-1)');
// qY * qX = (0.5, 0.5, -0.5, 0.5)
assert(near(childResult.world.rotation.x, 0.5, 1e-4) && near(childResult.world.rotation.y, 0.5, 1e-4) && near(childResult.world.rotation.z, -0.5, 1e-4) && near(childResult.world.rotation.w, 0.5, 1e-4), 'Child world rotation qY*qX');

// R_child*(0,1,0) = R_y(90)*R_x(90)*(0,1,0) = R_y(90)*(0,0,1) = (1,0,0)
// child world (1,0,-1) + (1,0,0) = (2,0,-1)
assert(near(grandchildResult.world.position.x, 2, 1e-4) && near(grandchildResult.world.position.y, 0, 1e-4) && near(grandchildResult.world.position.z, -1, 1e-4), 'Grandchild world position (2,0,-1)');
assert(near(grandchildResult.world.rotation.x, 0.5, 1e-4) && near(grandchildResult.world.rotation.y, 0.5, 1e-4) && near(grandchildResult.world.rotation.z, -0.5, 1e-4) && near(grandchildResult.world.rotation.w, 0.5, 1e-4), 'Grandchild world rotation equals child');

const again = Eval.evaluate(grandComp, 0, Eval.evaluate(childComp, 0, Eval.evaluate(parentComp, 0).world).world);
assert(near(again.world.position.x, grandchildResult.world.position.x) && near(again.world.rotation.w, grandchildResult.world.rotation.w), 'Repeated hierarchy evaluation identical');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
