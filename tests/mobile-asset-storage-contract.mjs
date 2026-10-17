import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../cloudflare/workers/r2-storage.js', import.meta.url), 'utf8');
const mobile = await readFile(new URL('../js/modules/mobile-asset.js', import.meta.url), 'utf8');

assert.match(worker, /'nif-files': \[[^\]]*'text\/html'/,
  'NIF bucket must explicitly allow the generated widget MIME type');
assert.match(worker, /Content-Security-Policy[^\n]*sandbox allow-scripts allow-top-navigation-by-user-activation/,
  'HTML assets must be sandboxed and prevented from sharing the app origin');
assert.match(worker, /meta->>mobile_asset_r2_key\.eq\.\$\{encodedKey\}/,
  'R2 ownership and read lookups must find the registered mobile widget key');
assert.match(worker, /const isMobileAsset = bucketName === 'nif-files' && meta\.mobile_asset_r2_key === fileKey/,
  'read policy must associate the widget with its parent NIF');
assert.match(worker, /if \(isMobileAsset && row\.is_public === true\)/,
  'anonymous widget reads must require a published parent NIF');
assert.match(mobile, /\$\{ownerId\}\/mobile-assets\/\$\{splatRecord\.id\}\/widget_/,
  'widget writes must use the authenticated owner prefix');
assert.match(mobile, /mobile_asset_r2_key: fileKey/,
  'the widget object key must be persisted on the parent NIF for authorization');
assert.match(mobile, /select\('meta'\)\.eq\('id', splatRecord\.id\)\.eq\('user_id', ownerId\)\.single\(\)/,
  'mobile asset save must reload current parent metadata before merging, avoiding stale overwrites');
assert.match(mobile, /window\._fumocaCurrentRecord = \{ \.\.\.window\._fumocaCurrentRecord, meta: nextMeta \}/,
  'in-memory Studio metadata must stay in sync after mobile asset registration');
console.log('Mobile asset storage, sandbox and visibility contract passed.');
