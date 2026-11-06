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
assert.equal(poster.version, '0.1.0');

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
  id: 'layer-fixed', name: 'Logo', src: 'https://example.com/logo.png',
  x: 0.2, y: 0.3, width: 0.25, sizeMode: 'fixed', fixedWidthPx: 320,
  minWidthPx: 90, maxWidthPx: 640, anchor: 'top-left', locked: true,
}] } });
const imageLayer = poster.getState().composition.assets.images[0];
assert.equal(imageLayer.sizeMode, 'fixed');
assert.equal(imageLayer.fixedWidthPx, 320);
assert.equal(imageLayer.anchor, 'top-left');
assert.equal(imageLayer.locked, true);
assert.equal(poster.getLayout(400, 900).assets.images[0].fixedWidthPx, 320, 'Layer sizing metadata must survive responsive layout calculation');

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
