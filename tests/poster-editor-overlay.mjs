import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const overlaySource = await readFile(new URL('../js/modules/poster-editor-overlay.js', import.meta.url), 'utf8');
assert.ok(overlaySource.includes('class="fpe-title"'), 'Studio overlay must include a headline layer');
assert.ok(overlaySource.includes('class="fpe-control fpe-scale"'), 'Studio overlay must expose a direct resize handle');
assert.ok(overlaySource.includes('class="fpe-control fpe-rotate"'), 'Studio overlay must expose a direct rotation handle');
assert.ok(overlaySource.includes('api.updateSubject(subject.id, patch)'), 'Direct manipulation must target the selected scene subject, not always the primary subject');
assert.ok(overlaySource.includes('subject.locked'), 'Direct manipulation must respect locked subjects');
assert.ok(overlaySource.includes('composition.title'), 'Studio overlay must read the shared poster title state');
assert.ok(overlaySource.includes('heading.visible !== false'), 'Studio overlay must respect the headline visibility toggle');
assert.ok(overlaySource.includes('heading.fontFamily'), 'Studio overlay must apply headline typography');
assert.ok(overlaySource.includes('heading.fontSize'), 'Studio overlay must apply headline size');
assert.ok(overlaySource.includes('heading.color'), 'Studio overlay must apply headline colour');
const normalizedOverlaySource = overlaySource.replace(/\\s+/g, '');
assert.ok(normalizedOverlaySource.includes('(Number(heading.fontSize)||42)*(poster.width/1080)'), 'Studio headline size must scale with the poster canvas rather than the editor screen');

console.log('Poster editor overlay geometry and headline integration tests passed.');
