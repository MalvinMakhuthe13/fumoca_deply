/**
 * DELETE ownership. Manipulated keys must not cross accounts.
 * Run: node cloudflare/tests/delete-auth.test.mjs
 */
import { canDelete, sanitiseKey } from '../workers/delete-auth.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

const owner = { id: 'user-a', kind: 'user' };
const other = { id: 'user-b', kind: 'user' };
const server = { id: 'server', kind: 'server-to-server' };

assert(canDelete(null, 'user-a/file.nif').status === 401, 'Unauthenticated');
assert(canDelete(owner, 'user-a/file.nif').ok, 'Owner prefix');
assert(canDelete(other, 'user-a/file.nif').status === 403, 'Non-owner');
assert(canDelete(owner, '../user-b/secret.nif').status === 403 || !canDelete(owner, '../user-b/secret.nif').ok, 'Traversal cannot reach another user');
assert(sanitiseKey('../user-b/secret.nif').indexOf('..') === -1, 'Dots stripped');
assert(canDelete(owner, 'poster-assets/user-a/poster.png').ok, 'Poster prefix');
assert(canDelete(other, 'poster-assets/user-a/poster.png').status === 403, 'Poster non-owner');
assert(canDelete(server, 'user-b/file.nif').ok, 'Server principal');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
