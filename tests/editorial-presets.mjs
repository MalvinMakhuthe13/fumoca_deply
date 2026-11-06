import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const magazine = await readFile(new URL('../js/modules/present-magazine-text.js', import.meta.url), 'utf8');
const studio = await readFile(new URL('../js/modules/present-tab.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/present-viewer.js', import.meta.url), 'utf8');

for (const preset of ['luxury', 'fashion', 'launch', 'architecture']) {
  assert.ok(magazine.includes(`name === '${preset}'`), `Missing ${preset} editorial preset`);
  assert.ok(studio.includes(`data-act="${preset}"`), `Missing ${preset} Studio preset action`);
  assert.ok(studio.includes(`applyPreset('${preset}')`), `Missing ${preset} preset handler`);
}
for (const field of ['sx', 'sy', 'weight', 'tracking', 'opacity', 'maxWidth', 'wrap', 'uppercase']) {
  assert.ok(studio.includes(`data-text-field="${field}"`), `Missing editable text control: ${field}`);
}
for (const field of ['weight', 'tracking', 'wrap', 'maxWidth', 'uppercase', 'shadow']) {
  assert.ok(magazine.includes(field), `Magazine text model must preserve ${field}`);
}
assert.ok(magazine.includes("whiteSpace: item.wrap ? 'pre-line'"), 'Intentional line breaks must render in editorial headlines');
assert.ok(viewer.includes('importAll as importMagazine'), 'Public viewer must restore saved editorial layers');

console.log('Editorial presets, text controls and persistence contract passed.');
