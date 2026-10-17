import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publish = await readFile(new URL('../js/modules/publish-to-fumoca.js', import.meta.url), 'utf8');
const builderStart = publish.indexOf('async function _buildNifBlob');
const builderEnd = publish.indexOf('\n  // ── Main publish function', builderStart);
assert.ok(builderStart >= 0 && builderEnd > builderStart, 'canonical NIF builder must exist');
const builder = publish.slice(builderStart, builderEnd);
assert.match(publish, /CHUNK\.GAUSSIAN_SH, CHUNK\.LIDAR_ATTR/,
  'source SH and LiDAR chunks must not be blindly passed through after point filtering');
assert.match(publish, /window\.S\?\.nifPassthroughChunks/,
  'local NIF imports must retain safe passthrough chunks when no fetchable URL exists');
assert.match(publish, /window\._fumocanifUrl \|\| window\._fumocaNifUrl/,
  'publish must resolve the same canonical NIF URL exposed by the viewer and hotspot modules');
assert.match(publish, /window\._fumocaLoadedFromRecord === false\s*\? ''/,
  'local file imports must not reuse the stale file query parameter for passthrough');
assert.match(publish, /CHUNK\.KEYFRAME_MESH, CHUNK\.GAUSSIAN_SH, CHUNK\.LIDAR_ATTR/,
  'mesh and point-indexed sidecars must be rebuilt rather than duplicated as passthrough');
assert.match(builder, /encodeEditorSplatRows\(S, aliveIndices\)/,
  'publish must serialize current edited geometry for every source format');
assert.match(publish, /import \{ encodeEditorSplatRows \} from '\.\/editor-splat-rows\.js';/,
  'publish must use the separately tested live-geometry encoder');
assert.match(builder, /compactGaussianSHSidecar\(/,
  'publish must compact SH coefficients using the same alive-point indices as geometry');
assert.match(builder, /gaussianSH: gaussianSH \|\| undefined/,
  'publish must write the compacted SH sidecar');
assert.match(builder, /_compactLidarAttributes\(S, aliveIndices\)/,
  'publish must compact point-indexed LiDAR attributes');
assert.match(builder, /thumbnailBytes: S\.nifThumbnailBytes \|\| undefined/,
  'publish must preserve the current NIF thumbnail');
assert.match(builder, /mesh: S\.nifMesh \|\| undefined/,
  'publish must re-encode the current mesh without duplicating its chunk');
assert.match(builder, /window\._fumocaSerializeEditorSceneMetadata\?\.\(aliveIndices\)/,
  'publish must write fresh point-indexed Studio layer metadata');
assert.match(builder, /sourceMeta\.gaussian_sh && !gaussianSH/,
  'publish must fail closed if SH metadata exists but coefficients are unavailable');
assert.match(publish, /_buildNifBlob\(\{ title, description, parentMeta: existingMeta \}\)/,
  'published NIF META must merge fresh database metadata, not just title/description');
assert.match(publish, /window\._fumocaLoadedFromRecord === false[\s\S]*?null/,
  'publishing a local file must create a new NIF rather than overwrite the prior URL record');
assert.match(publish, /if \(uploadError \|\| !fileKey \|\| !publicUrl\)/,
  'publishing must fail if storage returns an incomplete upload result');

const editor = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
assert.match(editor, /window\._fumocaSerializeEditorSceneMetadata = serializeEditorSceneMetadata/,
  'Studio must expose the canonical scene manifest serializer to publishing');
assert.match(editor, /S\.nifVertical = decoded\.reader\.header\?\.vertical \|\| 'generic'/,
  'Studio must retain the NIF header vertical when a local file is opened');
console.log('NIF publish geometry, SH/LiDAR alignment, metadata and local passthrough contracts passed.');
