import assert from 'node:assert/strict';
import {
  chooseRenderMode, solidPointScale, floaterMask, recoverWash,
  uprightFromEdge, applyRotation, viewPose, sceneRadius, sceneCenter,
  pickNearest, formatDistance, insideCrop,
} from '../js/modules/industry-math.js';

const n = 1000;
const cloud = {
  N: n,
  posX: new Float32Array(n), posY: new Float32Array(n), posZ: new Float32Array(n),
  sclX: new Float32Array(n), sclY: new Float32Array(n), sclZ: new Float32Array(n),
  colA: new Uint8Array(n),
};
for (let i = 0; i < n; i++) {
  cloud.posX[i] = (i % 10) * 0.1;
  cloud.posY[i] = Math.floor(i / 10) % 10 * 0.1;
  cloud.posZ[i] = Math.floor(i / 100) * 0.1;
  cloud.sclX[i] = cloud.sclY[i] = cloud.sclZ[i] = 0.01;
  cloud.colA[i] = 255;
}
assert.equal(chooseRenderMode(cloud), 'points');
assert.ok(solidPointScale(cloud) > 0.01);

const trained = {
  N: 4,
  posX: Float32Array.of(0, 1, 0, 0),
  posY: Float32Array.of(0, 0, 1, 0),
  posZ: Float32Array.of(0, 0, 0, 1),
  sclX: Float32Array.of(0.02, 0.2, 0.05, 0.01),
  sclY: Float32Array.of(0.2, 0.02, 0.05, 0.08),
  sclZ: Float32Array.of(0.05, 0.05, 0.3, 0.02),
};
assert.equal(chooseRenderMode(trained), 'splats');

cloud.posX[0] = 50; cloud.posY[0] = 50; cloud.posZ[0] = 50; cloud.colA[0] = 10;
const mask = floaterMask(cloud);
assert.equal(mask[0], 0);
assert.equal(mask[1], 1);

const grey = new Float32Array([0.5, 0.5, 0.5, 0.4, 0.42, 0.4]);
const fixed = recoverWash(grey);
assert.ok(fixed !== grey);
assert.ok(fixed[0] >= 0 && fixed[0] <= 1);

const rot = uprightFromEdge([0, 0, 0], [1, 0, 0]);
const up = applyRotation(new Float32Array([1, 0, 0]), rot, [0, 0, 0]);
assert.ok(Math.abs(up[1] - 1) < 1e-6, 'edge maps onto +Y');
assert.ok(Math.abs(up[0]) < 1e-6);

const pose = viewPose('top', [0, 0, 0], sceneRadius(cloud));
assert.ok(pose.position[1] > pose.target[1]);

const look = { N: 2, posX: Float32Array.of(0, 5), posY: Float32Array.of(0, 0), posZ: Float32Array.of(0, 0),
  sclX: Float32Array.of(1, 1), sclY: Float32Array.of(1, 1), sclZ: Float32Array.of(1, 1) };
const hit = pickNearest(look, [0, 0, 2], [0, 0, -1]);
assert.equal(hit.index, 0);
assert.equal(pickNearest(look, [0, 0, 2], [0, 1, 0]), null);
const far = formatDistance({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 0.5);
assert.equal(far.label, '1.00 m');
const loose = formatDistance({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
assert.match(loose.label, /scene units/);
const c = sceneCenter(cloud);
assert.equal(insideCrop(c[0], c[1], c[2], c, 1, 0.5), true);
assert.equal(insideCrop(c[0] + 9, c[1], c[2], c, 1, 0.5), false);

console.log('industry-math: render mode, floaters, colour, upright, views, pick, measure, crop ok');
