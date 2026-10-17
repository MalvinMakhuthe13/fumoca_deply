import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
const start = source.indexOf('async function saveLiveEdit');
const end = source.indexOf('// ── Teaser preview modal', start);
assert.ok(start >= 0 && end > start, 'Studio save function must exist');
const save = source.slice(start, end);
assert.ok(save.includes("from('nif_files')"), 'Studio saves must update the deployed NIF row');
assert.match(save, /r2\\.from\\('nif-files'\\)\\s*\\.upload\\(/, 'Studio derivatives must upload to R2');
assert.ok(save.includes("r2.from('nif-files').remove([fileKey])"), 'failed registration should attempt derivative cleanup');
assert.ok(!save.includes("from('splats')"), 'Studio must not write to the retired splats table');
assert.ok(!save.includes("storage.from('splat-files')"), 'Studio must not upload to the retired Supabase Storage bucket');
assert.ok(save.includes('Legacy splats/Supabase Storage fallback is disabled'), 'failed NIF saves must fail visibly instead of pretending legacy fallback works');
console.log('Studio save schema and failure contract passed.');
