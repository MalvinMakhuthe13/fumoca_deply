/**
 * Lighting data model tests.
 * Run: node tests/anim-light.test.mjs
 */
globalThis.window = globalThis;
globalThis.THREE = { Quaternion: class {}, Vector3: class {} };

const { default: Light } = await import('../js/modules/anim-light.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const dir = Light.createLight('key', 'directional', 'Key');
assert(dir.type === 'directional', 'Directional created');

Light.setLightParams('key', { position: { x: 2, y: 4, z: 1 }, intensity: 1.4, color: { r: 1, g: 0.9, b: 0.8 } });
assert(dir.position.x === 2 && dir.intensity === 1.4, 'Params set');

Light.setShadowParams('key', { enabled: true, mapSize: 2048 });
assert(dir.shadow.enabled === true, 'Shadow params set');

Light.captureKeyframe('key', 0);
Light.setLightParams('key', { intensity: 0.2, color: { r: 0.2, g: 0.2, b: 0.3 } });
Light.captureKeyframe('key', 2);

const mid = Light.evaluate('key', 1);
assert(mid.intensity > 0.2 && mid.intensity < 1.4, 'Intensity interpolates');
assert(mid.color.r > 0.2 && mid.color.r < 1, 'Color interpolates');

const ser = Light.serialize('key');
assert(ser && ser.tracks.length === 2, 'Serialize complete');

Light.dispose();
const loaded = Light.deserialize(ser);
assert(loaded && loaded.id === 'key', 'Deserialize restores');

// No renderer: mesh lighting must be false
const capsNone = Light.getCapabilities();
assert(capsNone.meshLighting === false, 'No renderer: meshLighting false');
assert(capsNone.splatRelighting === false, 'Splat relighting always false');
assert(capsNone.contactShadows === false, 'Contact shadows not implemented');
assert(capsNone.areaLights === false, 'Area lights not supported');

// With renderer mock
window.renderer = { render() {}, shadowMap: { enabled: true } };
const capsOn = Light.getCapabilities();
assert(capsOn.meshLighting === true, 'With renderer: meshLighting true');
assert(capsOn.meshShadows === true, 'With shadowMap: meshShadows true');

const point = Light.createLight('fill', 'point');
assert(point.type === 'point', 'Point light created');
const spot = Light.createLight('rim', 'spot');
assert(spot.type === 'spot', 'Spot light created');
const amb = Light.createLight('amb', 'ambient');
assert(amb.type === 'ambient', 'Ambient created');
const hemi = Light.createLight('hemi', 'hemisphere');
assert(hemi.type === 'hemisphere', 'Hemisphere created');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
