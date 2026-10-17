import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');
const start = source.indexOf('function bytesToBase64Url(');
const end = source.indexOf('// ── Key sanitisation', start);
assert.ok(start >= 0 && end > start, 'read ticket helpers must exist');
const helpers = source.slice(start, end);
const { createReadTicket, verifyReadTicket } = new Function(
  'crypto', 'TextEncoder', 'TextDecoder', 'btoa', 'atob',
  `${helpers}; return { createReadTicket, verifyReadTicket };`
)(webcrypto, TextEncoder, TextDecoder, btoa, atob);

const now = 1_800_000_000_000;
const secret = 'test-only-ticket-secret';
const ticket = await createReadTicket('nif-files', 'owner/private.nif', secret, now);
assert.equal(await verifyReadTicket(ticket, 'nif-files', 'owner/private.nif', secret, now), true);
assert.equal(await verifyReadTicket(ticket, 'nif-videos', 'owner/private.nif', secret, now), false, 'ticket must be bucket-bound');
assert.equal(await verifyReadTicket(ticket, 'nif-files', 'other/private.nif', secret, now), false, 'ticket must be key-bound');
assert.equal(await verifyReadTicket(ticket, 'nif-files', 'owner/private.nif', 'wrong-secret', now), false, 'ticket must be secret-bound');
assert.equal(await verifyReadTicket(ticket, 'nif-files', 'owner/private.nif', secret, now + 6 * 60 * 1000), false, 'expired ticket must be rejected');
assert.equal(await verifyReadTicket(ticket.slice(0, -2) + 'xx', 'nif-files', 'owner/private.nif', secret, now), false, 'tampered ticket must be rejected');
assert.equal(await verifyReadTicket('not-a-ticket', 'nif-files', 'owner/private.nif', secret, now), false);
console.log('R2 signed read-ticket tests passed.');
