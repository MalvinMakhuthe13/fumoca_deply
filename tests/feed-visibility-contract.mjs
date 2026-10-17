import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/feed.js', import.meta.url), 'utf8');
const start = source.indexOf('async function fetchFeedNifs()');
const end = source.indexOf('\nasync function fetchProfilesFor', start);
assert.ok(start >= 0 && end > start, 'fetchFeedNifs must exist');
const fn = source.slice(start, end);
assert.match(fn, /\.from\('nif_files'\)\s*\.select\('\*'\)\s*\.eq\('is_public', true\)/, 'anonymous feed results must explicitly require is_public=true');
assert.match(fn, /\.eq\('user_id', currentUserId\)/, 'signed-in users may also see their own private NIFs');
assert.match(fn, /row\.job_id \? byId\.get\(jobId\) : null|const jobId = row\.job_id/, 'job state must use explicit job IDs rather than assuming NIF IDs are job IDs');
console.log('Feed visibility and job-reference contract passed.');
