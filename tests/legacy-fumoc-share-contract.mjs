import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const convert = await readFile(new URL('../convert.html', import.meta.url), 'utf8');
const policies = await readFile(new URL('../supabase_storage_policies.sql', import.meta.url), 'utf8');

const start = convert.indexOf('async function uploadForShare(');
const end = convert.indexOf('\n}', start);
assert.ok(start >= 0 && end > start, 'FUMOC share upload function must exist');
const upload = convert.slice(start, end);
assert.match(upload, /sb\.auth\.getUser\(\)/, 'FUMOC share uploads must require a signed-in user');
assert.match(upload, /\$\{user\.id\}\/public-convert\//, 'share objects must use the authenticated user prefix');
assert.match(upload, /contentType: 'application\/fumoc'/, 'FUMOC MIME type must match the storage bucket allow-list');
assert.match(convert, /const shareWindow = window\.open\('about:blank', '_blank'\);[\s\S]*?const shareUrl = await uploadForShare/,
  'share tab must be opened during the user gesture before asynchronous upload work');
assert.match(convert, /window\.prompt\('Copy your FUMOCA share link:'/,
  'share link must remain recoverable when the browser blocks popups and clipboard access');
assert.match(upload, /safeName = String\(filename[\s\S]*replace\(\/\[\^A-Za-z0-9\._-\]\/g, '_'/,
  'uploaded share filename must be sanitized');
assert.match(policies, /'splat-files',[^\n]*'application\/fumoc'/,
  'splat-files bucket must permit the FUMOC content type');
assert.match(policies, /\('splat-files', 'splat-files', true,/,
  'the share bucket must remain explicitly public for generated share URLs');
assert.match(policies, /create policy "Public read splat files"[\s\S]*?to public[\s\S]*?using \(bucket_id = 'splat-files'\)/,
  'public share links must have an explicit public-read policy');
for (const policy of ['Users upload own FUMOC files', 'Users update own FUMOC files', 'Users delete own FUMOC files']) {
  assert.ok(policies.includes(policy), `missing owner-scoped storage policy: ${policy}`);
}
assert.match(policies, /bucket_id = 'splat-files'[\s\S]*?\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
console.log('Legacy FUMOC share upload and owner-scoped storage policy contract passed.');
