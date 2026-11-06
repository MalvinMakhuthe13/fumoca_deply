import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const magazine = await readFile(new URL('../js/modules/present-magazine-text.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');

assert.ok(magazine.indexOf("document.getElementById('stageHost')") < magazine.indexOf("document.getElementById('stage')"), 'Magazine overlays must mount inside the measured poster stage host first');
assert.ok(magazine.includes("root.style.setProperty('--mt-scale'"), 'Magazine typography must scale with the poster viewport');
assert.ok(magazine.includes('layerWidth / 1080'), 'Magazine typography must use a stable 1080px editorial reference canvas');
assert.ok(magazine.includes("'42%'"), 'Magazine text blocks must size relative to the poster canvas, not the browser viewport');
assert.ok(viewer.includes('(Number(heading.fontSize) || 42) * (layout.width / 1080)'), 'Published headline typography must use the same poster-relative scale');

console.log('Responsive editorial text layout checks passed.');
