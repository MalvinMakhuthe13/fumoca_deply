import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');
const start = source.indexOf('function sanitiseKey(');
assert.notEqual(start, -1, 'sanitiseKey must exist');
const brace = source.indexOf('{', start);
let depth = 0, quote = null, escaped = false;
let end = -1;
for (let i = brace; i < source.length; i++) {
  const ch = source[i];
  if (quote) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === quote) quote = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
  if (ch === '{') depth++;
  if (ch === '}' && --depth === 0) { end = i + 1; break; }
}
assert.ok(end > start, 'sanitiseKey body must parse');
const sanitiseKey = new Function('MAX_KEY_LENGTH', `${source.slice(start, end)}; return sanitiseKey;`)(500);

assert.equal(sanitiseKey('user-a/model.ply'), 'user-a/model.ply');
assert.equal(sanitiseKey('/user-a//model.ply'), 'user-a/model.ply');
assert.equal(sanitiseKey('user-a\\\\model.ply'), 'user-a/model.ply');
assert.equal(sanitiseKey('../private/model.ply'), '');
assert.equal(sanitiseKey('user-a/../other/private.ply'), '');
assert.equal(sanitiseKey('user-a/./model.ply'), '');
assert.equal(sanitiseKey('a'.repeat(501)), '', 'overlong key must be rejected, not truncated to another object');
assert.equal(sanitiseKey('bad\0key'), '', 'NUL bytes must be rejected');
for (const reserved of ['user-a/model,other.ply', 'user-a/(model).ply', 'user-a/{model}.ply', 'user-a/"model".ply', "user-a/'model'.ply", 'user-a/model\n.ply']) {
  assert.equal(sanitiseKey(reserved), '', `PostgREST filter/control character must be rejected: ${JSON.stringify(reserved)}`);
}
assert.equal(sanitiseKey(''), '');
assert.equal(sanitiseKey(null), '');
console.log('R2 key sanitization regression tests passed.');
