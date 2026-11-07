import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculatePosterViewport } from '../js/modules/poster-viewport.js';

const portrait = calculatePosterViewport({
  enabled: true,
  composition: {
    aspectRatio: 9 / 16,
    safeArea: 0.07,
    background: { type: 'solid', value: '#10131a' },
    title: { visible: true, text: 'Story title', align: 'center', fontFamily: 'Georgia, serif', fontSize: 64, color: '#ffeeaa', weight: 800 },
  },
}, 1200, 800);
assert.ok(Math.abs(portrait.width - 450) < 1e-9);
assert.equal(portrait.height, 800);
assert.equal(portrait.left, 375);
assert.equal(portrait.top, 0);
assert.equal(portrait.aspectRatio, 9 / 16);
assert.ok(Math.abs(portrait.safe.left - 31.5) < 1e-9);
assert.equal(portrait.title.text, 'Story title');
assert.equal(portrait.title.fontFamily, 'Georgia, serif');
assert.equal(portrait.title.fontSize, 64);
assert.equal(portrait.title.color, '#ffeeaa');
assert.equal(portrait.title.weight, 800);
const responsiveHeadlinePx = portrait.title.fontSize * (portrait.width / 1080);
assert.ok(Math.abs(responsiveHeadlinePx - (64 * 450 / 1080)) < 1e-9, 'Headline design size should scale against the 1080px poster reference canvas');

const landscape = calculatePosterViewport({
  enabled: true,
  composition: { aspectRatio: 16 / 9, safeArea: 0.05 },
}, 390, 844);
assert.equal(landscape.width, 390);
assert.ok(Math.abs(landscape.height - 219.375) < 1e-9);
assert.equal(landscape.left, 0);
assert.ok(Math.abs(landscape.top - 312.3125) < 1e-9);

assert.equal(calculatePosterViewport({ enabled: false, composition: { aspectRatio: 1 } }, 800, 600), null);
assert.equal(calculatePosterViewport({ enabled: true, composition: { aspectRatio: 0 } }, 800, 600), null);

const viewportModule = readFileSync(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');
assert.match(viewportModule, /const host = stage;/,
  'Editorial DOM layers must remain in #viewport alongside supporting images and text');
assert.ok(viewportModule.includes("const rendererHost = isStudioEditor\n    ? (document.getElementById('stageHost') || stage)"),
  'Studio poster framing must resize the actual WebGL #stageHost');
assert.match(viewportModule, /left: \\(isStudioEditor \\? rect\\.left : 0\\) \\+ layout\\.left/);
assert.match(viewportModule, /top: \\(isStudioEditor \\? rect\\.top : 0\\) \\+ layout\\.top/);
console.log('Poster viewport geometry and Studio renderer-host tests passed.');
