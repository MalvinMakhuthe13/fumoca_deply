import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tour = await readFile(new URL('../js/modules/tour-builder.js', import.meta.url), 'utf8');
assert.match(tour, /function _safeHttpUrl\(value\)/, 'tour CTAs and images need HTTP(S) URL validation');
assert.match(tour, /function _safeMediaUrl\(value\)/, 'tour audio must reject unsafe URL schemes');
assert.match(tour, /const mediaUrl = _safeHttpUrl\(stop\.mediaUrl\)/, 'tour media images must be validated');
assert.match(tour, /const ctaUrl = _safeHttpUrl\(stop\.ctaUrl\)/, 'tour CTA links must be validated');
assert.match(tour, /const safeUrl = _safeMediaUrl\(url\)/, 'tour audio playback must validate URLs');
assert.match(tour, /function _safeAccentColor\(value\)/, 'tour colors must be allowlisted before entering inline styles');
console.log('Tour URL and style injection regression checks passed.');
