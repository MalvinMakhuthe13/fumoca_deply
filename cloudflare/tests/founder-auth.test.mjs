/**
 * Server founder auth. Does not trust browser email.
 * Run: node cloudflare/tests/founder-auth.test.mjs
 */
import { isFounderId, authorizeFounder } from '../workers/founder-auth.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', FUMOCA_FOUNDER_IDS: 'founder-uuid' };
assert(isFounderId('founder-uuid', env), 'Founder id matches');
assert(!isFounderId('other-uuid', env), 'Non-founder id rejected');
assert(!isFounderId('founder-uuid', { FUMOCA_FOUNDER_IDS: '' }), 'Empty allowlist rejects');

function req(token) {
  return { headers: { get: (k) => k === 'Authorization' && token ? `Bearer ${token}` : '' } };
}
function fakeFetch(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

let r = await authorizeFounder(req(''), env, fakeFetch(200, { id: 'founder-uuid' }));
assert(r.status === 401 && r.reason === 'no_token', 'No token');

r = await authorizeFounder(req('bad'), env, fakeFetch(401, {}));
assert(r.status === 401 && r.reason === 'invalid_token', 'Invalid token');

r = await authorizeFounder(req('ok'), env, fakeFetch(200, { id: 'other-uuid' }));
assert(r.status === 403 && r.reason === 'not_founder', 'Valid non-founder');

r = await authorizeFounder(req('ok'), env, fakeFetch(200, { id: 'founder-uuid' }));
assert(r.ok && r.status === 200, 'Valid founder');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
