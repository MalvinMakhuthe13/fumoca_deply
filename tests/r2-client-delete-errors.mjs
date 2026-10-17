import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/r2Client.js', import.meta.url), 'utf8');
const match = source.match(/async function deleteR2Object\([\s\S]*?\n}\n/);
assert.ok(match, 'deleteR2Object helper must exist');
const calls = [];
const helper = new Function('fetch', 'WORKER_URL', `${match[0]}; return deleteR2Object;`);

const successFetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return new Response(JSON.stringify({ ok: true, deleted: 'owner/file.ply' }), { status: 200 });
};
const deleteObject = helper(successFetch, 'https://r2.example.test');
const result = await deleteObject('nif-files', 'owner/file.ply', 'test-token');
assert.equal(result.deleted, 'owner/file.ply');
assert.equal(calls.length, 1);
assert.match(calls[0].url, /bucket=nif-files/);
assert.match(calls[0].url, /owner%2Ffile.ply/);
assert.equal(calls[0].options.method, 'DELETE');
assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');

const denied = helper(async () => new Response(JSON.stringify({ error: 'Forbidden — you do not own this file key' }), { status: 403 }), 'https://r2.example.test');
await assert.rejects(
  () => denied('nif-files', 'someone-else/file.ply', 'test-token'),
  /Forbidden — you do not own this file key/,
  'HTTP authorization failures must reject instead of being reported as successful cleanup'
);

const serverError = helper(async () => new Response('storage unavailable', { status: 503 }), 'https://r2.example.test');
await assert.rejects(
  () => serverError('nif-videos', 'owner/source.mp4', 'test-token'),
  /storage unavailable/,
  'non-JSON Worker failures must be surfaced'
);

console.log('R2 client delete tests passed: successful deletion, encoded key/bucket, bearer auth, 403 denial, and 503 failure.');
