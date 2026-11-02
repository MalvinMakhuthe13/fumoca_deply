import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeDensityField } from '../../js/modules/gaussian-density-bridging.js';

test('bridges a small enclosed cavity with multi-direction support', () => {
  const R = 9;
  const density = new Float32Array(R ** 3);
  const at = (x,y,z) => z*R*R+y*R+x;
  for (let z=2; z<=6; z++) for (let y=2; y<=6; y++) for (let x=2; x<=6; x++) density[at(x,y,z)] = 1;
  density[at(4,4,4)] = 0;
  const source = density.slice();
  const result = bridgeDensityField({ density, resolution:R }, 1);
  assert.ok(result.density[at(4,4,4)] > 0.5);
  assert.equal(density[at(4,4,4)], 0, 'input density must remain unchanged');
  assert.ok(result.densityBridging.bridgedVoxels > 0);
  assert.deepEqual(Array.from(density), Array.from(source));
});

test('does not bridge a gap supported by only one opposing direction', () => {
  const R = 9;
  const density = new Float32Array(R ** 3);
  const at = (x,y,z) => z*R*R+y*R+x;
  density[at(3,4,4)] = 1;
  density[at(5,4,4)] = 1;
  const result = bridgeDensityField({ density, resolution:R }, 2);
  assert.equal(result.density[at(4,4,4)], 0);
  assert.equal(result.densityBridging?.bridgedVoxels || 0, 0);
});

test('zero passes preserve object identity and constant fields remain constant', () => {
  const density = new Float32Array(7 ** 3).fill(0.25);
  const field = { density, resolution:7 };
  assert.equal(bridgeDensityField(field, 0), field);
  const result = bridgeDensityField(field, 1);
  for (const value of result.density) assert.ok(Math.abs(value - 0.25) < 1e-6);
});

test('pass count is bounded and never mutates the source field', () => {
  const R = 7, density = new Float32Array(R ** 3);
  density[(3*R+3)*R+3] = 1;
  const original = density.slice();
  const result = bridgeDensityField({density,resolution:R}, 99);
  assert.equal(result.densityBridging.passes, 3);
  assert.deepEqual(Array.from(density), Array.from(original));
});
