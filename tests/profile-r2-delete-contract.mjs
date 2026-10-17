import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/profile.js', import.meta.url), 'utf8');
const start = source.indexOf('async function deleteUploadRecord(item)');
const end = source.indexOf('\nlet userId = null;', start);
assert.ok(start >= 0 && end > start, 'profile delete function must exist');
const block = source.slice(start, end);
for (const [bucket, key] of [
  ['nif-files', 'item.r2_key'],
  ['nif-videos', 'item.meta?.source_r2_key'],
  ['nif-videos', 'item.meta?.source_capture?.r2_key'],
  ['thumbnails', 'item.meta?.thumbnail_r2_key'],
  ['thumbnails', 'item.meta?.capture_thumbnail_r2_key'],
]) {
  assert.ok(block.includes(`bucket: '${bucket}', key: ${key}`), `must clean ${key} from ${bucket}`);
}
assert.ok(block.indexOf('Promise.allSettled(') < block.indexOf(".from('nif_files')"), 'R2 cleanup must run before deleting the ownership row');
assert.match(block, /if \(failed\) \{\s*throw new Error\('Some storage objects could not be deleted/);
assert.match(block, /if \(item\.job_id\)/, 'job cleanup must not query with a missing id');
assert.match(block, /unsupported legacy record shape/, 'stale legacy rows must fail safely instead of using absent tables');
assert.doesNotMatch(block, /from\(['"]splats['"]\)|from\(['"]processing_jobs['"]\)/, 'profile deletion must not write to absent legacy tables');
assert.match(source, /r2\.publicUrl\('thumbnails', row\.meta\.thumbnail_r2_key\)/, 'profile thumbnails must use the dedicated thumbnails bucket');
const initStart = source.indexOf('async function init()');
assert.ok(initStart >= 0, 'profile init must exist');
const initBody = source.slice(initStart);
assert.ok(!initBody.includes(".from('splats')"), 'profile load must use the deployed NIF schema, not the absent splats table');
assert.match(initBody, /\.from\('nif_files'\)/, 'profile must load NIF records');
console.log('Profile NIF R2 delete contract passed.');
