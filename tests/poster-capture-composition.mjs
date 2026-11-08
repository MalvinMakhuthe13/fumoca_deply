import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const capture = await readFile(new URL('../js/modules/splat-capture.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../js/modules/capture-ui.js', import.meta.url), 'utf8');

assert.match(capture, /function createCaptureSurface\\(sourceCanvas, fps\\)/, 'capture must build a composition surface when poster layers exist');
assert.match(capture, /#magazineTextLayer > \\*/, 'capture must include independently positioned editorial text layers');
assert.match(capture, /\\[data-fumoca-poster-title\\]/, 'capture must include the poster headline');
assert.match(capture, /\\[data-fumoca-poster-assets\\] img/, 'capture must include supporting image layers');
assert.match(capture, /captureCanvas\\.captureStream\\(_options\\.fps\\)/, 'video recording must stream the composited canvas rather than the raw WebGL canvas');
assert.match(capture, /surface\\.canvas\\.toDataURL\\('image\\/png'\\)/, 'still capture must export the same composed poster');
assert.match(capture, /surface\\.stop\\(\\)/, 'the compositor animation loop must be stopped after recording or snapshot');
assert.match(ui, /splat-capture\\.js\\?v=20261108-compositeposter01/, 'capture UI must refresh the updated recorder module');

console.log('Poster capture composition contract passed: headline, text, supporting images, splat, video and still capture share one output.');
