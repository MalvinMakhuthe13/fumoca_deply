import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
const start = source.indexOf('async function saveLiveEdit');
const end = source.indexOf('// ── Teaser preview modal', start);
assert.ok(start >= 0 && end > start, 'Studio save function must exist');
const save = source.slice(start, end);
assert.ok(save.includes("from('nif_files')"), 'Studio saves must update the deployed NIF row');
assert.match(save, /r2\.from\('nif-files'\)\s*\.upload\(/, 'Studio derivatives must upload to R2');
assert.ok(save.includes("r2.from('nif-files').remove([fileKey])"), 'failed registration should attempt derivative cleanup');
assert.ok(!save.includes("from('splats')"), 'Studio must not write to the retired splats table');
assert.ok(!save.includes("storage.from('splat-files')"), 'Studio must not upload to the retired Supabase Storage bucket');
assert.ok(save.includes('Legacy splats/Supabase Storage fallback is disabled'), 'failed NIF saves must fail visibly instead of pretending legacy fallback works');
assert.match(source, /window\._fumocaCurrentRecord = \{ \.\.\.\(window\._fumocaCurrentRecord \|\| \{\}\), \.\.\.data \};/,
  'bootstrap must prefer fresh database fields over stale in-memory NIF state');
assert.match(source, /if \(source\.r2_key\)[\s\S]*?authenticatedUrl\(source\.r2_key\)/,
  'private original source files must be opened through an authorized R2 read ticket');
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
console.log('Studio save schema and failure contract passed.');
