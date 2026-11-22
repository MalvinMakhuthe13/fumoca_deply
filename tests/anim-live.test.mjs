/**
 * Live interaction: same toggle path for car, house, bottle.
 * Run: node tests/anim-live.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const require = createRequire('/workspace/artifacts/package.json');
const THREE = await import(pathToFileURL(require.resolve('three')).href);
globalThis.THREE = THREE;
await import('../js/modules/anim-joint-eval.js');
await import('../js/modules/anim-object.js');
await import('../js/modules/anim-master.js');
await import('../js/modules/anim-studio-init.js');
await import('../js/modules/anim-scenes.js');
const { default: Live } = await import('../js/modules/anim-live.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const scene = new THREE.Scene();
window.scene = scene;
const car = window.FumocaScenes.createCar(scene);
assert(car.ok, 'Car created');
const bound = Live.bind(car.objectId);
assert(bound.ok, 'Car bound');
const door = window.FumocaObjectAnim.get(car.objectId).components.find(c => c.name === 'DoorFL');
const opened = Live.toggle(car.objectId, door.id);
assert(opened.ok && opened.open, 'Door opens');
const closed = Live.toggle(car.objectId, door.id);
assert(closed.ok && !closed.open, 'Door closes');

const house = window.FumocaScenes.createHouse(scene);
Live.bind(house.objectId);
const hd = window.FumocaObjectAnim.get(house.objectId).components.find(c => c.name === 'FrontDoor');
assert(Live.toggle(house.objectId, hd.id).open, 'House door opens on the same path');

const bottle = window.FumocaScenes.createBottle(scene);
Live.bind(bottle.objectId);
const cap = window.FumocaObjectAnim.get(bottle.objectId).components.find(c => c.name === 'Cap');
assert(Live.toggle(bottle.objectId, cap.id).open, 'Bottle cap lifts on the same path');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
