import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGaussianSourceSignature,
  compareGaussianSourceSignature,
} from '../../js/modules/dual-surface-contract.js';

function fixture() {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0]),
    alive: new Uint8Array([1, 1]),
    scaleXYZ: new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
    rotation: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
    opacity: new Float32Array([1, 0.8]),
    colors: new Float32Array([1, 0, 0, 0, 1, 0]),
    paintColors: new Float32Array([-1, -1, -1, -1, -1, -1]),
  };
}

test('Gaussian source signature is deterministic', () => {
  const state = fixture();
  assert.equal(computeGaussianSourceSignature(state), computeGaussianSourceSignature(state));
});

test('unchanged Gaussian source remains paired with its mesh', () => {
  const state = fixture();
  const signature = computeGaussianSourceSignature(state);
  assert.equal(compareGaussianSourceSignature(state, signature).ok, true);
});

test('position, visibility, scale, rotation, opacity and color edits invalidate a derived mesh', () => {
  for (const key of ['positions', 'alive', 'scaleXYZ', 'rotation', 'opacity', 'colors', 'paintColors']) {
    const state = fixture();
    const signature = computeGaussianSourceSignature(state);
    state[key][0] = state[key][0] + 0.25;
    assert.equal(compareGaussianSourceSignature(state, signature).ok, false, key);
  }
});

test('missing source data or missing signature fails closed', () => {
  assert.equal(computeGaussianSourceSignature({ positions: [], alive: [] }), null);
  assert.equal(compareGaussianSourceSignature(fixture(), null).ok, false);
});
