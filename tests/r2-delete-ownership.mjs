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
const writeHelperSource = extractFunction('userMayWriteFileKey');
const user = { id: 'user-123', kind: 'user' };
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-test' };
const request = { headers: { get: () => 'Bearer test-user-token' } };
let fetchCalls = 0;
const mockFetch = async (url, options) => {
  fetchCalls++;
  assert.match(String(url), /user_id=eq\.user-123/);
  assert.equal(options.headers.Authorization, 'Bearer test-user-token');
  const requestedId = new URL(String(url)).searchParams.get('id')?.slice(3);
  const rows = requestedId === 'record-456' ? [{ id: 'record-456', r2_key: 'record-456/edited_123.ply' }] : [];
  return new Response(JSON.stringify(rows), { status: 200 });
};
const check = new Function('fetch', `${helperSource}; return userOwnsFileKey;`)(mockFetch);

assert.equal(await check(request, env, user, 'nif-files', 'user-123/source.ply'), true, 'own user-prefix upload');
assert.equal(fetchCalls, 0, 'prefix ownership needs no database lookup');
assert.equal(await check(request, env, user, 'nif-files', 'record-456/edited_123.ply'), true, 'owned Studio derivative');
assert.equal(fetchCalls, 1, 'Studio derivative must check the record owner');
assert.equal(await check(request, env, user, 'nif-files', 'record-999/edited_123.ply'), false, 'unowned Studio derivative is denied');
assert.equal(await check(request, env, user, 'nif-files', 'other-user/private.ply'), false, 'other user prefix is denied');
assert.equal(await check(request, env, { id: 'server', kind: 'server-to-server' }, 'nif-files', 'any/key.ply'), true, 'trusted server principal may clean up its artifacts');
const noTokenRequest = { headers: { get: () => '' } };
assert.equal(await check(noTokenRequest, env, user, 'nif-files', 'record-456/edited_123.ply'), false, 'missing token fails closed');
console.log('R2 delete ownership tests passed: user prefixes, owned derivatives, cross-user denial, server principal, and missing token.');

const mayWrite = new Function('fetch', `${writeHelperSource}; return userMayWriteFileKey;`)(mockFetch);
assert.equal(await mayWrite(request, env, user, 'nif-files', 'user-123/new-upload.ply'), true, 'user may write under own prefix');
assert.equal(await mayWrite(request, env, user, 'nif-files', 'record-456/edited_999.ply'), true, 'owner may create a new Studio derivative before r2_key updates');
assert.equal(await mayWrite(request, env, user, 'nif-files', 'record-999/edited_999.ply'), false, 'cross-user Studio derivative write is denied');
assert.equal(await mayWrite(request, env, user, 'nif-files', 'record-456/original.ply'), false, 'non-derivative record paths are denied');
assert.equal(await mayWrite(request, env, user, 'nif-videos', 'other-user/video.mp4'), false, 'cross-user bucket key is denied');
assert.equal(await mayWrite(request, env, { id: 'server', kind: 'server-to-server' }, 'nif-files', 'any/key.ply'), true, 'trusted server principal may write artifacts');
assert.equal(await mayWrite(noTokenRequest, env, user, 'nif-files', 'record-456/edited_999.ply'), false, 'missing token fails closed for record writes');
console.log('R2 write ownership tests passed: user prefixes, new owned derivatives, cross-user denial, bucket isolation, trusted server, and missing token.');

