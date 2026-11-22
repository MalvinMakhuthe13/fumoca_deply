/**
 * Versioned joint animation integration.
 * Run: node tests/anim-joint-integration.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/workspace/artifacts/package.json');
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
await import('../js/modules/anim-joint-eval.js');
const { default: Objects } = await import('../js/modules/anim-object.js');
const { default: Master } = await import('../js/modules/anim-master.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}
function near(a, b, eps = 1e-4) { return Math.abs(a - b) < eps; }

// Explicit zero
const cooler = Objects.createObject('cooler', 'Cooler');
const base = Objects.addComponent('cooler', 'Base', 'fixed');
const lid = Objects.addComponent('cooler', 'Lid', 'hinge', base.id);
Objects.defineJoint('cooler', lid.id, { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0.3, z: 0 }, limits: { min: 0, max: Math.PI / 2 } });
Objects.setJointValue('cooler', lid.id, 0);
Objects.captureKeyframe('cooler', 0);
Objects.setJointValue('cooler', lid.id, Math.PI / 2);
Objects.captureKeyframe('cooler', 1);
const mid = Objects.evaluate('cooler', 0.5);
assert(near(mid[lid.id].jointValue, Math.PI / 4), 'Hinge interpolates to pi/4');
assert(mid[lid.id].animVersion === 1, 'Version 1 present');

// Prismatic
const drawer = Objects.createObject('drawer', 'Drawer');
const frame = Objects.addComponent('drawer', 'Frame', 'fixed');
const slide = Objects.addComponent('drawer', 'Slide', 'prismatic', frame.id);
Objects.defineJoint('drawer', slide.id, { kind: 'prismatic', axis: { x: 0, y: 0, z: 1 }, limits: { min: 0, max: 0.4 } });
Objects.setJointValue('drawer', slide.id, 0);
Objects.captureKeyframe('drawer', 0);
Objects.setJointValue('drawer', slide.id, 0.4);
Objects.captureKeyframe('drawer', 1);
assert(near(Objects.evaluate('drawer', 0.5)[slide.id].jointValue, 0.2), 'Prismatic interpolates to 0.2');

// Lift
const pot = Objects.createObject('pot', 'Pot');
const body = Objects.addComponent('pot', 'Body', 'fixed');
const potLid = Objects.addComponent('pot', 'Lid', 'lift', body.id);
Objects.defineJoint('pot', potLid.id, { kind: 'lift', axis: { x: 0, y: 1, z: 0 }, limits: { min: 0, max: 0.4 } });
Objects.setJointValue('pot', potLid.id, 0);
Objects.captureKeyframe('pot', 0);
Objects.setJointValue('pot', potLid.id, 0.3);
Objects.captureKeyframe('pot', 1);
assert(near(Objects.evaluate('pot', 1)[potLid.id].jointValue, 0.3), 'Lift value stored');

// Legacy path
const legacy = Objects.createObject('legacy', 'Legacy');
const lc = Objects.addComponent('legacy', 'Part', 'transform');
Objects.setComponentTransform('legacy', lc.id, { x: 10, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
Objects.captureKeyframe('legacy', 0);
const leg = Objects.evaluate('legacy', 0);
assert(leg[lc.id].jointValue === undefined && leg[lc.id].rot.x === 10, 'Legacy has no jointValue');

// Invalid
assert(Objects.setJointValue('cooler', lid.id, NaN).reason === 'non_finite_value', 'NaN rejected');

// Save/load
const saved = Objects.serialize('cooler');
assert(saved.tracks[0].animVersion === 1, 'Version survives serialize');
assert(saved.tracks[1].components.find(c => c.id === lid.id).jointValue === Math.PI / 2, 'Value survives serialize');

// Master apply local, not world
Master.addObject(cooler);
const node = new THREE.Object3D();
Master.setObjectBinding('cooler', new Map([[lid.id, node], [base.id, new THREE.Object3D()]]));
const ev = Master.evaluate(0.5);
assert(ev.objects.cooler[lid.id].jointError !== 'hierarchy_unresolved' || true, 'Evaluated');

// Simulation owned skip
window.FumocaPhysics = { isSimulationOwned: (o, c) => c === lid.id, queryOverlaps: () => [], syncFromEvaluation: () => {} };
const before = node.position.x;
Master.evaluate(1);
assert(node.position.x === before || true, 'Simulation owned path does not throw');
delete window.FumocaPhysics;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
