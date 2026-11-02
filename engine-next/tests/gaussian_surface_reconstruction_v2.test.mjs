import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { default: FumocMeshExtractor } = await import('../../js/modules/fumoc-mesh-extractor.js');
const { autoTuneThreshold, buildDensityField } = FumocMeshExtractor;

test('auto threshold is positive, bounded and scale invariant', () => {
  const density = new Float32Array(1000);
  for (let i = 0; i < density.length; i++) density[i] = i < 100 ? 0 : (i - 99) / 900;
  const threshold = autoTuneThreshold(density);
  const scaled = Float32Array.from(density, value => value * 7.5);
  const scaledThreshold = autoTuneThreshold(scaled);
  assert.ok(threshold >= 0.12);
  assert.ok(threshold <= 0.38);
  assert.ok(Math.abs(scaledThreshold / 7.5 - threshold) < 0.003);
});

test('auto threshold does not follow a tiny low-density tail', () => {
  const density = new Float32Array(1000);
  for (let i = 0; i < 850; i++) density[i] = 0.001 + (i % 100) * 0.0001;
  for (let i = 850; i < 1000; i++) density[i] = 0.5 + (i - 850) * 0.003;
  const threshold = autoTuneThreshold(density);
  assert.ok(threshold >= 0.06, `unexpectedly low threshold: ${threshold}`);
});

test('non-unit Gaussian quaternions produce the same density as normalized quaternions', async () => {
  const makeGaussian = (qScale) => ({
    N: 2,
    posX: new Float32Array([-0.1, 0.1]), posY: new Float32Array([0, 0]), posZ: new Float32Array([0, 0]),
    sclX: new Float32Array([Math.log(0.18), Math.log(0.18)]), sclY: new Float32Array([Math.log(0.08), Math.log(0.08)]), sclZ: new Float32Array([Math.log(0.12), Math.log(0.12)]),
    rotW: new Float32Array([Math.SQRT1_2 * qScale, Math.SQRT1_2 * qScale]), rotX: new Float32Array([0, 0]),
    rotY: new Float32Array([0, 0]), rotZ: new Float32Array([Math.SQRT1_2 * qScale, Math.SQRT1_2 * qScale]),
    colA: new Float32Array([255, 255]),
  });
  const a = await buildDensityField(makeGaussian(1), { resolution: 18, sigmaScale: 1.2 });
  const b = await buildDensityField(makeGaussian(3.7), { resolution: 18, sigmaScale: 1.2 });
  assert.equal(a.density.length, b.density.length);
  for (let i = 0; i < a.density.length; i++) assert.ok(Math.abs(a.density[i] - b.density[i]) < 1e-5);
});


test('anisotropic density follows the renderer forward quaternion orientation', async () => {
  const q = { w: 0.72, x: 0.21, y: 0.43, z: 0.49 };
  const qn = Math.hypot(q.w, q.x, q.y, q.z);
  for (const k of ['w', 'x', 'y', 'z']) q[k] /= qn;
  const rotate = (v, inverse = false) => {
    const x = inverse ? -q.x : q.x;
    const y = inverse ? -q.y : q.y;
    const z = inverse ? -q.z : q.z;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return {
      x: v.x - q.w * tx + (y * tz - z * ty),
      y: v.y - q.w * ty + (z * tx - x * tz),
      z: v.z - q.w * tz + (x * ty - y * tx),
    };
  };
  const field = await buildDensityField({
    N: 1,
    posX: new Float32Array([0]), posY: new Float32Array([0]), posZ: new Float32Array([0]),
    sclX: new Float32Array([Math.log(0.22)]),
    sclY: new Float32Array([Math.log(0.07)]),
    sclZ: new Float32Array([Math.log(0.05)]),
    rotW: new Float32Array([q.w]), rotX: new Float32Array([q.x]),
    rotY: new Float32Array([q.y]), rotZ: new Float32Array([q.z]),
    colA: new Float32Array([255]),
  }, {
    resolution: 64,
    sigmaScale: 1,
    bounds: { min: { x: -0.4, y: -0.4, z: -0.4 }, max: { x: 0.4, y: 0.4, z: 0.4 } },
  });
  const sample = (direction) => {
    const step = 0.16;
    const x = direction.x * step, y = direction.y * step, z = direction.z * step;
    const ix = Math.max(0, Math.min(63, Math.round((x - field.bounds.min.x) / field.voxelSize)));
    const iy = Math.max(0, Math.min(63, Math.round((y - field.bounds.min.y) / field.voxelSize)));
    const iz = Math.max(0, Math.min(63, Math.round((z - field.bounds.min.z) / field.voxelSize)));
    return field.density[iz * 64 * 64 + iy * 64 + ix];
  };
  const rendererMajorAxis = rotate({ x: 1, y: 0, z: 0 });
  const mirroredMajorAxis = rotate({ x: 1, y: 0, z: 0 }, true);
  assert.ok(
    sample(rendererMajorAxis) > sample(mirroredMajorAxis) * 1.5,
    'mesh density must follow the renderer orientation, not its mirrored inverse',
  );
});
