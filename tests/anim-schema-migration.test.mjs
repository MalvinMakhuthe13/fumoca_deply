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

// No double migration: direct limit comparison
const once = Objects.deserialize({ id: 'once', components: [{ id: 'h', type: 'hinge', joint: { kind: 'hinge', limits: { min: -90, max: 90 }, axis: { x: 1, y: 0, z: 0 } } }] });
const onceMax = once.components[0].joint.limits.max;
const twice = Objects.deserialize(once);
assert(Math.abs(twice.components[0].joint.limits.max - onceMax) < 1e-9, 'Re-deserialize does not convert again');
assert(Math.abs(onceMax - Math.PI / 2) < 0.01, 'First conversion is pi/2');

// Zero preserved
const zc = { id: 'zeros', components: [{ id: 'z', pos: { x: 0, y: 0, z: 0 }, joint: { kind: 'prismatic', limits: { min: 0, max: 0 }, axis: { x: 0, y: 1, z: 0 } } }] };
const zm = Objects.deserialize(zc);
assert(zm.components[0].local.position.x === 0 && zm.components[0].joint.limits.max === 0, 'Zero coordinates and limits preserved');

// Invalid defineJoint leaves previous joint
Objects.createObject('keep', 'Keep');
const kc = Objects.addComponent('keep', 'K', 'fixed');
const prev = JSON.stringify(kc.joint);
const bad = Objects.defineJoint('keep', kc.id, { kind: 'hinge', axis: { x: 0, y: 0, z: 0 } });
assert(bad.ok === false && JSON.stringify(kc.joint) === prev, 'Invalid defineJoint leaves previous joint');

// Invalid quaternion cannot become identity
const badq = Objects.deserialize({ id: 'badq', components: [{ id: 'q', rotation: { x: NaN, y: 0, z: 0, w: 1 }, joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 } } }] });
assert(badq._migrationWarnings.some(w => w.reason === 'invalid_quaternion'), 'NaN quaternion reported, not repaired');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Invalid rest/seat preserves original
const badRest = { id: 'br', components: [{ id: 'c', pos: { x: 1, y: 0, z: 0 }, joint: { kind: 'fixed', axis: { x: 1, y: 0, z: 0 }, rest: { position: { x: NaN, y: 0, z: 0 } } } }] };
const brm = Objects.deserialize(badRest);
assert(brm.components[0].version !== 1 || brm._migrationWarnings.some(w => w.field === 'rest'), 'Invalid rest preserved with warning');
assert(brm.components[0].pos?.x === 1 || brm.components[0].local?.position?.x === 1, 'Original position kept');

const badSeat = { id: 'bs', components: [{ id: 'c', joint: { kind: 'lift', axis: { x: 0, y: 1, z: 0 }, seat: { rotation: { x: 0, y: 0, z: 0, w: 0 } } } }] };
const bsm = Objects.deserialize(badSeat);
assert(bsm._migrationWarnings.some(w => w.field === 'seat' && w.reason === 'zero_quaternion'), 'Invalid seat quaternion warned');

// Valid rest/seat migrate
const good = { id: 'good', components: [{ id: 'c', joint: { kind: 'lift', axis: { x: 0, y: 1, z: 0 }, rest: { pos: { x: 0, y: 0.1, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, seat: { pos: { x: 0, y: 0.12, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } }] };
const gm = Objects.deserialize(good);
assert(gm.components[0].joint.rest.position.y === 0.1, 'Valid rest migrated');
assert(gm.components[0].joint.seat.position.y === 0.12, 'Valid seat migrated');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Direct radians
Objects.createObject('rad', 'Rad');
const h = Objects.addComponent('rad', 'H', 'hinge');
Objects.defineJoint('rad', h.id, { kind: 'hinge', limits: { min: 0, max: Math.PI / 2 } });
assert(Math.abs(h.joint.limits.max - Math.PI / 2) < 1e-9, 'Direct hinge limit stored as pi/2');
const th = Objects.addComponent('rad', 'T', 'threaded');
Objects.defineJoint('rad', th.id, { kind: 'threaded', limits: { min: -Math.PI, max: Math.PI } });
assert(Math.abs(th.joint.limits.max - Math.PI) < 1e-9, 'Threaded limit stored as pi');

// Rest/seat quaternion validation
Objects.createObject('rs', 'RS');
const rc = Objects.addComponent('rs', 'R', 'fixed');
rc.joint.rest = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
assert(Objects.validateObject('rs').ok === true, 'Valid rest quaternion accepted');
rc.joint.rest.rotation = { x: 0, y: 0, z: 0, w: 0 };
assert(Objects.validateObject('rs').errors.some(e => e.reason === 'invalid_rest'), 'Zero rest quaternion rejected');
rc.joint.rest.rotation = { x: 0, y: 0, z: 0, w: 1 };
rc.joint.seat = { position: { x: 0, y: 0.1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
assert(Objects.validateObject('rs').ok === true, 'Valid seat quaternion accepted');
rc.joint.seat.rotation = { x: NaN, y: 0, z: 0, w: 1 };
assert(Objects.validateObject('rs').errors.some(e => e.reason === 'invalid_seat'), 'NaN seat quaternion rejected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
