import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/profile.js', import.meta.url), 'utf8');
const start = source.indexOf("if (item.source === 'nif_files')");
const end = source.indexOf("\n  const candidates =", start);
assert.ok(start >= 0 && end > start, 'NIF-specific profile delete path must exist');
const block = source.slice(start, end);
assert.match(block, /\{ bucket: 'nif-files', key: item\.r2_key \}/);
assert.match(block, /\{ bucket: 'nif-videos', key: item\.meta\?\.source_r2_key \}/);
assert.match(block, /\{ bucket: 'nif-videos', key: item\.meta\?\.source_capture\?\.r2_key \}/);
assert.match(block, /\{ bucket: 'thumbnails', key: item\.meta\?\.thumbnail_r2_key \}/);
assert.match(block, /\{ bucket: 'thumbnails', key: item\.meta\?\.capture_thumbnail_r2_key \}/);
assert.ok(block.indexOf('Promise.allSettled(') < block.indexOf(".from('nif_files').delete()"), 'R2 cleanup must run before deleting the ownership row');
assert.match(block, /if \(failed\) \{\s*throw new Error\('Some storage objects could not be deleted/);
assert.match(block, /if \(item\.job_id\)/, 'job cleanup must not query with a missing id');
console.log('Profile NIF R2 delete contract passed.');
