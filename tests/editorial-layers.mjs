import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composer = await readFile(new URL('../js/modules/poster-composer.js', import.meta.url), 'utf8');
const assets = await readFile(new URL('../js/modules/poster-assets.js', import.meta.url), 'utf8');
const studio = await readFile(new URL('../js/modules/present-tab.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');

for (const field of ['sizeMode', 'fixedWidthPx', 'minWidthPx', 'maxWidthPx', 'anchor', 'locked']) {
  assert.ok(composer.includes(field), `Composition model must preserve ${field}`);
}
for (const mode of ['proportional', 'fixed', 'responsive']) {
  assert.ok(composer.includes(`'${mode}'`), `Composition model must validate ${mode} sizing`);
}
assert.ok(assets.includes('clamp('), 'Responsive layers must use bounded CSS sizing');
assert.ok(assets.includes('translate(0,0)'), 'Anchored layers must have deterministic anchor transforms');
assert.ok(assets.includes('pointermove'), 'Layers must be directly movable');
assert.ok(assets.includes('Resize '), 'Layers must be directly resizable');
assert.ok(studio.includes('selectedPosterAssetId'), 'Studio must retain selected layer state');
assert.ok(studio.includes('data-poster-asset-action'), 'Studio must expose per-layer controls');
assert.ok(studio.includes('data-poster-asset-field'), 'Studio must expose per-layer properties');
assert.ok(viewer.includes("import './poster-assets.js"), 'Viewer must use the same editorial layer renderer');
console.log('Responsive editorial layer model and Studio/viewer wiring passed.');
