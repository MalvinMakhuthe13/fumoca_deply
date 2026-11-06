import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composer = await readFile(new URL('../js/modules/poster-composer.js', import.meta.url), 'utf8');
const viewport = await readFile(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');
const assets = await readFile(new URL('../js/modules/poster-assets.js', import.meta.url), 'utf8');
const studio = await readFile(new URL('../js/modules/present-tab.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');

assert.ok(composer.includes('current.assets ='), 'Poster composition must persist supporting image layers');
assert.ok(composer.includes('assets: clone(state.composition.assets'), 'Poster snapshot must export image layers');
assert.ok(composer.includes('data:image\\/'), 'Local image backgrounds must be accepted');
assert.ok(viewport.includes('data-fumoca-poster-background'), 'Poster viewport must render a dedicated background layer');
assert.ok(viewport.includes('background.blur'), 'Background blur control must reach the renderer');
assert.ok(viewport.includes('background.brightness'), 'Background brightness control must reach the renderer');
assert.ok(assets.includes('data-fumoca-poster-assets'), 'Supporting images must render in a separate presentation layer');
assert.ok(assets.includes('pointermove'), 'Supporting images must be draggable');
assert.ok(assets.includes('Resize '), 'Supporting images must expose a resize handle');
assert.ok(assets.includes('sizeMode === \'fixed\''), 'Image layers must support fixed-pixel sizing');
assert.ok(assets.includes('sizeMode === \'responsive\''), 'Image layers must support responsive min/max sizing');
assert.ok(assets.includes('anchorTransforms'), 'Image layers must support anchor positioning');
assert.ok(assets.includes('item.locked'), 'Image layers must support locking');
assert.ok(assets.includes('window.FumocaPosterAssets'), 'Studio must be able to select image layers through a public API');
assert.ok(assets.includes('window.FumocaPoster.updateComposition'), 'Image transforms must persist to composition state');
for (const field of ['backgroundFile','backgroundUrl','backgroundFit','backgroundPosition','backgroundOpacity','backgroundBlur','backgroundBrightness','overlayFile']) {
  assert.ok(studio.includes(`data-poster-field="${field}"`), `Missing Studio control: ${field}`);
}
assert.ok(studio.includes('savePosterToCloud()'), 'Uploaded image media must be saved to the NIF asset before sharing');
for (const field of ['sizeMode','width','fixedWidthPx','minWidthPx','maxWidthPx','rotation','opacity','anchor']) {
  assert.ok(studio.includes(`data-poster-asset-field=\"${field}\"`) || studio.includes(`data-poster-asset-field = \"${field}\"`) || studio.includes(`field(\'${field === 'width' ? 'Width %' : field === 'fixedWidthPx' ? 'Fixed width px' : field === 'minWidthPx' ? 'Minimum px' : field === 'maxWidthPx' ? 'Maximum px' : field === 'rotation' ? 'Rotation °' : field === 'opacity' ? 'Opacity %' : field === 'sizeMode' ? 'Size behaviour' : 'Anchor'}\',\'${field}'`), `Missing layer editing control: ${field}`);
}
for (const action of ['visibility','lock','up','down','remove']) assert.ok(studio.includes(`' ${action}'`) || studio.includes(`'${action}'`), `Missing layer action: ${action}`);
assert.ok(viewer.includes("import './poster-assets.js"), 'Public viewer must load the supporting image renderer');
console.log('Poster background, image-layer, persistence and viewer integration contract passed.');
