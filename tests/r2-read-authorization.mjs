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

const helper = new Function('fetch', 'console', `${extractFunction('authorizeFileRead')}; return authorizeFileRead;`);
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon-test' };
const req = (token = null) => new Request('https://r2.example.test/file/asset', {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const userA = { id: 'user-a', kind: 'user' };
const userB = { id: 'user-b', kind: 'user' };
const publicNif = { id: 'nif-public', user_id: 'user-a', r2_key: 'published/model.nif', is_public: true, meta: {} };
const privateNif = { id: 'nif-private', user_id: 'user-a', r2_key: 'private/model.nif', is_public: false, meta: {} };
const thumbPublic = { id: 'nif-thumb-public', user_id: 'user-a', r2_key: 'published/model.nif', is_public: true, meta: { thumbnail_r2_key: 'published/thumb.webp' } };
const thumbPrivate = { id: 'nif-thumb-private', user_id: 'user-a', r2_key: 'private/model.nif', is_public: false, meta: { thumbnail_r2_key: 'private/thumb.webp' } };
const sourceRow = { id: 'nif-source', user_id: 'user-a', r2_key: 'published/model.nif', is_public: true, meta: { source_r2_key: 'record-source/raw.mp4' } };
const run = (rows, jobs = [], responseStatus = 200) => helper(async (url, options) => {
  const parsed = new URL(url);
  assert.equal(options.headers.apikey, 'anon-test');
  if (parsed.pathname.endsWith('/reconstruction_jobs')) return new Response(JSON.stringify(jobs), { status: responseStatus });
  return new Response(JSON.stringify(rows), { status: responseStatus });
}, { error: () => {} });

let access = await run([publicNif])(req(), env, null, 'nif-files', 'published/model.nif');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif' });

access = await run([privateNif])(req(), env, null, 'nif-files', 'private/model.nif');
assert.equal(access.allowed, false, 'anonymous users must not read private NIFs');

access = await run([privateNif])(req('token-a'), env, userA, 'nif-files', 'private/model.nif');
assert.equal(access.allowed, true, 'owner can read their private NIF');
assert.equal(access.isPublic, false, 'owner read must not be marked public/cacheable');

access = await run([privateNif])(req('token-b'), env, userB, 'nif-files', 'private/model.nif');
assert.equal(access.allowed, false, 'different users must not read private NIFs');

access = await run([thumbPublic])(req(), env, null, 'thumbnails', 'published/thumb.webp');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-thumbnail' });

access = await run([thumbPrivate])(req(), env, null, 'thumbnails', 'private/thumb.webp');
assert.equal(access.allowed, false, 'private NIF thumbnail must not bypass visibility');

access = await run([sourceRow])(req('token-a'), env, userA, 'nif-videos', 'user-a/raw.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-key' });

access = await run([sourceRow])(req('token-a'), env, userA, 'nif-videos', 'record-source/raw.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-associated-file' }, 'owner can read source media linked through NIF metadata');

access = await run([], [{ id: 'job-1', user_id: 'user-a', raw_r2_key: 'record-source/raw.mp4' }])(req('token-a'), env, userA, 'nif-videos', 'record-source/raw.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-source-job' }, 'owner can read raw source keys stored on reconstruction_jobs');

access = await run([sourceRow])(req(), env, null, 'nif-videos', 'private/raw.mp4');
assert.equal(access.allowed, false, 'raw source media must be private by default');

access = await run([])(req('token-a'), env, userA, 'preview-videos', 'user-a/preview.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-key' });

access = await run([])(req(), env, null, 'preview-videos', 'preview/unknown.mp4');
assert.equal(access.allowed, false, 'preview videos are private by default');

access = await run([])(req(), env, null, 'avatars', 'profile/avatar.webp');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'public-avatar' });

access = await run([])(req(), env, null, 'unexpected-bucket', 'anything');
assert.equal(access.allowed, false, 'unknown buckets must fail closed');

access = await run([], [], 503)(req(), env, null, 'nif-files', 'published/model.nif');
assert.equal(access.allowed, false, 'database lookup failures must fail closed');

const getStart = source.indexOf("if (request.method === 'GET' && path.startsWith('/file/'))");
const getEnd = source.indexOf("// ── DELETE /file/:key", getStart);
const getRoute = source.slice(getStart, getEnd);
assert.ok(getStart >= 0 && getEnd > getStart, 'GET file route must exist');
assert.ok(getRoute.indexOf('authorizeFileRead(') < getRoute.indexOf('cache.match('), 'authorization must happen before shared cache lookup');
assert.match(getRoute, /Cache-Control': rangeHeader \\? 'no-store' : \\(access\\.isPublic \\? `public, max-age=\\$\\{ttl\\}` : 'private, no-store'\\)/);
assert.match(getRoute, /if \(access\.isPublic\) ctx\.waitUntil\(cache\.put/);
assert.match(getRoute, /'X-Content-Type-Options': 'nosniff'/);
assert.ok(getRoute.indexOf('verifyReadTicket(') < getRoute.indexOf('cache.match('), 'signed ticket validation must happen before cache lookup');
const ticketStart = source.indexOf("if (request.method === 'POST' && path === '/file/ticket')");
const ticketEnd = source.indexOf("// ── GET /file/:key", ticketStart);
assert.ok(ticketStart >= 0 && ticketEnd > ticketStart, 'private read ticket endpoint must exist');
const ticketRoute = source.slice(ticketStart, ticketEnd);
assert.ok(ticketRoute.indexOf('authorizeFileRead(') < ticketRoute.indexOf('createReadTicket('), 'tickets must only be issued after access authorization');
assert.match(ticketRoute, /expiresAt: Date\.now\(\) \+ 5 \* 60 \* 1000/);



console.log('R2 read authorization regression tests passed.');
