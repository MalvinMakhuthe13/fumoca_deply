import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feed = await readFile(new URL('../js/modules/feed.js', import.meta.url), 'utf8');
const profile = await readFile(new URL('../js/modules/profile.js', import.meta.url), 'utf8');
const preflight = await readFile(new URL('../preflight.html', import.meta.url), 'utf8');

for (const [name, source] of [['feed', feed], ['profile', profile], ['preflight', preflight]]) {
  assert.doesNotMatch(source, /job_id\s*\|\|\s*(?:row|item)\.id/, `${name} must not guess a job ID from a NIF ID`);
}
assert.match(feed, /rows\.map\(row => row\.job_id\)/, 'feed must collect only explicit job links');
assert.match(profile, /nifList\.map\(row => row\.job_id\)/, 'profile must collect only explicit job links');
assert.match(preflight, /if \(row\.job_id\)[\s\S]*?\.eq\('id', row\.job_id\)/, 'preflight must query a job only through the explicit link');
console.log('Explicit NIF-to-reconstruction job link contract passed.');
