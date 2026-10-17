import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase_migration_mobile_assets.sql', import.meta.url), 'utf8');
const moduleSource = await readFile(new URL('../js/modules/mobile-asset.js', import.meta.url), 'utf8');
assert.match(sql, /create table if not exists public\.mobile_assets/i);
assert.match(sql, /references public\.nif_files\(id\) on delete cascade/i);
assert.match(sql, /alter table public\.mobile_assets enable row level security/i);
assert.match(sql, /mobile_assets_select_visible_parent[\s\S]*n\.is_public = true/i);
assert.match(sql, /mobile_assets_insert_owner[\s\S]*n\.user_id = auth\.uid\(\)/i);
assert.match(sql, /mobile_assets_update_owner[\s\S]*with check[\s\S]*n\.user_id = auth\.uid\(\)/i);
assert.match(sql, /mobile_assets_delete_owner[\s\S]*n\.user_id = auth\.uid\(\)/i);
assert.match(moduleSource, /from\('mobile_assets'\)\.upsert\(/);
assert.match(moduleSource, /mobile_asset_r2_key: fileKey/);
console.log('Mobile assets schema and owner/public RLS contract passed.');
