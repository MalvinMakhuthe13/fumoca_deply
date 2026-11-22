/**
 * Universal affordances. Same classifier for car, house, bottle.
 * Run: node tests/anim-afford.test.mjs
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
const { default: Afford } = await import('../js/modules/anim-afford.js');
const { default: Live } = await import('../js/modules/anim-live.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const scene = new THREE.Scene();
window.scene = scene;
const car = window.FumocaScenes.createCar(scene);
const house = window.FumocaScenes.createHouse(scene);
const bottle = window.FumocaScenes.createBottle(scene);

const carAff = Afford.affordances(window.FumocaObjectAnim.get(car.objectId));
const houseAff = Afford.affordances(window.FumocaObjectAnim.get(house.objectId));
const bottleAff = Afford.affordances(window.FumocaObjectAnim.get(bottle.objectId));

assert(carAff.some(a => a.affordance === 'door'), 'Car has door affordance');
assert(carAff.some(a => a.affordance === 'boot'), 'Car has boot affordance');
assert(houseAff.some(a => a.affordance === 'door'), 'House has door affordance');
assert(houseAff.some(a => a.affordance === 'window'), 'House has window affordance');
assert(bottleAff.some(a => a.affordance === 'cap'), 'Bottle has cap affordance');

Live.bind(car.objectId);
Live.bind(house.objectId);
const door = carAff.find(a => a.name === 'DoorFL');
const win = houseAff.find(a => a.name === 'Window');
assert(Live.toggle(car.objectId, door.componentId).open, 'Car door toggles');
assert(Live.toggle(house.objectId, win.componentId).open, 'House window toggles on the same path');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
