/**
 * Versioned joint animation integration.
 * Run: node tests/anim-joint-integration.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
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


// Nested: Root -> Frame -> Lid
const nest = Objects.createObject('nest', 'Nest');
const root = Objects.addComponent('nest', 'Root', 'fixed');
root.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const nframe = Objects.addComponent('nest', 'Frame', 'fixed', root.id);
nframe.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const nlid = Objects.addComponent('nest', 'Lid', 'hinge', nframe.id);
Objects.defineJoint('nest', nlid.id, { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0.2, y: 0, z: 0 }, limits: { min: 0, max: Math.PI / 2 } });
nlid.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('nest', nlid.id, 0);
Objects.captureKeyframe('nest', 0);
Master.addObject(Objects.get('nest'));
const rootNode = new THREE.Object3D();
const frameNode = new THREE.Object3D();
const nlidNode = new THREE.Object3D();
rootNode.add(frameNode);
frameNode.add(nlidNode);
Master.setObjectBinding('nest', new Map([[root.id, rootNode], [nframe.id, frameNode], [nlid.id, nlidNode]]));
const nev = Master.evaluate(0);
assert(!nev.objects.nest[nlid.id].jointError, 'Nested lid has no jointError');
assert(near(rootNode.position.x, 1) && near(frameNode.position.x, 1) && near(nlidNode.position.x, 1), 'Each local applied once');
rootNode.updateMatrixWorld(true);
const nw = new THREE.Vector3();
nlidNode.getWorldPosition(nw);
assert(near(nw.x, 3), 'Nested world x is 3');

// Cycle
const cyc = { id: 'cyc', tracks: [{ time: 0, animVersion: 1, components: [{ id: 'a', jointValue: 0 }, { id: 'b', jointValue: 0 }] }], components: [
  { id: 'a', parentId: 'b', joint: { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } },
  { id: 'b', parentId: 'a', joint: { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } },
]};
Objects.deserialize(cyc);
Master.addObject(cyc);
const ca = new THREE.Object3D(), cb = new THREE.Object3D();
Master.setObjectBinding('cyc', new Map([['a', ca], ['b', cb]]));
const cev = Master.evaluate(0);
assert(cev.objects.cyc.a.jointError === 'parent_cycle' && cev.objects.cyc.b.jointError === 'parent_cycle', 'Both nodes report parent_cycle');
assert(near(ca.position.x, 0) && near(ca.rotation.x, 0) && near(cb.position.x, 0) && near(cb.rotation.x, 0), 'Both cycle nodes unchanged');


// Missing parent
const miss = { id: 'miss', tracks: [{ time: 0, animVersion: 1, components: [{ id: 'child', jointValue: 0 }] }], components: [
  { id: 'child', parentId: 'nope', joint: { kind: 'hinge', axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 } }, local: { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } },
]};
Objects.deserialize(miss);
Master.addObject(miss);
const mn = new THREE.Object3D();
Master.setObjectBinding('miss', new Map([['child', mn]]));
const mev = Master.evaluate(0);
assert(mev.objects.miss.child.jointError === 'unknown_parent', 'Missing parent error');
assert(near(mn.position.x, 0), 'Missing-parent node unchanged');

// Nested hinge movement
Objects.setJointValue('nest', nlid.id, Math.PI / 2);
Objects.captureKeyframe('nest', 1);
const closed = Master.evaluate(0);
const open = Master.evaluate(1);
assert(!closed.objects.nest[nlid.id].jointError && !open.objects.nest[nlid.id].jointError, 'No error at either time');
assert(near(rootNode.position.x, 1) && near(frameNode.position.x, 1), 'Ancestors unchanged');



// Multi-level missing parent: Root -> Frame -> Lid, Root parent missing
const deep = Objects.createObject('deep', 'Deep');
const droot = Objects.addComponent('deep', 'Root', 'fixed');
droot.parentId = 'missing';
droot.local = { position: { x: 2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const dframe = Objects.addComponent('deep', 'Frame', 'fixed', droot.id);
dframe.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const dlid = Objects.addComponent('deep', 'Lid', 'hinge', dframe.id);
Objects.defineJoint('deep', dlid.id, { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: Math.PI } });
dlid.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
Objects.setJointValue('deep', dlid.id, 0);
Objects.captureKeyframe('deep', 0);
const dleg = Objects.addComponent('deep', 'Legacy', 'transform');
Objects.setComponentTransform('deep', dleg.id, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
Objects.captureKeyframe('deep', 0);
Objects.setComponentTransform('deep', dleg.id, { x: 30, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
Objects.captureKeyframe('deep', 1);
Master.addObject(Objects.get('deep'));
const drn = new THREE.Object3D(), dfn = new THREE.Object3D(), dln = new THREE.Object3D(), dlegn = new THREE.Object3D();
Master.setObjectBinding('deep', new Map([[droot.id, drn], [dframe.id, dfn], [dlid.id, dln], [dleg.id, dlegn]]));
const dev = Master.evaluate(1);
assert(dev.objects.deep[dlid.id].jointError === 'unknown_parent', 'Deep missing parent error');
assert(near(drn.position.x, 0) && near(dfn.position.x, 0) && near(dln.position.x, 0), 'Invalid chain unchanged');
assert(near(dlegn.position.x, 4), 'Unrelated legacy still applied');

// Pivoted hinge numeric proof
Master.evaluate(0);
const closedQuat = nlidNode.quaternion.clone();
const closedPos = nlidNode.position.clone();
nlidNode.updateMatrixWorld(true);
const closedWorld = new THREE.Vector3();
nlidNode.getWorldPosition(closedWorld);
Master.evaluate(1);
nlidNode.updateMatrixWorld(true);
const openWorld = new THREE.Vector3();
nlidNode.getWorldPosition(openWorld);
assert(near(closedPos.x, 1) && near(closedPos.y, 0) && near(closedPos.z, 0), 'Closed lid local is (1,0,0)');
assert(near(closedWorld.x, 3) && near(closedWorld.y, 0) && near(closedWorld.z, 0), 'Closed lid world is (3,0,0)');
assert(near(nlidNode.position.x, 0.2, 1e-3) && near(nlidNode.position.y, 0, 1e-3) && near(nlidNode.position.z, -0.8, 1e-3), 'Open lid local is (0.2,0,-0.8)');
assert(near(openWorld.x, 2.2, 1e-3) && near(openWorld.y, 0, 1e-3) && near(openWorld.z, -0.8, 1e-3), 'Open lid world is (2.2,0,-0.8)');
assert(near(nlidNode.quaternion.x, 0, 1e-3) && near(nlidNode.quaternion.y, 0.7071068, 1e-3) && near(nlidNode.quaternion.z, 0, 1e-3) && near(nlidNode.quaternion.w, 0.7071068, 1e-3), 'Open quaternion is 90 deg Y');
assert(Math.abs(nlidNode.position.x - closedPos.x) > 0.5, 'Open and closed positions differ');
assert(near(rootNode.position.x, 1) && near(frameNode.position.x, 1), 'Ancestors retain local');
assert(nlidNode.parent === frameNode && frameNode.parent === rootNode, 'Three.js hierarchy intact');
assert(!Master.evaluate(0).objects.nest[nlid.id].jointError, 'Closed has no error');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// Complete articulated object: Root -> Frame -> HingedLid -> Handle, Frame -> Drawer
const cab = Objects.createObject('cab', 'Cabinet');
const cabRoot = Objects.addComponent('cab', 'Root', 'fixed');
cabRoot.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const cabFrame = Objects.addComponent('cab', 'Frame', 'fixed', cabRoot.id);
cabFrame.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const cabLid = Objects.addComponent('cab', 'HingedLid', 'hinge', cabFrame.id);
Objects.defineJoint('cab', cabLid.id, { kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, limits: { min: 0, max: Math.PI / 2 } });
cabLid.local = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const cabHandle = Objects.addComponent('cab', 'Handle', 'fixed', cabLid.id);
cabHandle.local = { position: { x: 0.2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const cabDrawer = Objects.addComponent('cab', 'Drawer', 'prismatic', cabFrame.id);
Objects.defineJoint('cab', cabDrawer.id, { kind: 'prismatic', axis: { x: 0, y: 0, z: 1 }, limits: { min: 0, max: 0.4 } });
cabDrawer.local = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };

Objects.setJointValue('cab', cabLid.id, 0);
Objects.setJointValue('cab', cabDrawer.id, 0);
Objects.captureKeyframe('cab', 0);
Objects.setJointValue('cab', cabLid.id, Math.PI / 4);
Objects.setJointValue('cab', cabDrawer.id, 0.2);
Objects.captureKeyframe('cab', 0.5);
Objects.setJointValue('cab', cabLid.id, Math.PI / 2);
Objects.setJointValue('cab', cabDrawer.id, 0.4);
Objects.captureKeyframe('cab', 1);

Master.addObject(Objects.get('cab'));
const crn = new THREE.Object3D(), cfn = new THREE.Object3D(), cln = new THREE.Object3D(), chn = new THREE.Object3D(), cdn = new THREE.Object3D();
crn.add(cfn); cfn.add(cln); cln.add(chn); cfn.add(cdn);
Master.setObjectBinding('cab', new Map([[cabRoot.id, crn], [cabFrame.id, cfn], [cabLid.id, cln], [cabHandle.id, chn], [cabDrawer.id, cdn]]));

function cabAt(t) {
  const ev = Master.evaluate(t);
  crn.updateMatrixWorld(true);
  const lw = new THREE.Vector3(), dw = new THREE.Vector3();
  cln.getWorldPosition(lw); cdn.getWorldPosition(dw);
  return { ev, lid: cln.position.clone(), drawer: cdn.position.clone(), lidW: lw, drawerW: dw };
}

const t0 = cabAt(0);
assert(!t0.ev.objects.cab[cabLid.id].jointError && !t0.ev.objects.cab[cabDrawer.id].jointError, 'Closed has no jointError');
assert(near(t0.lid.x, 1) && near(t0.drawer.z, 0), 'Closed lid x=1, drawer z=0');
assert(near(crn.position.x, 1) && near(cfn.position.x, 1), 'Ancestors retain local');

const t1 = cabAt(1);
assert(near(t1.lid.z, -1, 1e-3), 'Open lid local z is -1');
assert(near(t1.drawer.z, 0.4), 'Drawer fully extended');
assert(near(t1.lid.x, 0, 1e-3), 'Open lid local x is 0');

// Scrub determinism
const a = cabAt(0), b = cabAt(1), c = cabAt(0.5), d = cabAt(1), e = cabAt(0);
assert(near(a.lid.x, e.lid.x) && near(a.drawer.z, e.drawer.z), 'Scrub back to 0 matches');
assert(near(b.lid.z, d.lid.z) && near(b.drawer.z, d.drawer.z), 'Scrub to 1 matches');

// Independent branches
assert(near(t0.lid.x, 1) && near(t1.drawer.z, 0.4), 'Branches do not overwrite each other');
assert(cln.parent === cfn && cdn.parent === cfn && cfn.parent === crn, 'Cabinet hierarchy intact');

// Midpoint
const cabMid = cabAt(0.5);
assert(near(cabMid.ev.objects.cab[cabLid.id].jointValue, Math.PI / 4), 'Midpoint lid jointValue is pi/4');
assert(near(cabMid.ev.objects.cab[cabDrawer.id].jointValue, 0.2), 'Midpoint drawer jointValue is 0.2');
assert(near(cabMid.lid.x, 0.7071068, 1e-3) && near(cabMid.lid.y, 0, 1e-3) && near(cabMid.lid.z, -0.7071068, 1e-3), 'Midpoint lid local is (0.707,0,-0.707)');
assert(near(cabMid.drawer.z, 0.2), 'Midpoint drawer z is 0.2');
assert(near(crn.position.x, 1) && near(cfn.position.x, 1), 'Midpoint ancestors retain local');
assert(!cabMid.ev.objects.cab[cabLid.id].jointError && !cabMid.ev.objects.cab[cabDrawer.id].jointError, 'Midpoint has no jointError');

// Scrub sequence 0 -> 1 -> 0.5 -> 1 -> 0 -> 0.5 -> 0
const seq = [0, 1, 0.5, 1, 0, 0.5, 0].map(t => cabAt(t));
assert(near(seq[0].lid.x, seq[4].lid.x) && near(seq[0].drawer.z, seq[4].drawer.z) && near(seq[0].lid.x, seq[6].lid.x), 'Return to 0 is identical');
assert(near(seq[1].lid.z, seq[3].lid.z) && near(seq[1].drawer.z, seq[3].drawer.z), 'Return to 1 is identical');
assert(near(seq[2].lid.x, seq[5].lid.x, 1e-3) && near(seq[2].drawer.z, seq[5].drawer.z, 1e-3), 'Return to 0.5 is identical');
assert(seq.every(s => !s.ev.objects.cab[cabLid.id].jointError), 'No jointError during scrub');

// Branch isolation: compare closed and open keyframes
const closedState = cabAt(0);
const openState = cabAt(1);
assert(near(closedState.lid.x, 1) && near(openState.lid.z, -1, 1e-3), 'Lid changes across timeline');
assert(near(closedState.drawer.z, 0) && near(openState.drawer.z, 0.4), 'Drawer changes across timeline');
assert(near(closedState.lid.x, 1) && near(openState.drawer.z, 0.4), 'Lid closed pose and drawer open pose are independent');
assert(near(openState.lid.z, -1, 1e-3) && near(closedState.drawer.z, 0), 'Lid open pose and drawer closed pose are independent');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
