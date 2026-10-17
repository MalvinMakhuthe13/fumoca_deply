import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');
const start = source.indexOf('function parseByteRange(');
assert.notEqual(start, -1, 'parseByteRange must exist');
const brace = source.indexOf('{', start);
let depth = 0, quote = null, escaped = false, end = -1;
for (let i = brace; i < source.length; i++) {
  const ch = source[i];
  if (quote) { if (escaped) { escaped = false; continue; } if (ch === '\\\\') { escaped = true; continue; } if (ch === quote) quote = null; continue; }
  if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
  if (ch === '{') depth++;
  if (ch === '}' && --depth === 0) { end = i + 1; break; }
}
assert.ok(end > start, 'parseByteRange must have a complete body');
const parseByteRange = new Function(`${source.slice(start, end)}; return parseByteRange;`)();

assert.deepEqual(parseByteRange(null, 100), null);
assert.deepEqual(parseByteRange('bytes=0-0', 100), { start: 0, end: 0, length: 1 });
assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19, length: 10 });
assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99, length: 10 });
assert.deepEqual(parseByteRange('bytes=-5', 100), { start: 95, end: 99, length: 5 });
assert.deepEqual(parseByteRange('bytes=0-500', 100), { start: 0, end: 99, length: 100 });
for (const invalid of ['bytes=-0', 'bytes=100-101', 'bytes=10-9', 'bytes=1-2,4-5', 'bytes=a-b']) {
  assert.deepEqual(parseByteRange(invalid, 100), { invalid: true }, `${invalid} must be rejected`);
}
assert.deepEqual(parseByteRange('bytes=0-0', 0), { invalid: true }, 'empty objects cannot satisfy byte ranges');

const routeStart = source.indexOf("if (request.method === 'GET' && path.startsWith('/file/'))");
const routeEnd = source.indexOf('// ── DELETE /file/:key', routeStart);
const route = source.slice(routeStart, routeEnd);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'GET file route must exist');
assert.match(route, /const head = await r2Bucket\.head\(fileKey\)/, 'range reads must determine object size before requesting a slice');
assert.match(route, /range: \{ offset: parsedRange\.start, length: parsedRange\.length \}/, 'R2 must receive the bounded range');
assert.match(route, /status: parsedRange \? 206 : 200/, 'valid byte ranges must return HTTP 206');
assert.match(route, /if \(access\.isPublic && !rangeHeader\) ctx\.waitUntil\(cache\.put/, 'range responses must bypass the shared object cache');
console.log('R2 byte-range parsing and cache-isolation tests passed.');
