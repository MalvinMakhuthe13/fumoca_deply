import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { privateOwner, canRead } from '../cloudflare/workers/read-auth.js';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const privateKeys = [
  ['vehicle-captures/' + owner + '/session/exterior.webm', owner],
  ['raw/' + owner + '/capture.zip', owner],
  ['verify-refs/' + owner + '/reference.jpg', owner],
  [owner + '/1720000000_capture.mp4', owner],
  [owner + '/sources/original.mp4', owner],
];
for (const [key, expectedOwner] of privateKeys) {
  assert.equal(privateOwner('nif-videos', key), expectedOwner, key + ' must be owner-private');
  assert.equal(canRead({ id: owner, kind: 'user' }, 'nif-videos', key).ok, true, 'owner can read ' + key);
  assert.equal(canRead({ id: other, kind: 'user' }, 'nif-videos', key).status, 404, 'other user cannot read ' + key);
  assert.equal(canRead(null, 'nif-videos', key).status, 401, 'anonymous cannot read ' + key);
}
assert.equal(privateOwner('nif-videos', 'published/demo.mp4'), null, 'non-private public assets remain public');

const sql = await readFile(new URL('../supabase_migration_job_retry_and_rls.sql', import.meta.url), 'utf8');
assert.match(sql, /raw_r2_key is not null/);
assert.match(sql, /split_part\(raw_r2_key, '\/', 1\) = auth\.uid\(\)::text/);
assert.match(sql, /split_part\(raw_r2_key, '\/', 2\) = auth\.uid\(\)::text/);
assert.match(sql, /jsonb_typeof\(j\.meta->'retry_count'\) <> 'number'/);
assert.match(sql, /greatest\(0, least\(3,/);
assert.match(sql, /Retry counter is invalid/);
console.log('Private capture read access and reconstruction-job raw-key ownership tests passed.');
