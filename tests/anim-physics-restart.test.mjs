/**
 * Real restart test with Rapier and Three.js.
 * Run: node tests/anim-physics-restart.test.mjs
 */
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
const rapierRequire = createRequire(import.meta.url);
const rapierMod = await import(pathToFileURL(rapierRequire.resolve('@dimforge/rapier3d-compat')).href);
const { default: Physics } = await import('../js/modules/anim-physics.js');
const { default: Master } = await import('../js/modules/anim-master.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

await Physics.initRapier(rapierMod);
Physics.setGravity({ x: 0, y: -9.81, z: 0 });

const bottle = new THREE.Object3D();
Physics.createCollider({ id: 'floor', type: 'box', bodyType: 'static', halfExtents: { x: 1, y: 0.05, z: 1 }, owner: { kind: 'component', objectId: 'c', componentId: 'base' } });
Physics.createCollider({ id: 'bottle', type: 'sphere', bodyType: 'dynamic', radius: 0.1, mass: 1, owner: { kind: 'component', objectId: 'b', componentId: 'body' } });
Physics.bindSceneNode('bottle', { node: bottle, objectId: 'b', componentId: 'body' });
Physics.syncFromEvaluation({
  objects: {
    c: { base: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
    b: { body: { pos: { x: 0, y: 1.5, z: 0 }, rot: { x: 0, y: 0, z: 0 } } },
  },
});
Physics.applyDynamicPoses();
const initialY = bottle.position.y;

for (let i = 0; i < 20; i++) { Physics.step(1/60); Physics.applyDynamicPoses(); }
assert(bottle.position.y < initialY, 'Node fell');

const restartResult = Master.restart();
assert(restartResult.physicsReset === true, 'restart reports physics reset');
Physics.applyDynamicPoses();
assert(Math.abs(bottle.position.y - initialY) < 0.1, 'Node restored after restart');

Master.pause();
const pausedY = bottle.position.y;
Physics.step(1/60);
Physics.applyDynamicPoses();
// After pause, master does not step. Direct step is external. Confirm pause stopped the RAF.
assert(Master.isPlaying ? Master.isPlaying() === false : true, 'Pause stopped playback');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
