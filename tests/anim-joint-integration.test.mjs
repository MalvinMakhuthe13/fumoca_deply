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
function near(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

// Cooler: fixed base, hinged lid
const cooler = Objects.createObject('cooler', 'Cooler');
const base = Objects.addComponent('cooler', 'Base', 'fixed');
base.local = { position: { x: 2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const lid = Objects.addComponent('cooler', 'Lid', 'hinge', base.id);
Objects.defineJoint('cooler', lid.id, {
  kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0.5, y: 0, z: 0 },
  limits: { min: 0, max: Math.PI / 2 },
});
lid.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('cooler', lid.id, 0);
Objects.captureKeyframe('cooler', 0);
Objects.setJointValue('cooler', lid.id, Math.PI / 2);
Objects.captureKeyframe('cooler', 1);

const mid = Objects.evaluate('cooler', 0.5);
assert(near(mid[lid.id].jointValue, Math.PI / 4), 'Hinge interpolates to pi/4');
assert(mid[lid.id].animVersion === 1, 'Version 1 present');
assert(Objects.serialize('cooler').tracks[0].animVersion === 1, 'Version survives serialize');

// Master apply
Master.addObject(Objects.get('cooler'));
const baseNode = new THREE.Object3D();
const lidNode = new THREE.Object3D();
baseNode.add(lidNode);
Master.setObjectBinding('cooler', new Map([[base.id, baseNode], [lid.id, lidNode]]));
const ev = Master.evaluate(0);
assert(!ev.objects.cooler[lid.id].jointError, 'Lid has no jointError');
assert(!ev.objects.cooler[base.id].jointError, 'Base has no jointError');
assert(near(baseNode.position.x, 2), 'Base local x is 2');
assert(near(lidNode.position.x, 1), 'Lid local x is 1');
baseNode.updateMatrixWorld(true);
const lidWorld = new THREE.Vector3();
lidNode.getWorldPosition(lidWorld);
assert(near(lidWorld.x, 3), 'Lid world x is 3, parent applied once');

const evOpen = Master.evaluate(1);
assert(!evOpen.objects.cooler[lid.id].jointError, 'Open lid has no jointError');
assert(near(lidNode.position.x, 0.5, 0.05), 'Non-zero pivot x stays near 0.5');

// Legacy runtime path
const legacy = Objects.createObject('legacy', 'Legacy');
const lc = Objects.addComponent('legacy', 'Part', 'transform');
Objects.setComponentTransform('legacy', lc.id, { x: 10, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
Objects.captureKeyframe('legacy', 0);
const leg = Objects.evaluate('legacy', 0);
assert(leg[lc.id].animVersion === undefined, 'Legacy not promoted');
assert(leg[lc.id].jointValue === undefined, 'Legacy has no jointValue');
Objects.setComponentTransform('legacy', lc.id, { x: 20, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
Objects.captureKeyframe('legacy', 1);
Master.addObject(Objects.get('legacy'));
const legNode = new THREE.Object3D();
Master.setObjectBinding('legacy', new Map([[lc.id, legNode]]));
Master.evaluate(1);
assert(near(legNode.position.x, 3), 'Legacy second keyframe position applied');
assert(near(legNode.rotation.x, 20 * Math.PI / 180, 0.01), 'Legacy second keyframe rotation applied');

// Missing jointValue in version 1
const broken = { id: 'broken', tracks: [{ time: 0, animVersion: 1, components: [{ id: 'x', rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } }] }], components: [{ id: 'x', joint: { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }] };
Objects.deserialize(broken);
Master.addObject(broken);
const bn = new THREE.Object3D();
const before = bn.position.x;
Master.setObjectBinding('broken', new Map([['x', bn]]));
const bev = Master.evaluate(0);
assert(bev.objects.broken?.x?.jointError === 'missing_joint_value', 'Missing jointValue errors');
assert(bn.position.x === before, 'Node unchanged on error');

// NaN rejected
assert(Objects.setJointValue('cooler', lid.id, NaN).reason === 'non_finite_value', 'NaN rejected');

// Prismatic and lift
const drawer = Objects.createObject('drawer', 'Drawer');
const frame = Objects.addComponent('drawer', 'Frame', 'fixed');
const slide = Objects.addComponent('drawer', 'Slide', 'prismatic', frame.id);
Objects.defineJoint('drawer', slide.id, { kind: 'prismatic', axis: { x: 0, y: 0, z: 1 }, limits: { min: 0, max: 0.4 } });
Objects.setJointValue('drawer', slide.id, 0);
Objects.captureKeyframe('drawer', 0);
Objects.setJointValue('drawer', slide.id, 0.4);
Objects.captureKeyframe('drawer', 1);
assert(near(Objects.evaluate('drawer', 0.5)[slide.id].jointValue, 0.2), 'Prismatic 0.2');

const pot = Objects.createObject('pot', 'Pot');
const body = Objects.addComponent('pot', 'Body', 'fixed');
const potLid = Objects.addComponent('pot', 'Lid', 'lift', body.id);
Objects.defineJoint('pot', potLid.id, { kind: 'lift', axis: { x: 0, y: 1, z: 0 }, limits: { min: 0, max: 0.4 } });
Objects.setJointValue('pot', potLid.id, 0);
Objects.captureKeyframe('pot', 0);
Objects.setJointValue('pot', potLid.id, 0.3);
Objects.captureKeyframe('pot', 1);
assert(near(Objects.evaluate('pot', 1)[potLid.id].jointValue, 0.3), 'Lift 0.3');

// Simulation owned
window.FumocaPhysics = { isSimulationOwned: () => true, queryOverlaps: () => [], syncFromEvaluation: () => {} };
const owned = lidNode.position.clone();
Master.evaluate(1);
assert(near(lidNode.position.x, owned.x) && near(lidNode.position.z, owned.z), 'Simulation-owned node unchanged');
delete window.FumocaPhysics;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
