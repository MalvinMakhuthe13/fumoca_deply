import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const specs = [
  { path: '../js/modules/asset-parts.js', name: 'scene part swaps', owner: /\.eq\('id', _record\.id\)\.eq\('user_id', userId\)\.single\(\)/ },
  { path: '../js/modules/4d-engine.js', name: '4D metadata', owner: /\.eq\('id', S\.record\.id\)\.eq\('user_id', ownerId\)\.single\(\)/ },
  { path: '../js/modules/visual-fx.js', name: 'visual presets', owner: /\.eq\('id', rec\.id\)\.eq\('user_id', rec\.user_id\)\.single\(\)/ },
  { path: '../js/modules/motion-tracking.js', name: 'motion tracking', owner: /\.eq\('id', record\.id\)\.eq\('user_id', record\.user_id\)\.single\(\)/ },
];
for (const spec of specs) {
  const source = await readFile(new URL(spec.path, import.meta.url), 'utf8');
  assert.match(source, /select\('id,user_id,meta'\)/, `${spec.name} must read current META before writing`);
  assert.match(source, spec.owner, `${spec.name} must scope the read to the record owner`);
  assert.match(source, /update\(\{ meta: (?:nextMeta|metadata) \}\)/, `${spec.name} must write only the merged META column`);
  assert.match(source, /\.eq\('user_id', (?:userId|ownerId|rec\.user_id|record\.user_id)\)/,
    `${spec.name} write must be owner-scoped`);
}

const viewer = await readFile(new URL('../js/modules/viewer.js', import.meta.url), 'utf8');
const viewerFunctions = [
  { name: '_fumocaFlushPipelineQueue', next: 'async function _fumocaSaveVariant' },
  { name: '_fumocaSaveVariant', next: 'async function _fumocaQueuePipeline' },
  { name: '_fumocaQueuePipeline', next: 'function _fumocaApplyAutoCleanPreset' },
];
for (const spec of viewerFunctions) {
  const start = viewer.indexOf(`async function ${spec.name}`);
  assert.ok(start >= 0, `viewer function ${spec.name} must exist`);
  const next = viewer.indexOf(spec.next, start + 10);
  assert.ok(next > start, `viewer function ${spec.name} must have a clear end boundary`);
  const block = viewer.slice(start, next);
  assert.match(block, /select\('id,user_id,title,description,r2_key,is_public,meta'\)/,
    `${spec.name} must reload the current NIF row`);
  assert.match(block, /\.eq\('id', rec\.id\)\.eq\('user_id', rec\.user_id\)/,
    `${spec.name} must scope database writes to the owner`);
  assert.doesNotMatch(block, /\.update\(\{ meta: metadata \}\)\.eq\('id', rec\.id\);/,
    `${spec.name} must not use the old unscoped stale-META write`);
}
console.log('NIF metadata merge contract passed for scene parts, 4D, visual FX, motion tracking and viewer queues.');
