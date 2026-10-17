import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
async function read(path) { return readFile(new URL(path, root), 'utf8'); }

test('whole-platform integration audit names each requested reference and its boundary', async () => {
  const audit = await read('docs/WHOLE_PLATFORM_INTEGRATION_AUDIT.md');
  for (const marker of [
    'Image2Splat', 'NaviGS', 'KIRI 3DGS Render', 'LichtFeld Studio',
    'reconstruction_jobs', 'nif_files', 'Kaggle', 'Studio UI/action wiring',
    'Viewer, embed, feed, presentation, commerce', 'Release gate',
    'GPL-3.0', 'not a claim that every workflow is currently passing',
  ]) assert.ok(audit.includes(marker), 'audit is missing: ' + marker);
});

test('reconstruction source declares and persists the canonical NIF records', async () => {
  const pipeline = await read('engine-next/reconstruction/pipeline.py');
  assert.match(pipeline, /reconstruction_jobs/);
  assert.match(pipeline, /nif_files/);
  assert.match(pipeline, /nif_r2_key/);
});

test('core upload and viewer modules use the real NIF job contract', async () => {
  const upload = await read('js/modules/upload-page.js');
  const viewer = await read('js/modules/viewer.js');
  assert.match(upload, /reconstruction_jobs/);
  assert.match(upload, /raw_r2_key/);
  assert.match(viewer, /reconstruction_jobs/);
  assert.match(viewer, /nif_files/);
});

test('audit records legacy schema references for migration and not blind renaming', async () => {
  const audit = await read('docs/WHOLE_PLATFORM_INTEGRATION_AUDIT.md');
  assert.match(audit, /contract fragmentation/i);
  assert.match(audit, /validate each actual production path against the deployed schema/i);
  assert.match(audit, /Never run destructive SQL automatically/i);
});
