import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const commerce = await readFile(new URL('../js/modules/commerce.js', import.meta.url), 'utf8');
assert.match(commerce, /function _safeHttpUrl\(value\)/, 'commerce URLs must be protocol-validated');
assert.match(commerce, /\['http:', 'https:'\]\.includes\(url\.protocol\)/, 'commerce must reject javascript:, data: and other schemes');
assert.match(commerce, /_safeHttpUrl\(hotspot\.productImage \|\| ''\)/, 'product image URLs must be validated');
assert.match(commerce, /_safeHttpUrl\(hotspot\.productUrl \|\| hotspot\.ctaLink \|\| hotspot\.link \|\| ''\)/, 'buy links must be validated');
assert.match(commerce, /function _safeAccentColor\(value\)/, 'brand colors must be allowlisted before entering style attributes');
assert.doesNotMatch(commerce, /background:center\/cover no-repeat url\('\$\{image\}'\)/, 'raw product URLs must not be interpolated into CSS url()');

const teaser = await readFile(new URL('../js/modules/teaser-video.js', import.meta.url), 'utf8');
assert.match(teaser, /const safeBlobUrl = typeof blobUrl === 'string' && blobUrl\.startsWith\('blob:'\)/, 'teaser preview/download must use a blob URL');
assert.match(teaser, /if \(\['http:', 'https:'\]\.includes\(parsed\.protocol\)\) shareUrl = parsed\.href/, 'shared teaser URLs must be HTTP(S) only');
assert.doesNotMatch(teaser, /onclick="navigator\.clipboard\.writeText/, 'copy action must not embed URLs in inline JavaScript');
assert.doesNotMatch(teaser, /onclick="navigator\.share\?\./, 'share action must not embed URLs in inline JavaScript');
assert.match(teaser, /copyButton\?\.addEventListener\('click'/, 'copy action must use a DOM event listener');
assert.match(teaser, /shareButton\?\.addEventListener\('click'/, 'share action must use a DOM event listener');
console.log('Commerce and teaser URL/XSS regression checks passed.');
