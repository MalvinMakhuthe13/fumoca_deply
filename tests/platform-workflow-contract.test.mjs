import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('notifications reads canonical NIF jobs and optionally includes legacy queue', async () => {
  const source = await read('js/modules/notifications.js');
  assert.match(source, /from\('reconstruction_jobs'\)/);
  assert.match(source, /raw_r2_key|capture_mode|NIF job query failed/);
  assert.match(source, /from\('processing_jobs'\)/);
  assert.match(source, /Legacy pipeline/);
  assert.match(source, /Promise\.all/);
});

test('notification content is built with textContent, not untrusted HTML interpolation', async () => {
  const source = await read('js/modules/notifications.js');
  assert.match(source, /node\.textContent =/);
  assert.match(source, /wrap\.replaceChildren\(\)/);
  assert.doesNotMatch(source, /wrap\.innerHTML\s*=\s*jobs\.map/);
});

test('motion states read both metadata shapes and persist NIF meta first', async () => {
  const source = await read('js/modules/motion-states.js');
  assert.match(source, /record\?\.meta\?\.motion_states \?\? record\?\.metadata\?\.motion_states/);
  assert.match(source, /from\('nif_files'\)/);
  assert.match(source, /update\(\{ meta: currentMeta \}\)/);
  assert.match(source, /from\('splats'\)/);
  assert.match(source, /motionStateSaveFailed/);
});

test('NIF and legacy asset URL shapes are preserved when loading motion states', async () => {
  const source = await read('js/modules/motion-states.js');
  assert.match(source, /r2\.publicUrl\('nif-files', record\.r2_key\)/);
  assert.match(source, /record\?\.splat_url/);
});

test('feed social actions target NIF likes and report failed writes', async () => {
  const source = await read('js/modules/feed.js');
  assert.match(source, /from\('nif_likes'\)/);
  assert.match(source, /Could not save your like/);
  assert.match(source, /if \(result\.error\) throw result\.error/);
  assert.doesNotMatch(source, /from\('likes'\)/);
  assert.doesNotMatch(source, /eq\('nif_file_id'/);
});

test('feed deletion uses known R2 keys and the real reconstruction job key', async () => {
  const source = await read('js/modules/feed.js');
  assert.match(source, /post\.r2_key/);
  assert.match(source, /post\.meta\?\.source_capture\?\.r2_key/);
  assert.match(source, /post\.meta\?\.thumbnail_r2_key/);
  assert.match(source, /select\('id,raw_r2_key'\)/);
  assert.match(source, /bucket: 'nif-videos'/);
});

test('preflight resolves canonical NIF rows and legacy rows explicitly', async () => {
  const source = await read('preflight.html');
  assert.match(source, /from\('nif_files'\)/);
  assert.match(source, /r2\.publicUrl\('nif-files', data\.r2_key\)/);
  assert.match(source, /from\('reconstruction_jobs'\)/);
  assert.match(source, /from\('splats'\)/);
  assert.match(source, /_assetKind: 'nif'/);
  assert.match(source, /_assetKind: 'legacy'/);
  assert.match(source, /_representation/);
  assert.match(source, /isGaussianRepresentation/);
});

test('preflight passes the resolved asset URL to reachability, viewer and cache checks', async () => {
  const source = await read('preflight.html');
  assert.match(source, /const splatUrl = row\._displayUrl/);
  assert.match(source, /probeViewer\(id, splatUrl\)/);
  assert.match(source, /probeParams\.set\('file', artifactUrl\)/);
  assert.match(source, /const urls = \[splatUrl, thumbnailUrl\]/);
});

test('profile opens NIF assets through the shared R2 resolver', async () => {
  const source = await read('js/modules/profile.js');
  assert.match(source, /row\?\.r2_key \? r2\.publicUrl\('nif-files', row\.r2_key\)/);
  assert.match(source, /r2_key: row\.r2_key/);
  assert.match(source, /meta: row\.meta/);
  assert.match(source, /from\('nif_files'\)/);
});

test('profile deletion removes canonical output/source/thumbnail keys from correct buckets', async () => {
  const source = await read('js/modules/profile.js');
  assert.match(source, /item\.r2_key\)[\s\S]*?bucket: 'nif-files'/);
  assert.match(source, /item\.meta\?\.source_capture\?\.r2_key/);
  assert.match(source, /rawVideoKey/);
  assert.match(source, /bucket: 'nif-videos', path: rawVideoKey/);
});

test('Ad Studio queries NIF and legacy assets without falsely baking unsupported formats', async () => {
  const source = await read('ad-studio.html');
  assert.match(source, /from\('nif_files'\)/);
  assert.match(source, /from\('splats'\)/);
  assert.match(source, /_rawSplatUrl/);
  assert.match(source, /current encoder accepts raw/);
  assert.match(source, /e\.source !== iframe\.contentWindow/);
  assert.match(source, /e\.origin !== location\.origin/);
  assert.doesNotMatch(source, /postMessage\([^;]*,\s*['"]\*['"]\s*\)/);
});

test('viewer provides a same-origin Ad Studio bridge for load, camera and bake commands', async () => {
  const source = await read('viewer.html');
  assert.match(source, /Ad Studio bridge: explicit same-origin protocol/);
  assert.match(source, /params\.get\('embed'\) !== 'ad-studio'/);
  assert.match(source, /event\.source !== window\.parent/);
  assert.match(source, /event\.origin !== trustedOrigin/);
  assert.match(source, /fumoca:recordLoaded/);
  assert.match(source, /type === 'loadSplat'/);
  assert.match(source, /type === 'adBakeFrame'/);
  assert.match(source, /cameraState/);
});
