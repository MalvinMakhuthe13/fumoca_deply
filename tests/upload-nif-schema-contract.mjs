import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/upload-page.js', import.meta.url), 'utf8');
const start = source.indexOf('function baseNifPayload(');
const end = source.indexOf('\nasync function createExternalNif', start);
assert.ok(start >= 0 && end > start, 'baseNifPayload must exist');
const base = source.slice(start, end);
for (const column of ['user_id', 'title', 'description', 'vertical', 'tags', 'is_public', 'meta']) {
  assert.match(base, new RegExp('\\b' + column + '\\s*:'), `base NIF payload must use deployed column ${column}`);
}
for (const legacyColumn of ['category', 'visibility', 'status', 'processing_stage', 'processing_progress', 'nif_url', 'external_nif_url', 'provider_name']) {
  assert.doesNotMatch(base, new RegExp('\\b' + legacyColumn + '\\s*:'), `legacy field ${legacyColumn} belongs in meta, not as a nif_files column`);
}
assert.match(base, /is_public: visibility === 'public'/, 'publication must persist to is_public');
const extStart = source.indexOf('async function createExternalNif');
const extEnd = source.indexOf('\nfunction captureMetadata', extStart);
const external = source.slice(extStart, extEnd);
assert.match(external, /external_nif_url: externalNifUrl/, 'external URL must be saved in meta');
assert.match(external, /thumbnail_r2_key: uploadedThumbnail\?\.fileKey/, 'uploaded thumbnail key must be linked for authorized read/delete');
console.log('Upload-page NIF schema contract passed.');
