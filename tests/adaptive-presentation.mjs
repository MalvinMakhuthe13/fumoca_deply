import assert from 'node:assert/strict';

const events = [];
const host = {
  style: {},
  getBoundingClientRect: () => ({ width: 400, height: 900 }),
  querySelectorAll: () => [],
};
const stage = { getBoundingClientRect: () => ({ width: 400, height: 900 }) };
const camera = {
  fov: 50,
  aspect: 1,
  position: {
    x: 0, y: 0, z: 10,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  },
  updateProjectionMatrix() {},
  updateMatrixWorld() {},
  lookAt() {},
};
const controls = {
  target: {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  },
  update() {},
};

globalThis.document = {
  getElementById(id) {
    return id === 'stageHost' ? host : id === 'stage' ? stage : null;
  },
};
globalThis.window = {
  location: { search: '?embed=1' },
  _fumocaViewerCamera: camera,
  _fumocaViewerControls: controls,
  addEventListener() {},
  dispatchEvent(event) { events.push(event); },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.requestAnimationFrame = () => 1;

await import('../js/modules/adaptive-presentation.js');

const ape = window.FumocaPresentation;
assert.ok(ape, 'Adaptive Presentation Engine API should be exposed');
ape.refresh();
let state = ape.getState();
assert.equal(state.mode, 'embed');
assert.equal(state.width, 400);
assert.equal(state.height, 900);
assert.ok(Math.abs(state.aspect - (4 / 9)) < 1e-9);
assert.ok(Math.abs(camera.aspect - (4 / 9)) < 1e-9);

assert.equal(ape.setProfile('automotive').name, 'automotive');
assert.equal(ape.setProfile('not-a-profile').name, 'default');
ape.setProfile('product');

const before = {
  x: camera.position.x - 1,
  y: camera.position.y - 2,
  z: camera.position.z - 3,
};
const beforeLength = Math.hypot(before.x, before.y, before.z);
assert.equal(ape.fitSphere({ x: 1, y: 2, z: 3 }, 2), true);
assert.deepEqual(
  { x: controls.target.x, y: controls.target.y, z: controls.target.z },
  { x: 1, y: 2, z: 3 },
);
const afterLength = Math.hypot(
  camera.position.x - 1,
  camera.position.y - 2,
  camera.position.z - 3,
);
const limitingFov = 2 * Math.atan(Math.tan((50 * Math.PI / 180) / 2) * (4 / 9));
const expectedDistance = (2 / Math.sin(limitingFov / 2)) * 1.12;
assert.ok(Math.abs(afterLength - expectedDistance) < 1e-8, 'Portrait framing should use the limiting horizontal FOV');
assert.ok(Math.abs(afterLength - beforeLength) > 1, 'fitSphere should change the camera distance');
assert.ok(events.some((event) => event.type === 'fumoca:presentationResize'));
assert.ok(events.some((event) => event.type === 'fumoca:presentationFramed'));

console.log('Adaptive Presentation Engine tests passed.');
