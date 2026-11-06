import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { textAnchorTransform } from '../js/modules/present-magazine-text.js';

const magazine = await readFile(new URL('../js/modules/present-magazine-text.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');

assert.ok(magazine.indexOf("document.getElementById('stageHost')") < magazine.indexOf("document.getElementById('stage')"), 'Magazine overlays must mount inside the measured poster stage host first');
assert.ok(magazine.includes("root.style.setProperty('--mt-scale'"), 'Magazine typography must scale with the poster viewport');
assert.ok(magazine.includes('layerWidth / 1080'), 'Magazine typography must use a stable 1080px editorial reference canvas');
assert.ok(magazine.includes("'42%'"), 'Magazine text blocks must size relative to the poster canvas, not the browser viewport');
assert.ok(viewer.includes('(Number(heading.fontSize) || 42) * (layout.width / 1080)'), 'Published headline typography must use the same poster-relative scale');
assert.equal(textAnchorTransform('left'), 'translate(0, -50%)', 'left-aligned text must keep its left edge anchored while moving');
assert.equal(textAnchorTransform('center'), 'translate(-50%, -50%)', 'centered text must keep its center anchored while moving');
assert.equal(textAnchorTransform('right'), 'translate(-100%, -50%)', 'right-aligned text must keep its right edge anchored while moving');
assert.ok(magazine.includes('Math.max(0, Math.min(100,'), 'Text can be positioned anywhere within the poster bounds');
assert.ok(magazine.includes('el.style.transform = textAnchorTransform(item.align)'), 'The animation/layout tick must preserve the chosen text anchor instead of snapping dragged text back to center');
assert.ok(magazine.includes("if (item.mode !== 'world') item.mode = 'locked'"), 'Dragging world-anchored text must convert it to a freely positioned poster layer');

console.log('Responsive editorial text layout checks passed.');
