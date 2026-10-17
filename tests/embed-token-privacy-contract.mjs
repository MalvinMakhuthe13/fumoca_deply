import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase_migration_embeds.sql', import.meta.url), 'utf8');
const player = await readFile(new URL('../embed/player.html', import.meta.url), 'utf8');
const manager = await readFile(new URL('../js/modules/embed-manager.js', import.meta.url), 'utf8');

assert.match(migration, /create policy "NIF owners can read their embeds"[\s\S]*?auth\.uid\(\)/, 'direct embed SELECT should be owner-only');
assert.doesNotMatch(migration, /create policy "Anyone can read an embed by token"[\s\S]*?using\s*\(true\)/, 'anonymous SELECT must not expose all embed rows');
assert.match(migration, /create or replace function public\.resolve_embed_token\(p_token uuid\)/, 'public token resolution must use the exact-token RPC');
assert.match(migration, /grant execute on function public\.resolve_embed_token\(uuid\) to anon, authenticated/, 'anonymous visitors must be able to resolve their one token');
assert.match(player, /rpc\/resolve_embed_token/);
assert.match(player, /JSON\.stringify\(\{ p_token: token \}\)/, 'token RPC argument must match SQL function name');
assert.match(player, /nif_files\?id=eq\.[\s\S]*?is_public=eq\.true/, 'embed player must load only published NIFs');
assert.doesNotMatch(player, /splats\?id=eq\./, 'embed player must not query the retired splats table');
assert.match(manager, /splatRecord\.is_public !== true/, 'private NIFs must not receive public embed tokens');
assert.match(manager, /Public embed unavailable/, 'private embed UI must explain why publishing is required');
console.log('Embed token privacy and deployed NIF schema contract passed.');
