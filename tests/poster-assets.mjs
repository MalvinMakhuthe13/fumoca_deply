import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const composer = await readFile(new URL('../js/modules/poster-composer.js', import.meta.url), 'utf8');
const viewport = await readFile(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');
const assets = await readFile(new URL('../js/modules/poster-assets.js', import.meta.url), 'utf8');
const magazine = await readFile(new URL('../js/modules/present-magazine-text.js', import.meta.url), 'utf8');
const studio = await readFile(new URL('../js/modules/present-tab.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');
const presentViewer = await readFile(new URL('../js/modules/present-viewer.js', import.meta.url), 'utf8');

assert.ok(composer.includes('current.assets ='), 'Poster composition must persist supporting image layers');
assert.ok(composer.includes('assets: clone(state.composition.assets'), 'Poster snapshot must export image layers');
assert.ok(composer.includes('data:image\\/'), 'Local image backgrounds must be accepted');
assert.ok(viewport.includes('data-fumoca-poster-background'), 'Poster viewport must render a dedicated background layer');
// Single authoritative poster host: Studio uses #viewport, the public viewer uses #stageHost.
assert.ok(viewport.includes('const isStudioEditor'), 'Studio and public viewer must choose their own poster coordinate hosts');
const studioHostSelect = viewport.indexOf("document.getElementById('viewport')");
const viewerHostSelect = viewport.indexOf("document.getElementById('stageHost')");
assert.ok(studioHostSelect > -1 && viewerHostSelect > studioHostSelect, 'Studio must select #viewport before the public viewer selects #stageHost');
assert.ok(viewport.includes("isStudioEditor\n    ? (document.getElementById('viewport')") ||
          viewport.includes("isStudioEditor\n    ? (document.getElementById('viewport') || document.getElementById('canvasHost'))"),
  'Studio poster host must be #viewport');
assert.ok(viewport.includes("document.getElementById('stageHost') || document.getElementById('stage')"),
  'Public viewer poster host must be #stageHost');
assert.ok(assets.includes("document.getElementById('viewport')") && assets.includes("document.getElementById('stageHost')"),
  'Supporting images must select the same Studio #viewport and viewer #stageHost');
assert.ok(magazine.includes("document.getElementById('viewport')") && magazine.includes("document.getElementById('stageHost')"),
  'Magazine text must select the same Studio #viewport and viewer #stageHost');
assert.ok(viewport.includes('const host = stage;'), 'Background, canvas and overlays share one host');
assert.ok(assets.includes('const host = hostNode();'), 'Supporting images mount into the selected poster host');
assert.ok(magazine.includes('host.appendChild(layer);'), 'Magazine text mounts into the selected poster host');
assert.ok(magazine.includes("viewport.querySelector?.('[data-fumoca-poster-canvas]')"),
  'Studio magazine text must reparent into the fixed poster canvas when it becomes available');
assert.ok(magazine.includes("if (layer.parentElement !== host) host.appendChild(layer);"),
  'Magazine text must follow the authoritative poster host after asynchronous viewport mounting');
assert.ok(assets.includes('const currentHost = hostNode();') && assets.includes('currentHost.appendChild(root)'),
  'Supporting images must follow the poster canvas if the viewport mounts after the image module');


// Studio keeps #viewport full-size, so measuring it is stable; public viewer measures its parent.
assert.ok(viewport.includes('const measureEl = isStudioEditor ? host : (host.parentElement || document.documentElement)'),
  'Studio must measure its unchanged viewport while public viewer measures its stable parent');
assert.ok(viewport.includes('const rect = measureEl.getBoundingClientRect()'),
  'Layout calculation must use the appropriate stable measurement element');
assert.ok(viewport.includes('observer.observe(measureEl)'),
  'ResizeObserver must watch the same stable measurement element');

// The Studio host remains full-size; only the independent poster and background layers are contain-fit.
assert.ok(viewport.includes("left: layout.left + 'px'"), 'Poster layers must receive the contain-fit left offset');
assert.ok(viewport.includes("top: layout.top + 'px'"), 'Poster layers must receive the contain-fit top offset');
assert.ok(viewport.includes("width: layout.width + 'px'"), 'Poster layers must use the contain-fit width');
assert.ok(viewport.includes("height: layout.height + 'px'"), 'Poster layers must use the contain-fit height');
assert.ok(viewport.includes("host.insertBefore(backgroundNode, host.firstChild)"),
  'Studio background must be a viewport sibling behind WebGL, clipped to the poster frame');

// Studio background is clipped to the poster frame; public viewer background fills its host.
assert.ok(viewport.includes("inset: isStudioEditor ? 'auto' : '0'") &&
          viewport.includes("left: isStudioEditor ? layout.left + 'px' : '0'") &&
          viewport.includes("top: isStudioEditor ? layout.top + 'px' : '0'") &&
          viewport.includes("width: isStudioEditor ? layout.width + 'px' : '100%'") &&
          viewport.includes("height: isStudioEditor ? layout.height + 'px' : '100%'"),
  'Studio background uses poster-frame coordinates while public viewer background fills its host');
assert.ok(assets.includes("inset: '0', left: '0', top: '0', width: '100%', height: '100%'"),
  'Supporting images must fill the poster host and use local coordinates');
assert.ok(magazine.includes("position: 'absolute'") && magazine.includes('host.appendChild(layer);'),
  'Magazine text items are absolutely positioned inside the selected poster host');
assert.ok(magazine.includes("document.getElementById('viewport') || document.getElementById('stageHost')"),
  'Magazine text prefers Studio #viewport and falls back to #stageHost');
assert.ok(magazine.includes("document.getElementById('stageHost') || document.getElementById('stage')"),
  'Magazine text prefers public-viewer #stageHost');

assert.ok(viewport.includes('data-fumoca-poster-background-image'), 'Background must use a dedicated image element');
assert.ok(viewport.includes('backgroundImage.src = background.value'), 'Background source must be assigned to the image element');
assert.ok(viewport.includes('backgroundImage.onerror'), 'Background decode/load failures must be observable');
assert.ok(viewport.includes("backgroundNode.style.display = 'none'"), 'Disabling poster composition must hide, not destroy, the background layer');
assert.ok(viewport.includes("backgroundNode.style.display = 'block'"), 'Re-enabling poster composition must restore the existing background layer');
assert.ok(!viewport.includes('backgroundNode?.remove();'), 'Poster toggle must not discard the background image element');

assert.ok(viewport.includes('fumoca:posterBackgroundLoaded'), 'Successful background loads must be observable');
assert.ok(viewport.includes("zIndex: isStudioEditor ? '1' : '0'"), 'Studio background sits below WebGL while the public viewer keeps its background layer at its established depth');
assert.ok(viewport.includes("zIndex: '3'"), 'Headline must render above the background');

assert.ok(viewport.includes('background.blur'), 'Background blur control must reach the renderer');
assert.ok(viewport.includes('background.brightness'), 'Background brightness control must reach the renderer');
assert.ok(assets.includes('data-fumoca-poster-assets'), 'Supporting images must render in a separate presentation layer');
assert.ok(assets.includes('pointermove'), 'Supporting images must be draggable');
assert.ok(assets.includes('const rect = root.getBoundingClientRect();'), 'Supporting image dragging must use poster-root coordinates, not the outer editor host');
assert.ok(assets.includes('Resize '), 'Supporting images must expose a resize handle');
assert.ok(assets.includes('Rotate '), 'Selected supporting images must expose a direct rotation handle');
assert.ok(assets.includes("patchItem(item.id, { rotation })"), 'Image rotation must update the saved poster composition');
assert.ok(assets.includes("[aria-label^=\"Rotate \"]"), 'Rotation control must not initiate image dragging');
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
assert.ok(studio.includes('saveLocal(savedData);'), 'Cloud save must store the exact R2-backed snapshot locally');
assert.ok(studio.includes('window.__FUMOCA_PRESENT__ = savedData;'), 'Cloud save must keep the committed snapshot as the in-memory source of truth');
assert.ok(studio.indexOf('saveLocal(savedData);') > studio.indexOf('window.FumocaPoster?.updateComposition'), 'Local snapshot must synchronize after the live poster receives permanent media URLs');
assert.ok(!studio.slice(studio.indexOf('async function savePosterToCloud()'), studio.indexOf('async function copyViewerLink()')).includes('    persist();'), 'Cloud save must not rebuild the committed snapshot from live editor state');
const cloudPersistence = await readFile(new URL('../js/modules/poster-cloud-persistence.js', import.meta.url), 'utf8');
assert.ok(cloudPersistence.includes('await supabase.auth.getUser()'), 'Cloud poster save must require an authenticated user');
assert.ok(cloudPersistence.includes("record.user_id !== authData.user.id"), 'Cloud poster save must verify NIF ownership before uploading media');
assert.ok(cloudPersistence.indexOf('persistPosterImagesToR2') < cloudPersistence.indexOf(".from('nif_files').update"), 'R2 media must upload before NIF metadata is committed');
assert.ok(cloudPersistence.includes('metadataCommitted'), 'Failed database writes must leave the local composition retryable');
assert.ok(cloudPersistence.includes("r2Client.from('thumbnails').remove(uploadedKeys)"), 'Failed cloud saves must clean up uploaded R2 objects');
assert.ok(presentViewer.includes('...(rec?.metadata || {}), ...(rec?.meta || {})'), 'Public viewer must restore presentation metadata from either supported record shape');
assert.ok(cloudPersistence.includes("r2Client.from('thumbnails')"), 'Poster media must be stored in the existing R2 image bucket');
assert.ok(cloudPersistence.includes('persistPosterImagesToR2'), 'Cloud save must externalize local image data before writing NIF metadata');
assert.ok(cloudPersistence.includes('r2Key: stored.r2Key') && cloudPersistence.includes('item.r2Key = stored.r2Key'), 'Saved poster media must retain its R2 object key');
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
