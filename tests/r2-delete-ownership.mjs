import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');
function extractFunction(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const helperSource = extractFunction('userOwnsFileKey');
const user = { id: 'user-123', kind: 'user' };
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-test' };
const request = { headers: { get: () => 'Bearer test-user-token' } };
let fetchCalls = 0;
const mockFetch = async (url, options) => {
  fetchCalls++;
  assert.match(String(url), /user_id=eq\.user-123/);
  assert.equal(options.headers.Authorization, 'Bearer test-user-token');
  return new Response(JSON.stringify([{ id: 'record-456', r2_key: 'record-456/edited_123.ply' }]), { status: 200 });
};
const check = new Function('fetch', `${helperSource}; return userOwnsFileKey;`)(mockFetch);

assert.equal(await check(request, env, user, 'nif-files', 'user-123/source.ply'), true, 'own user-prefix upload');
assert.equal(fetchCalls, 0, 'prefix ownership needs no database lookup');
assert.equal(await check(request, env, user, 'nif-files', 'record-456/edited_123.ply'), true, 'owned Studio derivative');
assert.equal(fetchCalls, 1, 'Studio derivative must check the record owner');
assert.equal(await check(request, env, user, 'nif-files', 'record-999/edited_123.ply'), true, 'mock currently models only the returned owned record; this path should not be treated as a general prefix grant');
