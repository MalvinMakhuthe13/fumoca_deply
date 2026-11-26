import assert from 'node:assert/strict';
import { FILTERS, normalizeFilter, scaleCss } from '../js/modules/present-filters.js';
import { FONT_LIBRARY, fontOptions } from '../js/modules/present-fonts.js';

// filters
assert.equal(normalizeFilter(null).id, 'none');
assert.deepEqual(normalizeFilter({ id: 'noir', strength: 4, reveal: 'tap', revealBack: -3 }), { id: 'noir', strength: 1, reveal: 'tap', revealBack: 0 });
assert.equal(normalizeFilter({ id: 'not-a-filter' }).id, 'none');
assert.equal(normalizeFilter({ id: 'mono', reveal: 'sideways' }).reveal, 'none');
assert.equal(scaleCss('grayscale(1) contrast(1.4)', 1), 'grayscale(1) contrast(1.4)');
assert.equal(scaleCss('grayscale(1) contrast(1.4)', 0), '');
assert.equal(scaleCss('grayscale(1) contrast(1.4) hue-rotate(20deg) blur(2px)', 0.5), 'grayscale(0.5) contrast(1.2) hue-rotate(10deg) blur(1px)');
for (const [k, f] of Object.entries(FILTERS)) {
  assert.ok(f.label, k + ' has a label');
  if (f.css) assert.match(f.css, /^([a-z-]+\([-\d.]+(deg|px)?\)\s*)+$/, k + ' css is a plain filter chain');
}
// fonts: library has the street / graffiti and newspaper faces, options render groups
const fams = FONT_LIBRARY.map(f => f[1]).join('|');
for (const want of ['Permanent Marker', 'Rubik Spray Paint', 'Sedgwick Ave Display', 'UnifrakturMaguntia', 'Special Elite', 'Bebas Neue']) assert.ok(fams.includes(want), 'library has ' + want);
const html = fontOptions('"Permanent Marker", cursive');
assert.match(html, /<optgroup label="Street &amp; graffiti">/);
assert.match(html, /value="&quot;Permanent Marker&quot;, cursive" selected/);
// an unknown saved font stays selectable instead of silently switching
assert.match(fontOptions('"Some Brand Font", sans-serif'), /Some Brand Font<\/option>/);
console.log('present extras (filters, fonts): all checks passed');
