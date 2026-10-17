import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guide = await readFile(new URL('../cloudflare/DEPLOY.md', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const config = await readFile(new URL('../config.js', import.meta.url), 'utf8');

assert.match(guide, /do not deploy this QA branch to production yet/i);
assert.match(guide, /root `wrangler\.jsonc`/);
assert.match(guide, /separate staging Worker and staging R2 buckets/i);
assert.match(guide, /direct R2 endpoints\/custom domains separately/i);
assert.match(guide, /do not deploy using `cd cloudflare && wrangler deploy`/);
assert.match(wrangler, /"PUBLIC_BASE_URL": "https:\/\/fumoca-r2\.ntuthukochildofkrist\.workers\.dev"/);
assert.match(config, /r2WorkerUrl: 'https:\/\/fumoca-r2\.ntuthukochildofkrist\.workers\.dev'/);
console.log('Deployment guide and environment URL contract passed.');
