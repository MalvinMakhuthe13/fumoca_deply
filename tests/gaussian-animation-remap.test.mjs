import assert from 'node:assert/strict';
import { remapGaussianAnimation } from '../js/modules/gaussian-animation-remap.js';
import { encodeGaussianAnimationChunk, CHUNK } from '../engine-next/format/NIFSpec.js';

const source = {
  schema: 'fumoca.gaussian-animation',
  version: 1,
  duration: 2,
  gaussianIds: [100, 200, 300, 400],
  tracks: [
    { id: 100, keyframes: [{ time: 0, position: [0, 0, 0] }] },
    { id: 200, keyframes: [{ time: 0, position: [1, 0, 0] }] },
    { id: 400, keyframes: [{ time: 0, position: [3, 0, 0] }] },
  ],
};

const compacted = remapGaussianAnimation(source, [0, 2, 3], 4);
assert.deepEqual(compacted.gaussianIds, [100, 300, 400]);
assert.deepEqual(compacted.tracks.map(t => t.id), [100, 400]);
assert.equal(compacted.duration, 2);
assert.equal(encodeGaussianAnimationChunk(compacted).type, CHUNK.GAUSSIAN_ANIMATION);

const extended = remapGaussianAnimation({
  ...source,
  gaussianIds: [7, 11],
  tracks: [{ id: 7, keyframes: [{ time: 0, position: [0, 0, 0] }] }],
}, [0, 2], 3);
assert.deepEqual(extended.gaussianIds, [7, 12], 'new splats receive a fresh stable ID');
assert.deepEqual(extended.tracks.map(t => t.id), [7], 'new splats are not assigned old tracks');

assert.throws(() => remapGaussianAnimation(source, [0, 0], 4), /unique, ascending/);
assert.throws(() => remapGaussianAnimation(source, [4], 4), /within the current geometry/);
assert.throws(() => remapGaussianAnimation(source, [0], 2), /do not match the current geometry/);
assert.throws(() => remapGaussianAnimation({ ...source, gaussianIds: [1, 1] }, [0], 2), /duplicate stable/);
console.log('Gaussian animation stable-ID remap tests passed.');
