import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/object-extract.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function saveExtractedAsNewSplat(');
const end = source.indexOf('\n// Default export', start);
assert.ok(start >= 0 && end > start, 'object extraction save function must exist');
const fn = source.slice(start, end);
assert.match(fn, /supabase\.auth\.getUser\(\)/, 'extraction requires an authenticated owner');
assert.match(fn, /\$\{userId\}\/extracted_\$\{timestamp\}\.ply/, 'storage key must use authenticated user prefix');
assert.match(fn, /\.from\('nif-files'\)\s*\.upload\(/, 'extracted PLY must upload through the R2 client');
assert.match(fn, /\.from\('nif_files'\)\s*\.insert\(insertPayload\)/, 'extracted object must register in deployed nif_files');
assert.match(fn, /is_public: false/, 'new extracted objects should default private');
assert.match(fn, /meta:\s*\{[\s\S]*source_type: 'object_extract'/, 'extraction provenance must be recorded in meta');
assert.match(fn, /viewer\.html\?nifId=/, 'viewer link must use nifId');
assert.doesNotMatch(fn, /from\('splats'\)/, 'must not use the absent legacy splats table');
console.log('Object extraction NIF persistence contract passed.');
