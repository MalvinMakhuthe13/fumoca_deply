import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../capture-vehicle.html', import.meta.url), 'utf8');
const start = html.indexOf('async function uploadAll() {');
const end = html.indexOf('\n// ── Restart current phase', start);
assert.ok(start >= 0 && end > start, 'vehicle uploadAll must exist');
const upload = html.slice(start, end);
assert.match(upload, /supabase\.auth\.getUser\(\)/, 'vehicle upload requires an authenticated user');
assert.match(upload, /r2\.from\('nif-videos'\)\.upload\(/, 'vehicle clips must upload through the R2 client API');
assert.match(upload, /\$\{user\.id\}\/captures\//, 'uploaded keys must be scoped to the authenticated owner');
assert.match(upload, /from\('reconstruction_jobs'\)\.insert\(/, 'vehicle capture must create a real reconstruction job');
assert.match(upload, /raw_r2_key: exterior\.r2_key/, 'worker input must reference the uploaded exterior clip');
assert.match(upload, /multi_clip_fusion: 'not_supported_by_current_worker'/, 'unimplemented multi-clip fusion must be disclosed in job metadata');
assert.match(upload, /not yet fused by the current worker/, 'UI must not claim all clips were fused');
assert.doesNotMatch(upload, /supabase\.storage\.from\('captures'\)/, 'must not silently fall back to an unconfigured legacy bucket');
assert.doesNotMatch(html.slice(html.lastIndexOf('// ── Boot')), /from\('splats'\)/, 'boot title lookup must use the deployed NIF schema');
console.log('Vehicle capture upload and queue contract passed.');
