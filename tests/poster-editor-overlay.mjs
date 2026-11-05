import assert from 'node:assert/strict';
import { calculatePosterEditorFrame } from '../js/modules/poster-editor-overlay.js';

const portrait = calculatePosterEditorFrame(1200, 800, 4 / 5);
assert.deepEqual(portrait, { left: 280, top: 0, width: 640, height: 800 });

const story = calculatePosterEditorFrame(390, 844, 9 / 16);
assert.equal(story.width, 390);
assert.ok(Math.abs(story.height - (390 * 16 / 9)) < 1e-9);
assert.equal(story.left, 0);
assert.ok(story.top > 0);

const landscape = calculatePosterEditorFrame(1000, 600, 16 / 9);
assert.equal(landscape.width, 1000);
assert.equal(landscape.height, 562.5);
assert.equal(landscape.top, 18.75);

const fallback = calculatePosterEditorFrame(500, 500, 0);
assert.equal(fallback.width, 400);
assert.equal(fallback.height, 500);
assert.equal(fallback.left, 50);
assert.equal(fallback.top, 0);

console.log('Poster editor overlay geometry tests passed.');
