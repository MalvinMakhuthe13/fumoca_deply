/**
 * Schema migration and validation.
 * Run: node tests/anim-schema-migration.test.mjs
 */
globalThis.window = globalThis;
const { default: Objects } = await import('../js/modules/anim-object.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

// Legacy Euler migration
const legacy = {
  id: 'old',
  components: [{
    id: 'lid',
    parentId: null,
    type: 'hinge',
    pos: { x: 0, y: 0.12, z: 0 },
    rot: { x: 90, y: 0, z: 0 },
    joint: { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, limits: { min: 0, max: 90 }, rest: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  }],
};
const migrated = Objects.deserialize(legacy);
const lid = migrated.components[0];
assert(lid.version === 1, 'Migrated to version 1');
assert(lid.local.position.y === 0.12, 'Position preserved');
assert(Math.abs(lid.local.rotation.x - Math.sin(Math.PI / 4)) < 0.05, 'Euler 90 converted to quaternion');
assert(Math.abs(lid.joint.limits.max - Math.PI / 2) < 0.01, 'Limits converted to radians');
assert(migrated._migrationWarnings.some(w => w.reason === 'limits_converted_from_degrees'), 'Warning recorded');

// No double migration
const again = Objects.deserialize(migrated);
assert(again.components[0].version === 1, 'Versioned data not re-migrated');
assert(Math.abs(again.joint?.limits?.max || again.components[0].joint.limits.max - Math.PI / 2) < 0.01, 'Limits not doubled');

// Round trip
const saved = Objects.serialize('old');
assert(saved.components[0].local.rotation.w !== undefined, 'Serialize keeps quaternion');

// Validation
Objects.createObject('bad', 'Bad');
Objects.addComponent('bad', 'A', 'fixed');
const a = Objects.get('bad').components[0];
a.joint.axis = { x: 0, y: 0, z: 0 };
const v = Objects.validateObject('bad');
assert(v.ok === false && v.errors.some(e => e.reason === 'zero_axis'), 'Zero axis rejected');

a.joint.axis = { x: 2, y: 0, z: 0 };
const v2 = Objects.validateObject('bad');
assert(v2.errors.some(e => e.reason === 'axis_not_normalized'), 'Non-unit axis rejected');

a.joint.axis = { x: 1, y: 0, z: 0 };
a.joint.limits = { min: 1, max: 0 };
const v3 = Objects.validateObject('bad');
assert(v3.errors.some(e => e.reason === 'limits_unordered'), 'Unordered limits rejected');

// Cycle
Objects.createObject('cyc', 'Cycle');
const c1 = Objects.addComponent('cyc', 'A', 'fixed');
const c2 = Objects.addComponent('cyc', 'B', 'fixed', c1.id);
c1.parentId = c2.id;
const vc = Objects.validateObject('cyc');
assert(vc.errors.some(e => e.reason === 'parent_cycle'), 'Cycle rejected');

// Missing parent
Objects.createObject('miss', 'Missing');
const m = Objects.addComponent('miss', 'Child', 'fixed', 'nope');
const vm = Objects.validateObject('miss');
assert(vm.errors.some(e => e.reason === 'unknown_parent'), 'Missing parent rejected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Per-kind defaults
const obj = Objects.createObject('defs', 'Defaults');
for (const kind of ['fixed', 'hinge', 'prismatic', 'free', 'lift', 'threaded', 'snap']) {
  const c = Objects.addComponent('defs', kind, kind);
  Objects.defineJoint('defs', c.id, { kind });
  const lim = c.joint.limits;
  if (kind === 'fixed' || kind === 'free' || kind === 'snap') {
    assert(lim === null, kind + ' has no default limits');
  } else if (kind === 'hinge' || kind === 'threaded') {
    assert(lim && Math.abs(lim.max - Math.PI) < 0.01, kind + ' angular defaults');
  } else {
    assert(lim && lim.max === 1 && lim.min === 0, kind + ' linear defaults');
  }
}

// Explicit zero preserved
const z = Objects.addComponent('defs', 'zero', 'prismatic');
Objects.defineJoint('defs', z.id, { kind: 'prismatic', limits: { min: 0, max: 0 } });
assert(z.joint.limits.min === 0 && z.joint.limits.max === 0, 'Explicit zero limits preserved');

// type preserved
const t = Objects.addComponent('defs', 'typed', 'transform');
const before = t.type;
Objects.defineJoint('defs', t.id, { kind: 'hinge' });
assert(t.type === before, 'defineJoint does not overwrite type');

// Negative angular bound
const neg = {
  id: 'neg',
  components: [{ id: 'h', type: 'hinge', joint: { kind: 'hinge', limits: { min: -90, max: 45 }, axis: { x: 1, y: 0, z: 0 } } }],
};
const nm = Objects.deserialize(neg);
assert(Math.abs(nm.components[0].joint.limits.min + Math.PI / 2) < 0.01, 'Negative bound converted');
assert(Math.abs(nm.components[0].joint.limits.max - Math.PI / 4) < 0.01, 'Positive bound converted');

// Unknown fields survive
const unk = { id: 'unk', components: [{ id: 'u', extra: { keep: true }, joint: { kind: 'fixed', axis: { x: 0, y: 1, z: 0 } } }] };
const um = Objects.deserialize(unk);
assert(um.components[0].extra?.keep === true, 'Unknown fields survive');

// Invalid quaternion
Objects.createObject('qbad', 'Q');
const qb = Objects.addComponent('qbad', 'B', 'fixed');
qb.local.rotation = { x: 0, y: 0, z: 0, w: 0 };
assert(Objects.validateObject('qbad').errors.some(e => e.reason === 'zero_quaternion'), 'Zero quaternion rejected');
qb.local.rotation = { x: 2, y: 0, z: 0, w: 0 };
assert(Objects.validateObject('qbad').errors.some(e => e.reason === 'quaternion_not_normalized'), 'Non-normalized quaternion rejected');

// Invalid pivot
qb.local.rotation = { x: 0, y: 0, z: 0, w: 1 };
qb.joint.pivot = { x: NaN, y: 0, z: 0 };
assert(Objects.validateObject('qbad').errors.some(e => e.reason === 'invalid_pivot'), 'Invalid pivot rejected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
