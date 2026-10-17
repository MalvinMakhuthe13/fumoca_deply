import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/upload-page.js', import.meta.url), 'utf8');
const start = source.indexOf('function baseNifPayload(');
const end = source.indexOf('\nasync function createExternalNif', start);
assert.ok(start >= 0 && end > start, 'baseNifPayload must exist');
const base = source.slice(start, end);
for (const column of ['user_id', 'title', 'description', 'vertical', 'tags', 'is_public', 'meta']) {
  assert.match(base, new RegExp('\\b' + column + '\\s*(?::|,)'), `base NIF payload must use deployed column ${column}`);
}
for (const legacyColumn of ['category', 'visibility', 'status', 'processing_stage', 'processing_progress', 'nif_url', 'external_nif_url', 'provider_name']) {
  assert.doesNotMatch(base, new RegExp('\\b' + legacyColumn + '\\s*:'), `legacy field ${legacyColumn} belongs in meta, not as a nif_files column`);
}
assert.match(base, /is_public: visibility === 'public'/, 'publication must persist to is_public');
const directStart = source.indexOf("const { data: nif, error: dbErr } = await supabase.from('nif_files').insert([");
const directEnd = source.indexOf("}]).select().single();", directStart);
assert.ok(directStart >= 0 && directEnd > directStart, 'direct NIF/CPU conversion insert must exist');
assert.match(source.slice(directStart, directEnd), /is_public: visibility === 'public'/,
  'direct NIF, SPLAT-to-NIF and PLY-to-NIF imports must honor the selected visibility');
assert.match(source, /const zipPath = `\$\{user\.id\}\/raw\/\$\{Date\.now\(\)\}_burst\.zip`/,
  'photo-burst source uploads must use the owner prefix required by R2 write authorization');
assert.match(source, /source_capture: \{ r2_key: fileKey, r2_bucket: 'nif-videos'/,
  'photo-burst source metadata must record the actual R2 bucket');
assert.match(source, /source_capture: \{ r2_key: sourceKey, r2_bucket: 'nif-files'/,
  'direct PLY/SPLAT/NIF source metadata must record the actual R2 bucket');
assert.match(source, /const refPath = `\$\{userId\}\/verify-refs\//, 'verification references must use an owner-prefixed key accepted by the R2 ownership guard');
const extStart = source.indexOf('async function createExternalNif');
const extEnd = source.indexOf('\nfunction captureMetadata', extStart);
const external = source.slice(extStart, extEnd);
assert.match(external, /external_nif_url: externalNifUrl/, 'external URL must be saved in meta');
assert.match(external, /thumbnail_r2_key: uploadedThumbnail\?\.fileKey/, 'uploaded thumbnail key must be linked for authorized read/delete');
const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../js/modules/feed.js', import.meta.url), 'utf8');
assert.match(viewer, /record\.meta\?\.external_nif_url/, 'viewer must resolve external URL from meta');
assert.match(viewer, /record\.meta\?\.preview_video_url/, 'viewer must resolve preview URL from meta');
assert.match(feed, /row\.meta\?\.external_nif_url/, 'feed must resolve external URL from meta');
const editor = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
assert.match(editor, /r2\.from\('nif-files'\)\.authenticatedUrl\(data\.r2_key\)/, 'Studio must use an authenticated read ticket for private NIFs');
assert.match(editor, /window\._fumocaCanonicalFileUrl = currentR2Url/, 'Studio must retain the canonical URL rather than persisting a temporary ticket');
console.log('Upload-page NIF schema contract passed.');
