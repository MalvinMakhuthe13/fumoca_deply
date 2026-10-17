import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the viewer's R2 bucket contract.
// This is a source-level contract check; it does not claim a live R2 delete test.
const viewer = readFileSync(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');

assert.match(
  viewer,
  /function resolveThumbnail\(record\)[\s\S]*?r2\.publicUrl\('thumbnails',\s*thumbKey\)/,
  'thumbnail_r2_key must resolve through the dedicated thumbnails bucket'
);

assert.match(
  viewer,
  /const cleanupCandidates = \[[\s\S]*?\{ bucket: 'nif-files', key: currentRecord\.r2_key \}/,
  'NIF output cleanup must target nif-files'
);
assert.match(
  viewer,
  /bucket: currentRecord\.meta\?\.source_r2_bucket \|\| \(currentRecord\.meta\?\.source_r2_key\?\.startsWith\('raw\/'\) \? 'nif-videos' : 'nif-files'\)/,
  'source_r2_key cleanup must honor recorded bucket and infer legacy raw-burst bucket'
);
assert.match(
  viewer,
  /bucket: sourceCapture\?\.r2_bucket \|\| sourceCapture\?\.bucket \|\| \(sourceCapture\?\.r2_key\?\.startsWith\('raw\/'\) \? 'nif-videos' : 'nif-files'\)/,
  'source_capture cleanup must honor its recorded bucket and infer legacy raw-burst bucket'
);
assert.match(
  viewer,
  /\{ bucket: 'thumbnails', key: currentRecord\.meta\?\.thumbnail_r2_key \}/,
  'thumbnail_r2_key cleanup must target thumbnails'
);
assert.match(
  viewer,
  /\{ bucket: 'thumbnails', key: currentRecord\.meta\?\.capture_thumbnail_r2_key \}/,
  'capture_thumbnail_r2_key cleanup must target thumbnails'
);
assert.match(
  viewer,
  /cleanupTargets\.map\(\(\{ bucket, key \}\) => r2\.from\(bucket\)\.remove\(\[key\]\)\)/,
  'each object must be deleted through its own bucket'
);

const bootStart = viewer.indexOf('async function boot()');
const boot = viewer.slice(bootStart);
assert.match(boot, /isR2WorkerFileUrl/);
assert.match(boot, /!isR2WorkerFileUrl/, 'R2 Worker URLs must skip unsupported HEAD probes');
assert.match(boot, /authenticatedUrl\(currentRecord\.r2_key\)/, 'private NIFs must use an authenticated read ticket');
assert.match(boot, /!privateReadAuthorizationFailed/, 'failed private authorization must not fall back to an anonymous URL');
assert.match(viewer, /function getStorageAssetId\(\)/, 'edit state must use a stable canonical asset identity');
assert.match(viewer, /fumoca:hotspots:\$\{getStorageAssetId\(\)\}/, 'private ticket URLs must not fragment local edit state across sessions');
console.log('Viewer R2 bucket routing contracts passed.');
