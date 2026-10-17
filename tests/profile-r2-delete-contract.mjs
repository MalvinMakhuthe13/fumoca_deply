import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/profile.js', import.meta.url), 'utf8');
const start = source.indexOf('async function deleteUploadRecord(item)');
const end = source.indexOf('\nlet userId = null;', start);
assert.ok(start >= 0 && end > start, 'profile delete function must exist');
const block = source.slice(start, end);
for (const [bucket, key] of [
  ['nif-files', 'item.r2_key'],
  ['thumbnails', 'item.meta?.thumbnail_r2_key'],
  ['thumbnails', 'item.meta?.capture_thumbnail_r2_key'],
]) {
  assert.ok(block.includes(`bucket: '${bucket}', key: ${key}`), `must clean ${key} from ${bucket}`);
}
assert.ok(block.indexOf('Promise.allSettled(') < block.indexOf(".from('nif_files')"), 'R2 cleanup must run before deleting the ownership row');
assert.match(block, /bucket: item\.meta\?\.source_r2_bucket \|\| 'nif-files', key: item\.meta\?\.source_r2_key/,
  'source_r2_key cleanup must honor the recorded bucket');
assert.match(block, /item\.meta\?\.source_r2_key\?\.startsWith\('raw\/'\) \? 'nif-videos' : 'nif-files'/,
  'legacy raw-burst keys must be routed directly to nif-videos to avoid false delete failures');
assert.match(block, /!item\.meta\?\.source_r2_bucket && item\.meta\?\.source_r2_key && !item\.meta\.source_r2_key\.startsWith\('raw\/'\) \? \[\{ bucket: 'nif-videos', key: item\.meta\.source_r2_key \}\]/,
  'legacy source keys without a bucket marker must be checked in the old video bucket too');
assert.match(block, /bucket: sourceCapture\?\.r2_bucket \|\| sourceCapture\?\.bucket \|\| 'nif-files', key: sourceCapture\?\.r2_key/,
  'source capture cleanup must use its recorded bucket, defaulting to nif-files');
assert.match(block, /bucket: 'nif-videos', key: sourceCapture\.r2_key/,
  'legacy source captures must also be cleaned from nif-videos when their bucket is unknown');
for (const key of ['item.meta?.mobile_asset_r2_key', 'item.meta?.cleaned_splat?.r2_key', 'item.meta?.open_variant_r2_keys']) {
  assert.ok(block.includes(key), `must clean linked derivative ${key}`);
}
assert.match(block, /item\.meta\?\.lidar_sources[\s\S]*?source\?\.r2_key/,
  'all preserved LiDAR source objects must be cleaned');
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
