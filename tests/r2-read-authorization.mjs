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
const publicNif = { id: 'nif-public', user_id: 'user-a', r2_key: 'user-a/model.nif', is_public: true, meta: {} };
const privateNif = { id: 'nif-private', user_id: 'user-a', r2_key: 'user-a/private/model.nif', is_public: false, meta: {} };
const thumbPublic = { id: 'nif-thumb-public', user_id: 'user-a', r2_key: 'user-a/model.nif', is_public: true, meta: { thumbnail_r2_key: 'user-a/thumb.webp' } };
const thumbPrivate = { id: 'nif-thumb-private', user_id: 'user-a', r2_key: 'user-a/private/model.nif', is_public: false, meta: { thumbnail_r2_key: 'user-a/private-thumb.webp' } };
const sourceRow = { id: 'record-source', user_id: 'user-a', r2_key: 'user-a/model.nif', is_public: true, meta: { source_r2_key: 'record-source/raw.mp4' } };
const teaserPublic = { id: 'nif-teaser-public', user_id: 'user-a', r2_key: 'user-a/model.nif', is_public: true, meta: { teaser_video_r2_key: 'user-a/teasers/nif-teaser-public/teaser.webm' } };
const teaserPrivate = { id: 'nif-teaser-private', user_id: 'user-a', r2_key: 'user-a/private/model.nif', is_public: false, meta: { teaser_video_r2_key: 'user-a/teasers/nif-teaser-private/teaser.webm' } };
const run = (rows, jobs = [], responseStatus = 200) => helper(async (url, options) => {
  const parsed = new URL(url);
  assert.equal(options.headers.apikey, 'anon-test');
  if (parsed.pathname.endsWith('/reconstruction_jobs')) return new Response(JSON.stringify(jobs), { status: responseStatus });
  return new Response(JSON.stringify(rows), { status: responseStatus });
}, { error: () => {} });

let access = await run([publicNif])(req(), env, null, 'nif-files', 'user-a/model.nif');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif' });

access = await run([privateNif])(req(), env, null, 'nif-files', 'user-a/private/model.nif');
assert.equal(access.allowed, false, 'anonymous users must not read private NIFs');

access = await run([privateNif])(req('token-a'), env, userA, 'nif-files', 'user-a/private/model.nif');
assert.equal(access.allowed, true, 'owner can read their private NIF');
assert.equal(access.isPublic, false, 'owner read must not be marked public/cacheable');

access = await run([privateNif])(req('token-b'), env, userB, 'nif-files', 'user-a/private/model.nif');
assert.equal(access.allowed, false, 'different users must not read private NIFs');

access = await run([thumbPublic])(req(), env, null, 'thumbnails', 'user-a/thumb.webp');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-thumbnail' });

access = await run([thumbPrivate])(req(), env, null, 'thumbnails', 'user-a/private-thumb.webp');
assert.equal(access.allowed, false, 'private NIF thumbnail must not bypass visibility');

const mobilePublic = {
  id: 'nif-mobile-public', user_id: 'user-a', r2_key: 'published/mobile.nif',
  is_public: true, meta: { mobile_asset_r2_key: 'user-a/mobile-assets/nif-mobile-public/widget_1.html' },
};
const mobilePrivate = {
  id: 'nif-mobile-private', user_id: 'user-a', r2_key: 'private/mobile.nif',
  is_public: false, meta: { mobile_asset_r2_key: 'user-a/mobile-assets/nif-mobile-private/widget_1.html' },
};
access = await run([mobilePublic])(req(), env, null, 'nif-files', mobilePublic.meta.mobile_asset_r2_key);
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-mobile-asset' },
  'mobile widget is public only when its parent NIF is published');
access = await run([mobilePrivate])(req(), env, null, 'nif-files', mobilePrivate.meta.mobile_asset_r2_key);
assert.equal(access.allowed, false, 'private parent NIF must not expose its mobile widget');
access = await run([mobilePrivate])(req('token-a'), env, userA, 'nif-files', mobilePrivate.meta.mobile_asset_r2_key);
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-key' },
  'owner can read their private mobile widget through its owner-prefixed key');

const openVariantPublic = {
  id: 'nif-open-public', user_id: 'user-a', r2_key: 'published/open.nif',
  is_public: true, meta: { open_variant_r2_keys: ['user-a/open-variants/nif-open-public_door_1.nif'] },
};
const openVariantPrivate = {
  id: 'nif-open-private', user_id: 'user-a', r2_key: 'private/open.nif',
  is_public: false, meta: { open_variant_r2_keys: ['user-a/open-variants/nif-open-private_door_1.nif'] },
};
const openVariantKey = openVariantPublic.meta.open_variant_r2_keys[0];
access = await run([openVariantPublic])(req(), env, null, 'nif-files', openVariantKey);
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-open-variant' },
  'open-state variant is public only when its parent NIF is published');
access = await run([openVariantPrivate])(req(), env, null, 'nif-files', openVariantPrivate.meta.open_variant_r2_keys[0]);
assert.equal(access.allowed, false, 'private parent NIF must not expose an open-state variant');
access = await run([openVariantPrivate])(req('token-a'), env, userA, 'nif-files', openVariantPrivate.meta.open_variant_r2_keys[0]);
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-key' },
  'owner can read their private open-state variant through its owner-prefixed key');

access = await run([sourceRow])(req('token-a'), env, userA, 'nif-videos', 'record-source/raw.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-associated-file' },
  'owner can read a record-scoped source file linked through NIF metadata');
access = await run([])(req('token-a'), env, userA, 'nif-videos', 'raw/user-a/old_burst.zip');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'legacy-owner-key' },
  'owner can read legacy photo-burst files while old keys are migrated');

const cleanedSplatRow = {
  id: 'nif-cleaned',
  user_id: 'user-a',
  r2_key: 'user-a/original.nif',
  is_public: false,
  meta: { cleaned_splat: { r2_key: 'nif-cleaned/edited_cleaned_1.splat' } },
};
access = await run([cleanedSplatRow])(req('token-a'), env, userA, 'nif-files', 'nif-cleaned/edited_cleaned_1.splat');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-associated-file' },
  'owner can read a cleaned splat derivative registered in their NIF metadata');
access = await run([cleanedSplatRow])(req('token-b'), env, userB, 'nif-files', 'nif-cleaned/edited_cleaned_1.splat');
assert.equal(access.allowed, false, 'another user cannot read a cleaned splat derivative');

access = await run([], [{ id: 'job-1', user_id: 'user-a', raw_r2_key: 'user-a/raw.mp4' }])(req('token-a'), env, userA, 'nif-videos', 'user-a/raw.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-key' },
  'owner-prefixed reconstruction source files are readable without a cross-record metadata grant');

access = await run([sourceRow])(req(), env, null, 'nif-videos', 'private/raw.mp4');
assert.equal(access.allowed, false, 'raw source media must be private by default');

access = await run([])(req('token-a'), env, userA, 'preview-videos', 'user-a/preview.mp4');
assert.deepEqual(access, { allowed: true, isPublic: false, reason: 'owner-key' });

access = await run([teaserPublic])(req(), env, null, 'preview-videos', 'user-a/teasers/nif-teaser-public/teaser.webm');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-preview-video' }, 'published teaser video can be read publicly through its NIF association');

access = await run([teaserPrivate])(req(), env, null, 'preview-videos', 'user-a/teasers/nif-teaser-private/teaser.webm');
assert.equal(access.allowed, false, 'private NIF teaser video must remain private');

access = await run([])(req(), env, null, 'preview-videos', 'preview/unknown.mp4');
assert.equal(access.allowed, false, 'preview videos are private by default');

access = await run([])(req(), env, null, 'avatars', 'profile/avatar.webp');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'public-avatar' });

access = await run([])(req(), env, null, 'unexpected-bucket', 'anything');
assert.equal(access.allowed, false, 'unknown buckets must fail closed');

access = await run([], [], 503)(req(), env, null, 'nif-files', 'user-a/model.nif');
assert.equal(access.allowed, false, 'database lookup failures must fail closed');

const getStart = source.indexOf("if (request.method === 'GET' && path.startsWith('/file/'))");
const getEnd = source.indexOf("// ── DELETE /file/:key", getStart);
const getRoute = source.slice(getStart, getEnd);
assert.ok(getStart >= 0 && getEnd > getStart, 'GET file route must exist');
assert.ok(getRoute.indexOf('authorizeFileRead(') < getRoute.indexOf('cache.match('), 'authorization must happen before shared cache lookup');
assert.match(getRoute, /Cache-Control': rangeHeader \? 'no-store' : \(access\.isPublic \? .*: 'private, no-store'\)/);
assert.match(getRoute, /if \(access\.isPublic && !rangeHeader\) ctx\.waitUntil\(cache\.put/);
assert.match(getRoute, /'X-Content-Type-Options': 'nosniff'/);
assert.ok(getRoute.indexOf('verifyReadTicket(') < getRoute.indexOf('cache.match('), 'signed ticket validation must happen before cache lookup');
const ticketStart = source.indexOf("if (request.method === 'POST' && path === '/file/ticket')");
const ticketEnd = source.indexOf("// ── GET /file/:key", ticketStart);
assert.ok(ticketStart >= 0 && ticketEnd > ticketStart, 'private read ticket endpoint must exist');
const ticketRoute = source.slice(ticketStart, ticketEnd);
assert.ok(ticketRoute.indexOf('authorizeFileRead(') < ticketRoute.indexOf('createReadTicket('), 'tickets must only be issued after access authorization');
assert.match(ticketRoute, /expiresAt: Date\.now\(\) \+ 5 \* 60 \* 1000/);



const cleanedSplatLookups = source.match(/meta->cleaned_splat->>r2_key\.eq\.\$\{encodedKey\}/g) || [];
assert.equal(cleanedSplatLookups.length, 2,
  'cleaned splat keys must be included in both read and delete ownership lookups');
const mobileAssetLookups = source.match(/meta->>mobile_asset_r2_key\.eq\.\$\{encodedKey\}/g) || [];
assert.equal(mobileAssetLookups.length, 2,
  'mobile asset keys must be included in both read and delete ownership lookups');
const openVariantLookups = source.split('meta->open_variant_r2_keys.cs.{${encodedKey}}').length - 1;
assert.equal(openVariantLookups, 2,
  'open-state variant keys must be included in both read and delete ownership lookups');

const publicParent = {
  id: 'nif-a',
  user_id: 'user-a',
  r2_key: 'user-a/original.nif',
  is_public: true,
  meta: {
    open_variant_r2_keys: ['user-a/open-variants/nif-a_door_1.nif'],
    mobile_asset_r2_key: 'user-a/mobile-assets/nif-a/widget_1.html',
    thumbnail_r2_key: 'user-a/thumbnail.webp',
    teaser_video_r2_key: 'user-a/teasers/nif-a/teaser_1.webm',
  },
};
access = await run([publicParent])(req(), env, null, 'nif-files', 'user-a/open-variants/nif-a_door_1.nif');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-open-variant' },
  'a public NIF may expose only its own owner-prefixed open variant');
access = await run([publicParent])(req(), env, null, 'nif-files', 'user-a/mobile-assets/nif-a/widget_1.html');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-mobile-asset' },
  'a public NIF may expose only its own owner-prefixed mobile widget');
access = await run([publicParent])(req(), env, null, 'thumbnails', 'user-a/thumbnail.webp');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-thumbnail' },
  'a public NIF may expose its own owner-prefixed thumbnail');
access = await run([publicParent])(req(), env, null, 'preview-videos', 'user-a/teasers/nif-a/teaser_1.webm');
assert.deepEqual(access, { allowed: true, isPublic: true, reason: 'published-nif-preview-video' },
  'a public NIF may expose only its own record-scoped teaser video');

const maliciousParent = {
  id: 'nif-a',
  user_id: 'user-a',
  r2_key: 'user-a/original.nif',
  is_public: true,
  meta: {
    open_variant_r2_keys: ['user-b/open-variants/nif-b_door_1.nif'],
    mobile_asset_r2_key: 'user-b/mobile-assets/nif-b/widget_1.html',
    thumbnail_r2_key: 'user-b/thumbnail.webp',
    teaser_video_r2_key: 'user-b/teasers/nif-b/teaser_1.webm',
    cleaned_splat: { r2_key: 'nif-b/edited_cleaned_1.splat' },
  },
};
for (const [bucket, key] of [
  ['nif-files', 'user-b/open-variants/nif-b_door_1.nif'],
  ['nif-files', 'user-b/mobile-assets/nif-b/widget_1.html'],
  ['nif-files', 'nif-b/edited_cleaned_1.splat'],
  ['thumbnails', 'user-b/thumbnail.webp'],
  ['preview-videos', 'user-b/teasers/nif-b/teaser_1.webm'],
]) {
  access = await run([maliciousParent])(req(), env, null, bucket, key);
  assert.equal(access.allowed, false, `public NIF metadata must not expose another user's ${bucket} object: ${key}`);
}

console.log('R2 read authorization regression tests passed.');
