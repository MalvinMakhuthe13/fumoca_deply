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
const presentTabSource = await readFile(new URL('../js/modules/present-tab.js', import.meta.url), 'utf8');
assert.ok(overlaySource.includes('return {root,refresh,destroy(){'), 'Overlay must expose its root so Studio can safely remount it');
assert.ok(presentTabSource.includes('createPosterEditorOverlay({ host: viewport, onCommit: () => persist() })'), 'Present tab must mount direct manipulation controls over the Studio viewport');
assert.ok(presentTabSource.includes('posterEditorOverlay.refresh?.()'), 'Repeated Present-tab mounts must refresh rather than duplicate overlay listeners');
assert.ok(!overlaySource.includes('class="fpe-title"'), 'Studio overlay must not duplicate the headline already rendered by the poster viewport');
assert.ok(overlaySource.includes('class="fpe-control fpe-scale"'), 'Studio overlay must expose a direct resize handle');
assert.ok(overlaySource.includes('class="fpe-control fpe-rotate"'), 'Studio overlay must expose a direct rotation handle');
assert.ok(overlaySource.includes('api.updateSubject(subject.id, patch)'), 'Direct manipulation must target the selected scene subject, not always the primary subject');
assert.ok(overlaySource.includes('subject.locked'), 'Direct manipulation must respect locked subjects');
assert.ok(overlaySource.includes('calculatePosterEditorFrame(bounds.width, bounds.height'), 'Transform handles must use the displayed poster frame, not the outer workspace');
assert.ok(overlaySource.includes('(p.x-g.start.x)/rect.width'), 'Subject movement must be normalized to the poster width');
assert.ok(overlaySource.includes('(p.y-g.start.y)/rect.height'), 'Subject movement must be normalized to the poster height');

console.log('Poster editor overlay geometry and headline integration tests passed.');
