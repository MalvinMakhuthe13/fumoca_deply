import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const capture = await readFile(new URL('../js/modules/splat-capture.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../js/modules/capture-ui.js', import.meta.url), 'utf8');

for (const [fragment, message] of [
  ['function createCaptureSurface(sourceCanvas, fps)', 'capture must build a composition surface when poster layers exist'],
  ['#magazineTextLayer > *', 'capture must include independently positioned editorial text layers'],
  ['[data-fumoca-poster-title]', 'capture must include the poster headline'],
  ['[data-fumoca-poster-assets] img', 'capture must include supporting image layers'],
  ['captureCanvas.captureStream(_options.fps)', 'video recording must stream the composited canvas rather than the raw WebGL canvas'],
  ["surface.canvas.toDataURL('image/png')", 'still capture must export the same composed poster'],
  ['surface.stop()', 'the compositor animation loop must be stopped after recording or snapshot'],
]) assert.ok(capture.includes(fragment), message);

assert.ok(ui.includes("splat-capture.js?v=20261108-compositeposter01"), 'capture UI must refresh the updated recorder module');
console.log('Poster capture composition contract passed: headline, text, supporting images, splat, video and still capture share one output.');
