import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const toggle = await readFile(new URL('../js/modules/nif-part-toggle.js', import.meta.url), 'utf8');
const hotspot = await readFile(new URL('../js/modules/hotspot-pro.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');

assert.match(toggle, /\$\{ownerId\}\/open-variants\/\$\{recordId\}_/,
  'open-state variants must be stored under the authenticated owner prefix');
assert.match(toggle, /open_variant_r2_keys: \[\.\.\.new Set\(\[\.\.\.keys, fileKey\]\)\]/,
  'every baked variant must be registered against its parent NIF');
assert.match(toggle, /export async function discardPartToggleVariant/,
  'unaccepted previews must have an explicit cleanup path');
assert.match(hotspot, /discardPartToggleVariant\(fileKey, currentRecord\.id, currentRecord\.user_id\)/,
  'cancelling preview must unregister and delete the generated variant');
assert.match(hotspot, /recordId: currentRecord\.id, ownerId: currentRecord\.user_id/,
  'the authoring flow must pass parent identity into variant creation');
assert.equal(worker.split('meta->open_variant_r2_keys.cs.{${encodedKey}}').length - 1, 2,
  'R2 read and delete authorization must query the parent record association');
assert.match(worker, /meta\.open_variant_r2_keys\.includes\(fileKey\)/,
  'R2 read policy must verify the exact registered variant key');
console.log('Open-state variant ownership, visibility and cleanup contract passed.');
