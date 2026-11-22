/**
 * Light track integration with master.
 * Run: node tests/anim-light-master.test.mjs
 */
import * as THREE from '/tmp/three.esm.js';
globalThis.window = globalThis;
globalThis.THREE = THREE;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { default: Master } = await import('/workspace/artifacts/js/modules/anim-master.js');
const { default: Light } = await import('/workspace/artifacts/js/modules/anim-light.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const light = Light.createLight('key', 'directional');
Light.setLightParams('key', { intensity: 1.0, color: { r: 1, g: 1, b: 1 } });
Light.captureKeyframe('key', 0);
Light.setLightParams('key', { intensity: 0.2, color: { r: 0.2, g: 0.2, b: 0.3 } });
Light.captureKeyframe('key', 2);

const lightData = Light.serialize('key');
Master.addLight(lightData);

const threeLight = new THREE.DirectionalLight(0xffffff, 1);
Master.setLightBinding('key', threeLight);

Master.evaluate(1);
assert(threeLight.intensity > 0.2 && threeLight.intensity < 1.0, 'Intensity applied to Three.js light');
assert(threeLight.color.r > 0.2 && threeLight.color.r < 1, 'Color applied');

const ser = Master.serialize();
assert(Array.isArray(ser.lights) && ser.lights.length === 1, 'Lights serialized');

Master.dispose();
const empty = Master.evaluate(1);
assert(!empty.lights || Object.keys(empty.lights).length === 0, 'Empty after dispose');

// Backward compat: no lights in timeline
Master.setCameraTrack([]);
const noLights = Master.evaluate(0.5);
assert(noLights.camera === null || noLights.camera.cssOnly, 'No camera track safe');
assert(!noLights.lights || Object.keys(noLights.lights).length === 0, 'No light tracks safe');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
