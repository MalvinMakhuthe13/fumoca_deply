import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('empty Studio exposes the Import mode and LiDAR panel controls', async () => {
  const html = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
  assert.match(html, /id="fileName"[^>]*>No file loaded/i);
  assert.match(html, /StudioModes\.set\('import'\)/);
  const modes = await readFile(new URL('../js/modules/studio-modes.js', import.meta.url), 'utf8');
  assert.match(modes, /id: 'import'[\\s\\S]*?leftTabs: \\[\\s*'import'\\s*\\]/);
  for (const id of [
    'lidarPickBtn', 'lidarColorMode', 'lidarScale', 'lidarOffsetX',
    'lidarOffsetY', 'lidarOffsetZ', 'lidarFitBtn', 'lidarMergeBtn',
    'lidarUndoBtn', 'lidarClearBtn', 'lidarCleanOutliersBtn',
    'lidarQualityReport',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), 'missing Studio control: ' + id);
  }
});

test('LiDAR preflight report is displayed and actions respect validation gates', async () => {
  const html = await readFile(new URL('../edit.html', import.meta.url), 'utf8');
  assert.match(html, /buildLidarQualityReport\(cloud\)/);
  assert.match(html, /report\.gates\.preview/);
  assert.match(html, /report\.gates\.merge/);
  assert.match(html, /Scan preflight: blocked/);
});
