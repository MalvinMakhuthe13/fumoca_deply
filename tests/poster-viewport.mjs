import assert from 'node:assert/strict';
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

console.log('Poster viewport geometry tests passed.');
