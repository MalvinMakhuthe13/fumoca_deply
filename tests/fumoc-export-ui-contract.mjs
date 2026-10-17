import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/fumoc-export-ui.js', import.meta.url), 'utf8');
assert.match(source, /r2\.from\('nif-files'\)\.authenticatedUrl\(record\.r2_key\)/,
  'private viewer exports must use a fresh read ticket for the current NIF key');
assert.match(source, /const isNif = name\.endsWith\('\.nif'\)/,
  'viewer export must distinguish NIF bytes from legacy SPLAT rows');
assert.match(source, /nifBuffer = sourceBuffer/,
  'viewer export of an existing NIF must preserve the complete source bytes and unknown chunks');
assert.match(source, /sourceBytes\.byteLength % 32 !== 0/,
  'SPLAT conversion must reject truncated or non-record-aligned buffers');
assert.match(source, /compactGaussianSHSidecar\(/,
  'live editor export must preserve and compact SH coefficients');
assert.match(source, /layers: layerData\.layers/,
  'live editor export must rebuild point-indexed LAYER_GEO chunks');
assert.match(source, /chunk\.type === CHUNK\.KEYFRAME_MESH && S\.nifMesh/,
  'viewer export must preserve undecoded raw mesh chunks');
assert.match(source, /\.\.\.\(S\.nifMesh \? \{ mesh: S\.nifMesh \} : \{\}\)/,
  'viewer export must only replace raw mesh data when a decoded mesh is available');
assert.match(source, /record\?\.meta/,
  'viewer export must use the deployed nif_files.meta field');
assert.doesNotMatch(source, /record\?\.metadata/,
  'viewer export must not read the retired metadata column');
assert.doesNotMatch(source, /ratioMap|data-q="high"|data-q="medium"|data-q="low"/,
  'UI must not advertise compression presets that do not change encoding');
assert.doesNotMatch(source, /fumoc-draco-encoder|fepMeshCheck/,
  'UI must not imply it generates a new Draco mesh when it does not');
assert.match(source, /Actual size measured after export/,
  'estimated output size must be described honestly until measured');
assert.match(source, /legacy_layer_geo_dropped_no_indices/,
  'viewer export must disclose when legacy layer data cannot be safely reindexed');
assert.match(source, /encBtn\.disabled = false;\s*dlBtn\.disabled = false/,
  'export panel must remain reusable after a successful export');
console.log('Viewer NIF export source selection, authorization, metadata and sidecar contracts passed.');
