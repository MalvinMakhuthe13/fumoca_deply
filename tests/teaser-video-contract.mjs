import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const teaser = await readFile(new URL('../js/modules/teaser-video.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../js/modules/feed.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');
const profile = await readFile(new URL('../js/modules/profile.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');

assert.match(teaser, /\$\{ownerId\}\/teasers\/\$\{splatId\}/, 'teaser objects must be written under the authenticated owner's prefix');
assert.match(teaser, /teaser_video_r2_key: fileKey/, 'the object key must be persisted with the NIF metadata');
assert.match(teaser, /\.eq\('id', splatId\)\s*\.eq\('user_id', ownerId\)/, 'metadata writes must be owner-scoped');
assert.match(teaser, /from\('preview-videos'\)\.remove\(\[fileKey\]\)/, 'failed metadata writes must clean up the uploaded object');
assert.match(feed, /row\.meta\?\.teaser_video_url/, 'feed must resolve teaser URLs from NIF metadata');
assert.match(feed, /post\.meta\?\.teaser_video_r2_key/, 'feed deletion must clean up teaser objects');
assert.match(profile, /item\.meta\?\.teaser_video_r2_key/, 'profile deletion must clean up teaser objects');
assert.match(viewer, /currentRecord\.meta\?\.teaser_video_r2_key/, 'viewer deletion must clean up teaser objects');
assert.match(worker, /meta\.teaser_video_r2_key === fileKey/, 'Worker must associate a preview key with its NIF row');
assert.match(worker, /published-nif-preview-video/, 'public teaser reads require a published NIF');
console.log('Teaser upload, read visibility and cleanup contract passed.');
