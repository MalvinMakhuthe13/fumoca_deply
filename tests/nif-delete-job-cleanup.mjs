import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const path of ['js/modules/feed.js', 'js/modules/viewer.js', 'js/modules/profile.js']) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(source, /if \((?:post|currentRecord|item)\.job_id\)/, `${path} must guard optional job cleanup`);
  assert.match(source, /from\('reconstruction_jobs'\)[\s\S]{0,180}\.delete\(\)\.eq\('id', (?:post|currentRecord|item)\.job_id\)/,
    `${path} must delete only the explicitly linked reconstruction job`);
  assert.match(source, /eq\('user_id', (?:post|currentRecord|item)\.user_id\)/,
    `${path} must scope cleanup to the owning user`);
}
console.log('NIF-linked reconstruction job cleanup contracts passed.');
