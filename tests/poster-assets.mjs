import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composer = await readFile(new URL('../js/modules/poster-composer.js', import.meta.url), 'utf8');
const viewport = await readFile(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');
const assets = await readFile(new URL('../js/modules/poster-assets.js', import.meta.url), 'utf8');
const studio = await readFile(new URL('../js/modules/present-tab.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');
const presentViewer = await readFile(new URL('../js/modules/present-viewer.js', import.meta.url), 'utf8');

assert.ok(composer.includes('current.assets ='), 'Poster composition must persist supporting image layers');
assert.ok(composer.includes('assets: clone(state.composition.assets'), 'Poster snapshot must export image layers');
assert.ok(composer.includes('data:image\\/'), 'Local image backgrounds must be accepted');
assert.ok(viewport.includes('data-fumoca-poster-background'), 'Poster viewport must render a dedicated background layer');
assert.ok(viewport.includes("document.getElementById('viewport')"), 'Studio poster background must mount against the editor poster viewport');
assert.ok(viewport.includes('const isStudioEditor'), 'Studio and public viewer must choose their own poster coordinate hosts');
assert.ok(viewport.includes('? stage'), 'Studio poster background must share the same coordinate host as editorial image layers');
assert.ok(viewport.includes("document.getElementById('panelLeft')"), 'Studio poster viewport must account for the editor left panel when switching to absolute positioning');
assert.ok(viewport.includes("window.getComputedStyle(panel).position === 'fixed'"), 'Mobile fixed panels must not shift the Studio poster coordinate origin');
assert.ok(viewport.includes('panel.getBoundingClientRect().right - shell.getBoundingClientRect().left'), 'Studio poster viewport must use the panel edge relative to its shell as the desktop offset');
assert.ok(viewport.includes('(editorOriginLeft + layout.left)'), 'Studio poster viewport must retain its original horizontal shell offset');

assert.ok(viewport.includes('data-fumoca-poster-background-image'), 'Background must use a dedicated image element');
assert.ok(viewport.includes('backgroundImage.src = background.value'), 'Background source must be assigned to the image element');
assert.ok(viewport.includes('backgroundImage.onerror'), 'Background decode/load failures must be observable');
assert.ok(viewport.includes("backgroundNode.style.display = 'none'"), 'Disabling poster composition must hide, not destroy, the background layer');
assert.ok(viewport.includes("backgroundNode.style.display = 'block'"), 'Re-enabling poster composition must restore the existing background layer');
assert.ok(!viewport.includes('backgroundNode?.remove();'), 'Poster toggle must not discard the background image element');

assert.ok(viewport.includes('fumoca:posterBackgroundLoaded'), 'Successful background loads must be observable');
assert.ok(viewport.includes('zIndex: \'0\''), 'Background must remain behind scene content');
assert.ok(viewport.includes("zIndex: '3'"), 'Headline must render above the background');

assert.ok(viewport.includes('background.blur'), 'Background blur control must reach the renderer');
assert.ok(viewport.includes('background.brightness'), 'Background brightness control must reach the renderer');
assert.ok(assets.includes('data-fumoca-poster-assets'), 'Supporting images must render in a separate presentation layer');
assert.ok(assets.includes('pointermove'), 'Supporting images must be draggable');
assert.ok(assets.includes('const rect = root.getBoundingClientRect();'), 'Supporting image dragging must use poster-root coordinates, not the outer editor host');
assert.ok(assets.includes('Resize '), 'Supporting images must expose a resize handle');
assert.ok(assets.includes('sizeMode === \'fixed\''), 'Image layers must support fixed-pixel sizing');
assert.ok(assets.includes('sizeMode === \'responsive\''), 'Image layers must support responsive min/max sizing');
assert.ok(assets.includes('anchorTransforms'), 'Image layers must support anchor positioning');
assert.ok(assets.includes('item.locked'), 'Image layers must support locking');
assert.ok(assets.includes('window.FumocaPosterAssets'), 'Studio must be able to select image layers through a public API');
assert.ok(assets.includes('window.FumocaPoster.updateComposition'), 'Image transforms must persist to composition state');
for (const field of ['backgroundFile','backgroundFit','backgroundPosition','backgroundOpacity','backgroundBlur','backgroundBrightness','overlayFile']) {
  assert.ok(studio.includes(`data-poster-field="${field}"`), `Missing Studio control: ${field}`);
}
assert.ok(studio.includes('savePosterToCloud()'), 'Uploaded image media must be saved to the NIF asset before sharing');
assert.ok(studio.includes("import r2 from '../r2Client.js'"), 'Poster media must use the authenticated FUMOCA R2 client');
assert.ok(studio.includes("from './poster-cloud-persistence.js'"), 'Studio must use the independently testable cloud persistence module');
assert.ok(studio.indexOf('savePosterSnapshot') < studio.indexOf('window.FumocaPoster?.updateComposition'), 'Live poster state must update only after cloud metadata commits');
const cloudPersistence = await readFile(new URL('../js/modules/poster-cloud-persistence.js', import.meta.url), 'utf8');
assert.ok(cloudPersistence.includes('await supabase.auth.getUser()'), 'Cloud poster save must require an authenticated user');
assert.ok(cloudPersistence.includes("record.user_id !== authData.user.id"), 'Cloud poster save must verify NIF ownership before uploading media');
assert.ok(cloudPersistence.indexOf('persistPosterImagesToR2') < cloudPersistence.indexOf(".from('nif_files').update"), 'R2 media must upload before NIF metadata is committed');
assert.ok(cloudPersistence.includes('metadataCommitted'), 'Failed database writes must leave the local composition retryable');
assert.ok(cloudPersistence.includes("r2Client.from('thumbnails').remove(uploadedKeys)"), 'Failed cloud saves must clean up uploaded R2 objects');
assert.ok(presentViewer.includes('...(rec?.metadata || {}), ...(rec?.meta || {})'), 'Public viewer must restore presentation metadata from either supported record shape');
assert.ok(cloudPersistence.includes("r2Client.from('thumbnails')"), 'Poster media must be stored in the existing R2 image bucket');
assert.ok(cloudPersistence.includes('persistPosterImagesToR2'), 'Cloud save must externalize local image data before writing NIF metadata');
assert.ok(studio.includes('r2Key: stored.r2Key'), 'Saved poster media must retain its R2 object key');
assert.ok(studio.includes('Upload background from your device'), 'Background must offer direct local-device upload');
assert.ok(studio.includes('Upload images, logos or textures from your device'), 'Supporting image layers must offer direct local-device upload');
assert.ok(!studio.includes('data-poster-field="backgroundUrl"'), 'Background upload must not require an externally hosted URL');
assert.ok(!studio.includes('data-act="add-overlay-url"'), 'Supporting image upload must not require an externally hosted URL');
assert.ok(studio.includes('backgroundGradient'), 'Studio must offer art-directed gradient backgrounds');
assert.ok(studio.includes('preserveAlpha ? canvas.toDataURL(\'image/webp\''), 'Supporting PNG/logo layers must preserve transparency');
assert.ok(studio.includes("selectField('Size behaviour','sizeMode'"), 'Missing layer size mode selector');
for (const field of ["field('Width %','width'", "field('Fixed width px','fixedWidthPx'", "field('Minimum px','minWidthPx'", "field('Maximum px','maxWidthPx'", "field('Rotation °','rotation'", "field('Opacity %','opacity'", "selectField('Anchor','anchor'"]) {
  assert.ok(studio.includes(field), `Missing layer property control: ${field}`);
}
for (const action of ['visibility','lock','up','down','remove']) assert.ok(studio.includes(`'${action}'`), `Missing layer action: ${action}`);
assert.ok(viewer.includes("import './poster-assets.js"), 'Public viewer must load the supporting image renderer');
console.log('Poster background, image-layer, persistence and viewer integration contract passed.');
