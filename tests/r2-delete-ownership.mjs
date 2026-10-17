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
  const parsed = new URL(String(url));
  const requestedId = parsed.searchParams.get('id')?.slice(3);
  const requestedOr = parsed.searchParams.get('or') || '';
  let rows = [];
  if (requestedId === 'record-456') {
    rows = [{ id: 'record-456', user_id: 'user-123', r2_key: 'record-456/edited_123.ply', meta: {} }];
  } else if (requestedOr.includes('edited_123.ply')) {
    rows = [{ id: 'record-456', user_id: 'user-123', r2_key: 'record-456/edited_123.ply', meta: {} }];
  } else if (requestedOr.includes('source.mp4')) {
    rows = [{ id: 'record-456', user_id: 'user-123', r2_key: 'record-456/edited_123.ply', meta: { source_r2_key: 'record-456/source.mp4' } }];
  } else if (requestedOr.includes('thumb.webp') && !requestedOr.includes('user-b/thumb.webp')) {
    rows = [{ id: 'record-456', user_id: 'user-123', r2_key: 'record-456/edited_123.ply', meta: { thumbnail_r2_key: 'record-456/thumb.webp' } }];
  } else if (requestedOr.includes('user-b/thumb.webp')) {
    rows = [{ id: 'record-456', user_id: 'user-123', r2_key: 'record-456/edited_123.ply', meta: { thumbnail_r2_key: 'user-b/thumb.webp' } }];
  } else if (requestedOr.includes('teaser.webm')) {
    rows = [{ id: 'record-456', user_id: 'user-123', r2_key: 'record-456/edited_123.ply', meta: { teaser_video_r2_key: 'record-456/teaser.webm' } }];
  }
  return new Response(JSON.stringify(rows), { status: 200 });
};
const check = new Function('fetch', `${helperSource}; return userOwnsFileKey;`)(mockFetch);

assert.equal(await check(request, env, user, 'nif-files', 'user-123/source.ply'), true, 'own user-prefix upload');
assert.equal(await check(request, env, user, 'nif-videos', 'raw/user-123/old_burst.zip'), true, 'legacy photo-burst keys remain deletable by their owner');
assert.equal(fetchCalls, 0, 'prefix ownership needs no database lookup');
assert.equal(await check(request, env, user, 'nif-files', 'record-456/edited_123.ply'), true, 'owned Studio derivative');
assert.equal(fetchCalls, 1, 'Studio derivative must check the record owner');
assert.equal(await check(request, env, user, 'nif-files', 'record-999/edited_123.ply'), false, 'unowned Studio derivative is denied');
assert.equal(await check(request, env, user, 'nif-files', 'other-user/private.ply'), false, 'other user prefix is denied');
assert.equal(await check(request, env, user, 'nif-videos', 'record-456/source.mp4'), true, 'owned source capture can be deleted from nif-videos');
assert.equal(await check(request, env, user, 'thumbnails', 'record-456/thumb.webp'), true, 'owned thumbnail can be deleted from thumbnails');
assert.equal(await check(request, env, user, 'thumbnails', 'user-b/thumb.webp'), false, 'a metadata reference cannot grant delete rights to another user’s thumbnail');
assert.equal(await check(request, env, user, 'preview-videos', 'record-456/teaser.webm'), true, 'owned teaser video can be deleted from preview-videos');
assert.equal(await check(request, env, user, 'nif-videos', 'record-999/source.mp4'), false, 'unknown source key is denied');
assert.equal(await check(request, env, { id: 'server', kind: 'server-to-server' }, 'nif-files', 'any/key.ply'), true, 'trusted server principal may clean up its artifacts');
const noTokenRequest = { headers: { get: () => '' } };
assert.equal(await check(noTokenRequest, env, user, 'nif-files', 'record-456/edited_123.ply'), false, 'missing token fails closed');
console.log('R2 delete ownership tests passed: user prefixes, owned derivatives, cross-user denial, server principal, and missing token.');

const mayWrite = new Function('fetch', `${writeHelperSource}; return userMayWriteFileKey;`)(mockFetch);
assert.equal(await mayWrite(request, env, user, 'nif-files', 'user-123/new-upload.ply'), true, 'user may write under own prefix');
assert.equal(await mayWrite(request, env, user, 'nif-videos', 'raw/user-123/legacy_burst.zip'), true, 'legacy photo-burst keys remain owner-scoped during migration');
assert.equal(await mayWrite(request, env, user, 'nif-files', 'record-456/edited_999.ply'), true, 'owner may create a new Studio derivative before r2_key updates');
assert.equal(await mayWrite(request, env, user, 'nif-files', 'record-999/edited_999.ply'), false, 'cross-user Studio derivative write is denied');
assert.equal(await mayWrite(request, env, user, 'nif-files', 'record-456/original.ply'), false, 'non-derivative record paths are denied');
assert.equal(await mayWrite(request, env, user, 'nif-videos', 'other-user/video.mp4'), false, 'cross-user bucket key is denied');
assert.equal(await mayWrite(request, env, { id: 'server', kind: 'server-to-server' }, 'nif-files', 'any/key.ply'), true, 'trusted server principal may write artifacts');
assert.equal(await mayWrite(noTokenRequest, env, user, 'nif-files', 'record-456/edited_999.ply'), false, 'missing token fails closed for record writes');
console.log('R2 write ownership tests passed: user prefixes, new owned derivatives, cross-user denial, bucket isolation, trusted server, and missing token.');

const abortStart = source.indexOf("if (request.method === 'POST' && path === '/upload/multipart/abort')");
const abortEnd = source.indexOf("if (request.method === 'PUT' && path.startsWith('/upload/'))", abortStart);
assert.ok(abortStart >= 0 && abortEnd > abortStart, 'multipart abort route exists');
const abortRoute = source.slice(abortStart, abortEnd);
assert.match(abortRoute, /userMayWriteFileKey\(request, env, principal, bucketParam, fileKey\)/, 'multipart abort checks ownership before aborting upload');
assert.ok(abortRoute.indexOf('userMayWriteFileKey') < abortRoute.indexOf('resumeMultipartUpload'), 'ownership check must run before touching multipart upload');
console.log('R2 multipart abort ownership guard passed.');
