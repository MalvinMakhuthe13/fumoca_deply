import assert from 'node:assert/strict';

globalThis.window = {
  _fumocaLastGaussianBytes: null,
  FumocaSparkGaussian: null,
};

const { getLocalGaussianPreviewBytes } = await import('../js/modules/device-preview-local.js');

const source = new Uint8Array([1, 2, 3, 4]);
const gaussianPly = {
  fileType: 'ply',
  fileName: 'local-car.edited.ply',
  isGaussianPly: true,
  gaussianSourceBytes: source,
};

const local = getLocalGaussianPreviewBytes(gaussianPly);
assert.ok(local, 'a local Gaussian PLY should be previewable');
assert.equal(local.fileName, 'local-car.edited.ply');
assert.equal(local.edited, false);
assert.deepEqual([...local.bytes], [1, 2, 3, 4]);
assert.notEqual(local.bytes, source, 'preview must own a byte copy and not detach/mutate editor data');

assert.equal(
  getLocalGaussianPreviewBytes({ fileType: 'ply', fileName: 'ordinary-cloud.ply', isGaussianPly: false, gaussianSourceBytes: source }),
  null,
  'ordinary point-cloud PLY must not be misrepresented as a Gaussian splat',
);

assert.equal(
  getLocalGaussianPreviewBytes({ fileType: 'ply', fileName: 'missing.ply', isGaussianPly: true }),
  null,
  'a Gaussian PLY without retained source bytes should report unavailable',
);

const editedBytes = new Uint8Array([9, 8, 7]);
let receivedState = null;
window.FumocaSparkGaussian = {
  isEnabled: () => true,
  exportEditedBytes(state) {
    receivedState = state;
    return editedBytes;
  },
};
const edited = getLocalGaussianPreviewBytes(gaussianPly);
assert.equal(edited.edited, true, 'active Spark editor state should be exported for a live local preview');
assert.equal(receivedState, gaussianPly, 'the current Studio state should be passed to the export bridge');
assert.deepEqual([...edited.bytes], [9, 8, 7]);
assert.notEqual(edited.bytes, editedBytes, 'the preview must copy edited bytes');

window.FumocaSparkGaussian = null;
const splat = getLocalGaussianPreviewBytes({
  fileType: 'splat',
  fileName: 'local-scene.splat',
  gaussianSourceBytes: source,
});
assert.ok(splat, 'legacy local SPLAT files should use the same isolated Gaussian preview path');

console.log('Device Preview local Gaussian source tests passed.');
