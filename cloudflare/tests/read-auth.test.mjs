/** READ ownership for private capture material. Run: node cloudflare/tests/read-auth.test.mjs */
import { canRead, privateOwner } from '../workers/read-auth.js';
let passed = 0, failed = 0;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); failed++; } else { console.log('PASS:', m); passed++; } };
const A = '11111111-2222-3333-4444-555555555555', B = '66666666-7777-8888-9999-000000000000';
assert(privateOwner('nif-videos', `raw/${A}/1_burst.zip`) === A, 'raw zip is private');
assert(privateOwner('nif-videos', `${A}/sources/x.ply`) === A, 'original sources are private');
assert(privateOwner('nif-videos', `verify-refs/${A}/ref.jpg`) === A, 'verification photos are private');
assert(privateOwner('nif-videos', `review/123_clip.mp4`) === null, 'review videos stay public');
assert(privateOwner('nif-files', `${A}/scan.nif`) === null, 'published NIFs stay public');
assert(privateOwner('thumbnails', `raw/${A}/x`) === null, 'rules are per bucket');
assert(canRead(null, 'nif-videos', `raw/${A}/z.zip`).status === 401, 'signed-out read refused');
assert(canRead({ id: B, kind: 'user' }, 'nif-videos', `raw/${A}/z.zip`).status === 404, 'other user gets not-found');
assert(canRead({ id: A, kind: 'user' }, 'nif-videos', `raw/${A}/z.zip`).ok, 'owner can read');
assert(canRead({ id: 'server', kind: 'server-to-server' }, 'nif-videos', `raw/${A}/z.zip`).ok, 'workers can read');
assert(canRead(null, 'nif-videos', 'review/a.mp4').ok, 'public read unaffected');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
