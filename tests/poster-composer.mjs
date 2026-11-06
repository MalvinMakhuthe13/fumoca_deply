import assert from 'node:assert/strict';

const events = [];
globalThis.window = {
  location: { search: '', origin: 'https://fumoca.co.za' },
  dispatchEvent(event) { events.push(event); },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

await import('../js/modules/poster-composer.js');

const poster = window.FumocaPoster;
assert.ok(poster, 'Poster Composer API should be exposed');
assert.equal(poster.version, '0.2.1');

const presets = poster.getPresets();
assert.deepEqual(presets.map((item) => item.name), ['product', 'story', 'editorial', 'landscape']);

poster.setPreset('story');
let state = poster.getState();
assert.equal(state.preset, 'story');
assert.ok(Math.abs(state.composition.aspectRatio - (9 / 16)) < 1e-9);

const portraitLayout = poster.getLayout(400, 900);
assert.equal(portraitLayout.width, 400);
assert.ok(Math.abs(portraitLayout.height - (400 / (9 / 16))) < 1e-9);
assert.equal(portraitLayout.left, 0);
assert.ok(portraitLayout.top > 0);

const landscapeLayout = poster.getLayout(1200, 600);
assert.equal(landscapeLayout.height, 600);
assert.ok(landscapeLayout.width < 1200);
assert.equal(poster.getLayout(0, 600).scale, 0);

poster.updateComposition({ background: { type: 'gradient', value: 'linear-gradient(145deg,#111111 0%,#eeeeee 100%)' } });
assert.equal(poster.getState().composition.background.type, 'gradient', 'Safe gradient art direction must be accepted');
poster.updateComposition({ background: { type: 'gradient', value: 'url(https://example.com/track)' } });
assert.equal(poster.getState().composition.background.type, 'gradient', 'Invalid CSS background must not replace the accepted gradient');
poster.updateComposition({
  background: { type: 'image', value: 'https://cdn.fumoca.co.za/poster-bg.webp', r2Key: 'poster-assets/user/asset/background.webp', bucket: 'thumbnails' },
});
assert.equal(poster.getState().composition.background.r2Key, 'poster-assets/user/asset/background.webp', 'Background R2 key must survive composition normalization');
assert.equal(poster.getState().composition.background.bucket, 'thumbnails', 'Background bucket must survive composition normalization');
const largeBackgroundDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(220000);
poster.updateComposition({ background: { type: 'image', value: largeBackgroundDataUrl } });
assert.equal(poster.getState().composition.background.value.length, largeBackgroundDataUrl.length,
  'Compressed background data URLs must not be silently truncated');
poster.updateComposition({ assets: { images: [{
  id: 'large-logo', name: 'Large logo', src: largeBackgroundDataUrl,
}] } });
assert.equal(poster.getState().composition.assets.images[0].src.length, largeBackgroundDataUrl.length,
  'Supporting image data URLs must not be silently truncated');
poster.updateComposition({ background: { type: 'solid', value: '#10131a' } });
poster.updateComposition({
  object: { x: 1.5, y: -1, scale: 9, rotation: 720 },
  title: { text: 'x'.repeat(200), align: 'invalid', fontFamily: 'Comic Sans', fontSize: 500, color: 'red', weight: 1200 },
  background: { type: 'image', value: 'javascript:alert(1)' },
});
state = poster.getState();
assert.equal(state.composition.object.x, 1);
assert.equal(state.composition.object.y, 0);
assert.equal(state.composition.object.scale, 4);
assert.equal(state.composition.object.rotation, 360);
assert.equal(state.composition.title.text.length, 160);
assert.equal(state.composition.title.align, 'center');
assert.equal(state.composition.title.fontFamily, 'system-ui, sans-serif');
assert.equal(state.composition.title.fontSize, 120);
assert.equal(state.composition.title.color, '#ffffff');
assert.equal(state.composition.title.weight, 900);
assert.equal(state.composition.background.type, 'solid', 'Unsafe image URL should fall back to solid background');

poster.updateComposition({ assets: { images: [{
  id: 'layer-fixed', name: 'Logo', src: 'https://example.com/logo.png', r2Key: 'poster-assets/user/asset/logo.webp', bucket: 'thumbnails',
  x: 0.2, y: 0.3, width: 0.25, sizeMode: 'fixed', fixedWidthPx: 320,
  minWidthPx: 90, maxWidthPx: 640, anchor: 'top-left', locked: true,
}] } });
const imageLayer = poster.getState().composition.assets.images[0];
assert.equal(imageLayer.sizeMode, 'fixed');
assert.equal(imageLayer.fixedWidthPx, 320);
assert.equal(imageLayer.anchor, 'top-left');
assert.equal(imageLayer.locked, true);
assert.equal(imageLayer.r2Key, 'poster-assets/user/asset/logo.webp', 'Image layer R2 key must survive composition normalization');
assert.equal(imageLayer.bucket, 'thumbnails', 'Image layer bucket must survive composition normalization');
assert.equal(poster.getLayout(400, 900).assets.images[0].fixedWidthPx, 320, 'Layer sizing metadata must survive responsive layout calculation');

// Multi-subject scene contract: every subject owns independent normalized transforms.
const mainSubject = poster.getState().composition.subjects.find(item => item.id === 'subject_main');
assert.ok(mainSubject, 'Legacy single subject must migrate into the scene contract');
assert.equal(mainSubject.source.type, 'current');
poster.updateComposition({ object: { x: 0.61, y: 0.44, scale: 1.25, rotation: 15 } });
const syncedPrimary = poster.getState().composition.subjects.find(item => item.id === 'subject_main');
assert.deepEqual(
  { x: syncedPrimary.x, y: syncedPrimary.y, scale: syncedPrimary.scale, rotation: syncedPrimary.rotation },
  { x: 0.61, y: 0.44, scale: 1.25, rotation: 15 },
  'Existing single-subject controls must stay in sync with the new scene model',
);
assert.equal(poster.getLayout(800, 1000).subjects.length, 1, 'Responsive layout exposes normalized scene subjects');
const secondary = poster.addSubject({
  id: 'subject_secondary', label: 'Secondary product',
  source: { type: 'nif', assetId: 'nif-asset-123' },
  x: 0.72, y: 0.38, scale: 1.4, rotation: 22,
});
assert.equal(secondary.id, 'subject_secondary');
assert.equal(poster.getState().selectedSubjectId, 'subject_secondary');
poster.updateSubject('subject_secondary', { x: 2, scale: 8, rotation: -500 });
const changedSecondary = poster.getState().composition.subjects.find(item => item.id === 'subject_secondary');
assert.equal(changedSecondary.x, 1);
assert.equal(changedSecondary.scale, 4);
assert.equal(changedSecondary.rotation, -360);
poster.updateSubject('subject_secondary', { locked: true });
poster.updateSubject('subject_secondary', { x: 0.1 });
assert.equal(poster.getState().composition.subjects.find(item => item.id === 'subject_secondary').x, 1, 'Locked subjects reject transform edits');
assert.equal(poster.removeSubject('subject_main'), false, 'The primary compatibility subject cannot be removed');
assert.equal(poster.removeSubject('subject_secondary'), true);
assert.equal(poster.getState().selectedSubjectId, 'subject_main');
assert.throws(() => poster.addSubject({ source: { type: 'ply', url: 'javascript:alert(1)' } }), /HTTP\(S\) PLY/);

poster.setEnabled(true);
assert.equal(poster.getState().enabled, true);
assert.ok(events.some((event) => event.type === 'fumoca:posterChange'));

poster.reset();
assert.equal(poster.getState().preset, 'story');
assert.equal(poster.getState().composition.object.scale, 0.92);

const renderLayout = poster.getLayout(400, 900);
assert.ok(Math.abs(renderLayout.safe.left - 28) < 1e-9);
assert.ok(Math.abs(renderLayout.safe.top - 28) < 1e-9);
assert.ok(Math.abs(renderLayout.safe.right - 372) < 1e-9);
assert.ok(Math.abs(renderLayout.safe.bottom - (400 / (9 / 16) - 28)) < 1e-9);
assert.ok(Math.abs(renderLayout.safe.width - 344) < 1e-9);
assert.ok(Math.abs(renderLayout.safe.height - (400 / (9 / 16) - 56)) < 1e-9);
assert.deepEqual(renderLayout.object, {
  x: 200,
  y: (400 / (9 / 16)) * 0.48,
  scale: 0.92,
  rotation: 0,
  anchor: 'center',
});
assert.equal(renderLayout.background.value, '#10131a');
assert.equal(renderLayout.title.text, 'Your story');

console.log('Poster Composer model tests passed.');
