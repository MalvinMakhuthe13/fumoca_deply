/**
 * Real Rapier dynamic tests.
 * Uses installed @dimforge/rapier3d-compat@0.21.0.
 * Run: node tests/anim-physics-rapier-dynamic.test.mjs
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const rapierUrl = pathToFileURL(require.resolve('@dimforge/rapier3d-compat')).href;
const RAPIER = (await import(rapierUrl)).default;
await RAPIER.init();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
assert(Math.abs(world.gravity.y + 9.81) < 0.01, 'World gravity is -9.81');

const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.05, 2), floor);
const bottle = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.5, 0).setAdditionalMass(0.5));
world.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.04), bottle);

const y0 = bottle.translation().y;
for (let i = 0; i < 30; i++) world.step();
const y1 = bottle.translation().y;
const v1 = bottle.linvel().y;
assert(y1 < y0, 'Bottle fell');
assert(v1 < 0, 'Bottle has downward velocity');

for (let i = 0; i < 180; i++) world.step();
const settled = bottle.translation().y;
assert(settled > 0.05, 'Bottle settled above floor');
assert(settled < 0.5, 'Bottle is near floor');

bottle.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
bottle.setLinvel({ x: 0, y: 0, z: 0 }, true);
bottle.setAngvel({ x: 0, y: 0, z: 0 }, true);
assert(Math.abs(bottle.translation().y - 1.5) < 0.01, 'Reset restores pose');
assert(Math.abs(bottle.linvel().y) < 0.01, 'Reset clears velocity');

const before = world.bodies.len();
world.removeRigidBody(bottle);
assert(world.bodies.len() === before - 1, 'Remove decreases body count');
const bottle2 = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.5, 0));
world.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.04), bottle2);
assert(world.bodies.len() === before, 'Re-enable restores count');

let baseline = world.bodies.len();
let current = bottle2;
for (let i = 0; i < 10; i++) {
  world.removeRigidBody(current);
  current = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  world.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.04), current);
}
assert(world.bodies.len() === baseline, '10 cycles do not increase body count');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
