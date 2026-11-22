/**
 * Articulated pot: seated lid, lift, reseat.
 * Run: node tests/anim-articulated-pot.test.mjs
 */
globalThis.window = globalThis;
const { default: Objects } = await import('../js/modules/anim-object.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const pot = Objects.createObject('pot', 'Cooking Pot');
const body = Objects.addComponent('pot', 'Body', 'fixed');
const lid = Objects.addComponent('pot', 'Lid', 'lift', body.id);

const seat = Objects.defineJoint('pot', lid.id, {
  kind: 'lift',
  pivot: { x: 0, y: 0.12, z: 0 },
  axis: { x: 0, y: 1, z: 0 },
  limits: { min: 0, max: 0.4 },
  rest: { pos: { x: 0, y: 0.12, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
  seat: { pos: { x: 0, y: 0.12, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
});
assert(seat.ok === true, 'Lid joint defined');
assert(lid.joint.kind === 'lift', 'Lid is lift joint');

Objects.seatComponent('pot', lid.id);
assert(lid.state === 'seated' && lid.pos.y === 0.12, 'Lid seated on rim');

Objects.setComponentTransform('pot', lid.id, { x: 0, y: 0, z: 0 }, { x: 0, y: 0.3, z: 0 }, 'lifted');
assert(lid.pos.y === 0.3 && lid.state === 'lifted', 'Lid lifted');

Objects.setComponentTransform('pot', lid.id, { x: 0, y: 15, z: 0 }, { x: 0.2, y: 0.2, z: 0 }, 'held');
assert(lid.pos.x === 0.2, 'Lid moved aside');

Objects.seatComponent('pot', lid.id);
assert(lid.pos.y === 0.12 && lid.state === 'seated', 'Lid reseated');

const saved = Objects.serialize('pot');
assert(saved.components.find(c => c.id === lid.id).joint.kind === 'lift', 'Joint survives serialize');

Objects.createObject('cooler', 'Cooler');
const base = Objects.addComponent('cooler', 'Base', 'fixed');
const coolerLid = Objects.addComponent('cooler', 'Lid', 'hinge', base.id);
const hinge = Objects.defineJoint('cooler', coolerLid.id, {
  kind: 'hinge',
  pivot: { x: 0, y: 0.3, z: -0.3 },
  axis: { x: 1, y: 0, z: 0 },
  limits: { min: 0, max: 90 },
});
assert(hinge.ok && coolerLid.joint.kind === 'hinge', 'Cooler lid is hinge');

Objects.createObject('drawer', 'Drawer Unit');
const frame = Objects.addComponent('drawer', 'Frame', 'fixed');
const drawer = Objects.addComponent('drawer', 'Drawer', 'prismatic', frame.id);
const slide = Objects.defineJoint('drawer', drawer.id, {
  kind: 'prismatic',
  axis: { x: 0, y: 0, z: 1 },
  limits: { min: 0, max: 0.4 },
});
assert(slide.ok && drawer.joint.kind === 'prismatic', 'Drawer is prismatic');

const bad = Objects.defineJoint('pot', lid.id, { kind: 'weld' });
assert(bad.ok === false && bad.reason === 'invalid_joint', 'Invalid joint rejected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
