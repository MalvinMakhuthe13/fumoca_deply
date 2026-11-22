/**
 * Real GLB files through the binder and the universal toggle.
 * Run: node tests/anim-glb-real.test.mjs
 */
globalThis.window = globalThis;
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

import { Blob } from 'buffer';
globalThis.Blob = Blob;
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL() { this.result = 'data:application/octet-stream;base64,'; this.onloadend?.(); }
};
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL as toURL } from 'url';
const require = createRequire('/workspace/artifacts/package.json');
const THREE = await import(pathToFileURL(require.resolve('three')).href);
const { GLTFExporter } = await import(pathToFileURL(require.resolve('three/examples/jsm/exporters/GLTFExporter.js')).href);
const { GLTFLoader } = await import(pathToFileURL(require.resolve('three/examples/jsm/loaders/GLTFLoader.js')).href);
globalThis.THREE = THREE;
await import('../js/modules/anim-joint-eval.js');
await import('../js/modules/anim-object.js');
await import('../js/modules/anim-master.js');
await import('../js/modules/anim-studio-init.js');
await import('../js/modules/anim-afford.js');
const { default: Bind } = await import('../js/modules/anim-glb-bind.js');
const { default: Prep } = await import('../js/modules/anim-prep.js');
const { default: Live } = await import('../js/modules/anim-live.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

function makeCar() {
  const root = new THREE.Group(); root.name = 'Car';
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  body.name = 'Body';
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0xc8ff00 }));
  door.name = 'DoorFL';
  door.position.set(0.9, 0.2, 0.4);
  body.add(door);
  root.add(body);
  return root;
}

const exporter = new GLTFExporter();
const dir = mkdtempSync(join(tmpdir(), 'fumoca-glb-'));
const glbPath = join(dir, 'car.glb');
const arrayBuffer = await exporter.parseAsync(makeCar(), { binary: true });
writeFileSync(glbPath, Buffer.from(arrayBuffer));
assert(arrayBuffer.byteLength > 100, 'Wrote a real GLB');

const loader = new GLTFLoader();
const glbBytes = await import('fs').then(fs => fs.readFileSync(glbPath));
const gltf = await new Promise((resolve, reject) => loader.parse(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength), '', resolve, reject));
const bound = Bind.bindFromScene(gltf.scene, { objectId: 'car_glb', name: 'Car' });
assert(bound.ok && bound.bound >= 2, 'Binder registered the loaded GLB');

const door = window.FumocaObjectAnim.get('car_glb').components.find(c => c.name === 'DoorFL');
assert(door, 'DoorFL survived the GLB round trip');
const prep = Prep.prepare('car_glb', [{ name: 'DoorFL', kind: 'hinge', axis: { x: 0, y: 1, z: 0 }, limits: { min: 0, max: 1.2 } }]);
assert(prep.ok, 'Founder prep applied');
const saved = Prep.exportPrep('car_glb');
assert(saved.prep?.version === 1, 'Prep metadata saved on the object');

window.scene = gltf.scene;
const aff = window.FumocaAfford.affordances(window.FumocaObjectAnim.get('car_glb'));
assert(aff.some(a => a.affordance === 'door'), 'Loaded GLB door classified as a door');
const toggled = Live.toggle('car_glb', door.id);
assert(toggled.ok && toggled.open, 'Same toggle opens a GLB door');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
