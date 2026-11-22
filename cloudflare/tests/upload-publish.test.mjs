/**
 * Upload ownership and published delivery.
 * Run: node cloudflare/tests/upload-publish.test.mjs
 */
import { readFileSync } from 'fs';
import { assertUpload, authorizeStoredKey } from '../workers/upload-auth.js';
import { canReadPublic, canPublish } from '../workers/publish-auth.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const a = { id: 'user-a', kind: 'user' };
const b = { id: 'user-b', kind: 'user' };

assert(assertUpload(null, 'nif-files', 'x').status === 401, 'Missing auth');
assert(assertUpload(a, 'not-a-bucket', 'user-a/x').reason === 'invalid_bucket', 'Invalid bucket');
assert(assertUpload(a, 'nif-files', '').reason === 'invalid_key', 'Invalid key');
const own = assertUpload(a, 'nif-files', 'scene.nif');
assert(own.ok && own.key === 'user-a/scene.nif', 'Server binds key to caller');
assert(assertUpload(a, 'nif-files', 'user-b/scene.nif').status === 403, 'Cannot write another prefix');
assert(assertUpload(b, 'nif-files', 'user-a/scene.nif').status === 403, 'Cannot overwrite another user');

const registry = new Set(['published/scene.nif']);
assert(canReadPublic({ key: 'published/scene.nif', bucket: 'nif-files', registry }).ok, 'Published NIF');
assert(canReadPublic({ key: 'user-a/source.mp4', bucket: 'nif-files', registry }).status === 404, 'Source video hidden');
assert(canReadPublic({ key: 'user-a/cloud.ply', bucket: 'nif-files', registry }).status === 404, 'Splat hidden');
assert(canReadPublic({ key: 'jobs/intermediate.bin', bucket: 'nif-files', registry }).status === 404, 'Intermediate hidden');
assert(canReadPublic({ key: 'guessed.nif', bucket: 'nif-files', registry }).status === 404, 'Guessed key hidden');
assert(canReadPublic({ key: 'x', bucket: 'splat-videos', registry }).reason === 'bucket_rejected', 'Arbitrary bucket rejected');

assert(canPublish(null, {}).status === 401, 'Publish needs auth');
assert(canPublish(b, { FUMOCA_FOUNDER_IDS: 'user-a' }).status === 403, 'Non-founder cannot publish');
assert(canPublish(a, { FUMOCA_FOUNDER_IDS: 'user-a' }).ok, 'Founder can publish');

const putOwn = authorizeStoredKey(a, 'nif-files', 'user-a/edited.nif');
assert(putOwn.ok && putOwn.key === 'user-a/edited.nif', 'PUT keeps an owned key');
const putBound = authorizeStoredKey(a, 'nif-files', 'edited.nif');
assert(putBound.ok && putBound.key === 'user-a/edited.nif', 'PUT binds a bare key');
assert(authorizeStoredKey(a, 'nif-files', 'user-b/edited.nif').status === 403, 'PUT rejects a foreign key');
assert(authorizeStoredKey(a, 'nif-files', 'user-b/part.bin').status === 403, 'Multipart part rejects a foreign key');
assert(authorizeStoredKey(a, 'nif-files', 'user-b/upload.bin').status === 403, 'Multipart complete rejects a foreign key');
assert(authorizeStoredKey(b, 'thumbnails', 'user-b/thumb.jpg').ok, 'Thumbnail prefix stays with its owner');

const worker = readFileSync(new URL('../workers/r2-storage.js', import.meta.url), 'utf8');
for (const route of [
  "path === '/upload/multipart/create'",
  "path === '/upload/multipart/part'",
  "path === '/upload/multipart/complete'",
  "path === '/upload/multipart/abort'",
  "path.startsWith('/upload/')",
]) {
  const at = worker.indexOf(route);
  assert(at >= 0, 'Route present: ' + route);
  assert(worker.slice(at, at + 1600).includes('authorizeStoredKey'), 'Prefix check on ' + route);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
