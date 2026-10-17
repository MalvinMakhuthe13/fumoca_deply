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
