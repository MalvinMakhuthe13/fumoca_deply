/**
 * Integrated FumocaPhysics tests with real Rapier via preload.
 * Run: node tests/anim-physics-integrated.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/tmp/package.json');
const rapierUrl = pathToFileURL(require.resolve('@dimforge/rapier3d-compat')).href;
const rapierMod = await import(rapierUrl);

const { default: Physics } = await import('../js/modules/anim-physics.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const init = await Physics.initRapier(rapierMod);
assert(init.ok === true, 'initRapier with preload');
assert(Physics.isRapierReady(), 'Rapier ready');

const g = Physics.getGravity();
assert(g && Math.abs(g.y + 9.81) < 0.01, 'Default gravity -9.81');
Physics.setGravity({ x: 0, y: 0, z: 0 });
assert(Math.abs(Physics.getGravity().y) < 0.01, 'Gravity zero');
Physics.setGravity({ x: 0, y: -9.81, z: 0 });
assert(Math.abs(Physics.getGravity().y + 9.81) < 0.01, 'Gravity restored');

Physics.createCollider({ id: 'floor', type: 'box', bodyType: 'static', halfExtents: { x: 1, y: 0.05, z: 1 }, owner: { kind: 'component', objectId: 'c', componentId: 'base' } });
Physics.createCollider({ id: 'bottle', type: 'capsule', bodyType: 'dynamic', mass: 0.5, owner: { kind: 'component', objectId: 'b', componentId: 'body' } });

const evalData = { objects: { c: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } }, b: { body: { pos: { x: 0, y: 1.5, z: 0 }, rot: { x: 0, y: 0, z: 0 } } } } };
Physics.syncFromEvaluation(evalData);
const start = Physics.getDynamicPose('bottle');
assert(start && start.position.y > 1, 'Initial pose set');

for (let i = 0; i < 10; i++) Physics.step(1/60);
let threw = false;
try { Physics.syncFromEvaluation(evalData); } catch (e) { threw = true; }
assert(!threw, 'Second sync does not throw');
const mid = Physics.getDynamicPose('bottle');
assert(mid && mid.position.y < start.position.y, 'Second sync keeps Rapier pose');
assert(mid && mid.linvel.y < 0, 'Downward velocity');

Physics.reset();
const after = Physics.getDynamicPose('bottle');
assert(after && Math.abs(after.position.y - start.position.y) < 0.05, 'Reset restores pose');
assert(after && Math.abs(after.linvel.y) < 0.01, 'Reset clears velocity');

const base = Physics.getBodyCount();
Physics.setEnabled('bottle', false);
assert(Physics.getBodyCount() === base - 1, 'Disable decreases count');
Physics.setEnabled('bottle', true);
assert(Physics.getBodyCount() === base, 'Enable restores count');

Physics.removeCollider('bottle');
Physics.dispose();
assert(Physics.list().length === 0, 'Dispose clears');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
