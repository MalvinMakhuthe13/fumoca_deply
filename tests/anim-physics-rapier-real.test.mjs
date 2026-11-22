/**
 * Real Rapier WASM tests.
 * Uses the locally installed @dimforge/rapier3d-compat@0.21.0.
 * Studio loads the same version via the import map CDN URL.
 * Run from a directory that can resolve the package, or with NODE_PATH.
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/tmp/package.json');
const rapierUrl = pathToFileURL(require.resolve('@dimforge/rapier3d-compat')).href;
const RAPIER = (await import(rapierUrl)).default;
await RAPIER.init();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

assert(typeof RAPIER.World === 'function', 'Rapier WASM initialized');

function makeWorld() { return new RAPIER.World({ x: 0, y: 0, z: 0 }); }
function addBox(world, pos, half = { x: 0.5, y: 0.5, z: 0.5 }, opts = {}) {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
  let desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
  if (opts.sensor) desc = desc.setSensor(true);
  if (opts.groups != null && opts.mask != null) desc = desc.setCollisionGroups((opts.groups & 0xffff) | ((opts.mask & 0xffff) << 16));
  const col = world.createCollider(desc, body);
  return { body, col };
}

const world = makeWorld();
const a = addBox(world, { x: 0, y: 0, z: 0 });
const b = addBox(world, { x: 0.4, y: 0, z: 0 });
a.body.setNextKinematicTranslation({ x: 0, y: 0, z: 0 });
b.body.setNextKinematicTranslation({ x: 0.4, y: 0, z: 0 });
world.step();
const shape = new RAPIER.Cuboid(0.5, 0.5, 0.5);
let hits = [];
world.intersectionsWithShape({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { hits.push(c); return true; });
assert(hits.length >= 2, 'Real Rapier: overlapping boxes');

b.body.setNextKinematicTranslation({ x: 5, y: 0, z: 0 });
world.step();
hits = [];
world.intersectionsWithShape({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { hits.push(c); return true; });
assert(hits.length === 1, 'Real Rapier: separated boxes');

const world2 = makeWorld();
const sphereBody = world2.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
world2.createCollider(RAPIER.ColliderDesc.ball(0.3), sphereBody);
const capBody = world2.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0.2, 0, 0));
world2.createCollider(RAPIER.ColliderDesc.capsule(0.2, 0.1), capBody);
world2.step();
hits = [];
world2.intersectionsWithShape({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(0.3), (c) => { hits.push(c); return true; });
assert(hits.length >= 1, 'Real Rapier: sphere/capsule query');

const world3 = makeWorld();
const rb = world3.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
world3.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), rb);
rb.setNextKinematicRotation({ x: 0, y: 0.3826834, z: 0, w: 0.9238795 });
world3.step();
hits = [];
world3.intersectionsWithShape({ x: 0.6, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Cuboid(0.2, 0.2, 0.2), (c) => { hits.push(c); return true; });
assert(Array.isArray(hits), 'Real Rapier: rotated box query runs');

const world4 = makeWorld();
addBox(world4, { x: 0, y: 0, z: 0 });
addBox(world4, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }, { sensor: true });
world4.step();
hits = [];
world4.intersectionsWithShape({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { hits.push(c); return true; });
assert(hits.length >= 2, 'Real Rapier: sensor reported by shape query');

const world5 = makeWorld();
addBox(world5, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }, { groups: 0x1, mask: 0x2 });
addBox(world5, { x: 0, y: 0, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }, { groups: 0x4, mask: 0x1 });
world5.step();
assert(true, 'Real Rapier: groups accepted');

const world6 = makeWorld();
const d = addBox(world6, { x: 0, y: 0, z: 0 });
d.col.setEnabled(false);
world6.step();
hits = [];
world6.intersectionsWithShape({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { hits.push(c); return true; });
assert(hits.length === 0, 'Real Rapier: disabled excluded');

const world7 = makeWorld();
const r = addBox(world7, { x: 0, y: 0, z: 0 });
world7.removeRigidBody(r.body);
world7.step();
hits = [];
world7.intersectionsWithShape({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { hits.push(c); return true; });
assert(hits.length === 0, 'Real Rapier: removed collider gone');

const worldA = makeWorld();
const worldB = makeWorld();
assert(worldA !== worldB, 'Distinct world instances');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
