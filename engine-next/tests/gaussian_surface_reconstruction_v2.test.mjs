import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { autoTuneThreshold, buildDensityField } = await import('../../js/modules/fumoc-mesh-extractor.js');

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
    N: 1,
    posX: new Float32Array([0]), posY: new Float32Array([0]), posZ: new Float32Array([0]),
    sclX: new Float32Array([Math.log(0.18)]), sclY: new Float32Array([Math.log(0.08)]), sclZ: new Float32Array([Math.log(0.12)]),
    rotW: new Float32Array([Math.SQRT1_2 * qScale]), rotX: new Float32Array([0]),
    rotY: new Float32Array([0]), rotZ: new Float32Array([Math.SQRT1_2 * qScale]),
    colA: new Float32Array([255]),
  });
  const a = await buildDensityField(makeGaussian(1), { resolution: 18, sigmaScale: 1.2 });
  const b = await buildDensityField(makeGaussian(3.7), { resolution: 18, sigmaScale: 1.2 });
  assert.equal(a.density.length, b.density.length);
  for (let i = 0; i < a.density.length; i++) assert.ok(Math.abs(a.density[i] - b.density[i]) < 1e-5);
});
