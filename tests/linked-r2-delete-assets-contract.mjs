import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const targets = [
  { path: '../js/modules/profile.js', start: 'async function deleteUploadRecord(item)', end: '\nlet userId = null;', name: 'profile' },
  { path: '../js/modules/feed.js', start: 'async function deletePostRecord(post, opts = {})', end: '\nasync function deleteAllNifsForCurrentUser', name: 'feed' },
  { path: '../js/modules/viewer.js', start: 'async function deleteCurrentUpload()', end: '\nfunction ', name: 'viewer' },
];
for (const target of targets) {
  const source = await readFile(new URL(target.path, import.meta.url), 'utf8');
  const start = source.indexOf(target.start);
  const end = source.indexOf(target.end, start + 1);
  assert.ok(start >= 0 && end > start, `${target.name} delete function must exist`);
  const block = source.slice(start, end);
  for (const key of ['mobile_asset_r2_key', 'cleaned_splat', 'open_variant_r2_keys', 'lidar_sources', 'source_capture']) {
    assert.ok(block.includes(key), `${target.name} deletion must clean ${key} assets`);
  }
  assert.match(block, /bucket: 'nif-files'/, `${target.name} must clean NIF and owner-scoped derivative objects`);
  assert.match(block, /bucket: 'thumbnails'/, `${target.name} must clean thumbnail objects`);
  assert.match(block, /bucket: 'preview-videos'/, `${target.name} must clean teaser videos`);
  assert.ok(block.indexOf('Promise.allSettled(') < block.indexOf(".from('nif_files')"),
    `${target.name} must preserve the parent row until storage cleanup is checked`);
}
console.log('Linked R2 asset deletion contract passed for profile, feed and viewer.');
