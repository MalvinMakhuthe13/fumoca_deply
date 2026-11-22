/**
 * Car and house articulation.
 * Run: node tests/anim-scenes.test.mjs
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
const { default: Scenes } = await import('../js/modules/anim-scenes.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const scene = new THREE.Scene();
const car = Scenes.createCar(scene);
assert(car.ok, 'Car registered');
const carObj = window.FumocaObjectAnim.get('car_demo');
const names = carObj.components.map(c => c.name);
for (const n of ['DoorFL', 'DoorFR', 'DoorRL', 'DoorRR', 'Bonnet', 'Boot']) {
  assert(names.includes(n), `Car has ${n}`);
}
window.FumocaMaster.evaluate(2);
const fl = scene.getObjectByName('DoorFL');
const bonnet = scene.getObjectByName('Bonnet');
const boot = scene.getObjectByName('Boot');
assert(Math.abs(fl.quaternion.y) > 0.2 || Math.abs(fl.rotation.y) > 0.2, 'Front door opened');
assert(Math.abs(bonnet.quaternion.x) > 0.2 || Math.abs(bonnet.rotation.x) > 0.2, 'Bonnet opened');
assert(Math.abs(boot.quaternion.x) > 0.2 || Math.abs(boot.rotation.x) > 0.2, 'Boot opened');

const house = Scenes.createHouse(scene);
assert(house.ok, 'House registered');
window.FumocaMaster.evaluate(2);
const door = scene.getObjectByName('FrontDoor');
assert(Math.abs(door.quaternion.y) > 0.2 || Math.abs(door.rotation.y) > 0.2, 'House door opened');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
