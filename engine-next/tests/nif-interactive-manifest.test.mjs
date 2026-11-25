import assert from 'node:assert/strict';
import {
  CHUNK,
  NIFReader,
  NIFWriter,
} from '../format/NIFSpec.js';
import {
  createInteractiveManifest,
  validateInteractiveManifest,
  encodeInteractiveChunk,
  decodeInteractiveChunk,
} from '../format/NIFInteractiveSpec.js';

const manifest = createInteractiveManifest('cola-product-demo', {
  units: 'unknown',
  upAxis: 'Y',
  handedness: 'right',
  calibrationStatus: 'unknown',
});

manifest.assets.push(
  { id: 'product-glb', storageKey: 'interactive/cola/product.glb', mimeType: 'model/gltf-binary' },
  { id: 'cap-audio', storageKey: 'interactive/cola/cap-open.ogg', mimeType: 'audio/ogg' },
);
manifest.objects.push(
  {
    id: 'bottle',
    assetId: 'product-glb',
    nodePath: 'Bottle',
    role: 'bottle-body',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    collision: { type: 'mesh' },
  },
  {
    id: 'cap',
    assetId: 'product-glb',
    nodePath: 'Cap',
    parentObjectId: 'bottle',
    role: 'bottle-cap',
    transform: { position: [0, 0.12, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    collision: { type: 'capsule' },
  },
);
manifest.zones.push({
  id: 'cap-grip',
  shape: 'sphere',
  objectId: 'cap',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  radius: 0.04,
});
manifest.animations.push({
  id: 'unscrew-cap',
  objectId: 'cap',
  kind: 'gltf_clip',
  clipName: 'UnscrewCap',
  durationMs: 900,
});
manifest.interactions.push({
  id: 'open-bottle',
  sourceObjectId: 'cap',
  event: 'tap',
  targetZoneId: 'cap-grip',
  actions: [
    { type: 'play_animation', animationId: 'unscrew-cap' },
    { type: 'play_audio', assetId: 'cap-audio', volume: 0.7 },
  ],
});

assert.deepEqual(validateInteractiveManifest(manifest), { valid: true, errors: [] });

const chunk = encodeInteractiveChunk(manifest);
assert.equal(chunk.type, CHUNK.INTERACTION);
assert.equal(chunk.codec, 0);

const bytes = new NIFWriter().add(chunk.type, chunk.data, chunk.codec).build();
const reader = new NIFReader(bytes);
assert.equal(reader.errors.length, 0);
const decoded = await decodeInteractiveChunk(reader.chunks.find(c => c.type === CHUNK.INTERACTION));
assert.deepEqual(decoded, manifest);

const traversal = structuredClone(manifest);
traversal.assets[0].storageKey = 'interactive/../../private.glb';
assert.equal(validateInteractiveManifest(traversal).valid, false);

const executable = structuredClone(manifest);
executable.interactions[0].actions[0].script = 'alert(1)';
assert.equal(validateInteractiveManifest(executable).valid, false);

const brokenReference = structuredClone(manifest);
brokenReference.interactions[0].actions[0].animationId = 'missing-animation';
assert.equal(validateInteractiveManifest(brokenReference).valid, false);

console.log('PASS NIF INTERACTION manifest validation, encode/decode round-trip, and unsafe-input rejection');
