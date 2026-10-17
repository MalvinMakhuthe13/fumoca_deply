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
assert.match(builder, /_encodeCurrentSplatRows\(S, aliveIndices\)/,
  'publish must serialize current edited geometry for every source format');
assert.match(builder, /S\.scaleXYZ\?\./,
  'publish must preserve anisotropic per-axis scale');
assert.match(builder, /S\.rotation/,
  'publish must preserve current Gaussian rotations');
assert.match(builder, /compactGaussianSHSidecar\(/,
  'publish must compact SH coefficients using the same alive-point indices as geometry');
assert.match(builder, /gaussianSH: gaussianSH \|\| undefined/,
  'publish must write the compacted SH sidecar');
assert.match(builder, /_compactLidarAttributes\(S, aliveIndices\)/,
  'publish must compact point-indexed LiDAR attributes');
assert.match(builder, /window\._fumocaSerializeEditorSceneMetadata\?\.\(aliveIndices\)/,
  'publish must write fresh point-indexed Studio layer metadata');
assert.match(builder, /sourceMeta\.gaussian_sh && !gaussianSH/,
  'publish must fail closed if SH metadata exists but coefficients are unavailable');
assert.match(publish, /_buildNifBlob\(\{ title, description, parentMeta: existingMeta \}\)/,
  'published NIF META must merge fresh database metadata, not just title/description');

const editor = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
assert.match(editor, /window\._fumocaSerializeEditorSceneMetadata = serializeEditorSceneMetadata/,
  'Studio must expose the canonical scene manifest serializer to publishing');
console.log('NIF publish geometry, SH/LiDAR alignment, metadata and local passthrough contracts passed.');
