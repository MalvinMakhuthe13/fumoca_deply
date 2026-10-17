import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/publish-to-fumoca.js', import.meta.url), 'utf8');
const start = source.indexOf('async function publish(');
const end = source.indexOf('\n  // ── Build the publish UI panel', start);
assert.ok(start >= 0 && end > start, 'publish function must exist');
const publish = source.slice(start, end);
assert.match(publish, /visibility === 'followers'/, 'unsupported followers-only mode must fail closed');
assert.match(publish, /sb\.auth\.getUser\(\)/, 'publishing must require a real authenticated user');
assert.match(publish, /rec\?\.user_id && rec\.user_id !== user\.id/, 'publishing must reject cross-user edits');
assert.match(publish, /\$\{user\.id\}\/edited_\$\{timestamp\}\.nif/, 'new assets must use the authenticated user prefix');
assert.match(publish, /\.eq\('id', splatId\)\.eq\('user_id', user\.id\)/, 'existing records must be updated only for the owner');
assert.match(publish, /if \(error \|\| !updated\?\.id\)/, 'DB update failures must not be reported as successful publish');
assert.match(publish, /if \(error \|\| !newRec\?\.id\)/, 'new record insert failures must not be reported as successful publish');
assert.match(publish, /viewer\.html\?nifId=/, 'viewer redirect must use the parameter the viewer actually reads');
console.log('NIF publish ownership and persistence contract passed.');
