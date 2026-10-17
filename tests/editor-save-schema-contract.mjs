import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
const start = source.indexOf('async function saveLiveEdit');
const end = source.indexOf('// ── Teaser preview modal', start);
assert.ok(start >= 0 && end > start, 'Studio save function must exist');
const save = source.slice(start, end);
assert.ok(save.includes("from('nif_files')"), 'Studio saves must update the deployed NIF row');
assert.match(save, /r2\.from\('nif-files'\)\s*\.upload\(/, 'Studio derivatives must upload to R2');
assert.match(save, /gaussianSH: gaussianSH \|\| undefined/,
  'Studio save must preserve higher-order Gaussian SH coefficients in NIF instead of falling back to lossy PLY');
assert.match(save, /layers: layerData\.layers/,
  'Studio save must re-encode compacted LAYER_GEO membership');
assert.match(source, /0x0009, 0x0015, 0x0019, 0x001A/,
  'Studio passthrough must exclude LAYER_GEO, LiDAR and SH chunks that are rebuilt against current points');
assert.ok(save.includes("r2.from('nif-files').remove([fileKey])"), 'failed registration should attempt derivative cleanup');
assert.ok(!save.includes("from('splats')"), 'Studio must not write to the retired splats table');
assert.ok(!save.includes("storage.from('splat-files')"), 'Studio must not upload to the retired Supabase Storage bucket');
assert.ok(save.includes('Legacy splats/Supabase Storage fallback is disabled'), 'failed NIF saves must fail visibly instead of pretending legacy fallback works');
assert.match(source, /window\._fumocaLoadedFromRecord === false \? null : \(params\.get\('splatId'\)/,
  'local imports must not accidentally save over a previously selected database record');
assert.match(source, /window\._fumocaLoadedFromRecord = !!urlOverride/,
  'opening a local file must detach the current record while remote record opens retain ownership context');
assert.match(source, /window\._fumocanifUrl = urlOverride \|\| ''[\s\S]*?window\._fumocaNifUrl = urlOverride \|\| ''/,
  'local file opens must clear stale viewer URLs before publish passthrough selection');
assert.match(source, /window\._fumocaCurrentRecord = \{ \.\.\.\(window\._fumocaCurrentRecord \|\| \{\}\), \.\.\.data \};/,
  'bootstrap must prefer fresh database fields over stale in-memory NIF state');
assert.match(source, /if \(source\.r2_key\)[\s\S]*?authenticatedUrl\(source\.r2_key\)/,
  'private original source files must be opened through an authorized R2 read ticket');
assert.match(source, /source\.r2_key\.startsWith\('raw\/'\) \? 'nif-videos' : 'nif-files'/,
  'legacy photo-burst source links must use the correct R2 bucket');
const preserveStart = source.indexOf('window.preserveImportedLidarSource = async');
const preserveEnd = source.indexOf('let _solidMeshPreviewObject', preserveStart);
assert.ok(preserveStart >= 0 && preserveEnd > preserveStart, 'original source preservation function must exist');
const preserve = source.slice(preserveStart, preserveEnd);
assert.match(preserve, /select\('meta'\)\.eq\('id', record\.id\)\.eq\('user_id', user\.id\)\.single\(\)/,
  'original source linking must merge into fresh parent metadata');
assert.match(preserve, /r2\.from\('nif-files'\)\.remove\(\[fileKey\]\)/,
  'failed source metadata linking must clean up the uploaded source object');
const legacyEditor = await readFile(new URL('../js/modules/splat-edit-engine.js', import.meta.url), 'utf8');
assert.match(legacyEditor, /const path=\`\$\{splatId\}\/edited_cleaned_\$\{Date\.now\(\)\}\.splat\`;/,
  'cleaned splat derivatives must use the record-scoped edited_ key accepted by the R2 ownership guard');
assert.match(legacyEditor, /higher_order_sh_not_representable_in_32_byte_splat/, 'SPLAT exports must disclose higher-order SH loss');
assert.match(legacyEditor, /\.\.\.parentMeta/, 'saving a SPLAT derivative must preserve the original NIF SH sidecar metadata');
const editEngine = await readFile(new URL('../js/modules/edit-engine.js', import.meta.url), 'utf8');
assert.match(editEngine, /select\('id,user_id,title,description,r2_key,is_public,meta'\)[\s\S]*?\.eq\('id', rec\.id\)\.eq\('user_id', rec\.user_id\)\.single\(\)/,
  'fallback edit-engine saves must reload current owner-scoped NIF metadata');
const feedSource = await readFile(new URL('../js/modules/feed.js', import.meta.url), 'utf8');
const liveSaveStart = feedSource.indexOf('window.saveLiveEdit = async function(recipeDelta)');
const liveSaveEnd = feedSource.indexOf('\n};', liveSaveStart);
assert.ok(liveSaveStart >= 0 && liveSaveEnd > liveSaveStart, 'global live-edit save helper must exist');
const liveSave = feedSource.slice(liveSaveStart, liveSaveEnd);
assert.match(liveSave, /select\('id,user_id,title,description,r2_key,is_public,meta'\)/,
  'live edits must reload the current NIF row before merging metadata');
assert.match(liveSave, /update\(\{ meta: nextMeta \}\)/,
  'live edits must persist to the deployed meta JSON column');
assert.doesNotMatch(liveSave, /payload\.nif_url|update\(payload\)/,
  'live edits must not write phantom top-level edit_recipe, nif_url or last_edited_at columns');

console.log('Studio save schema and failure contract passed.');
