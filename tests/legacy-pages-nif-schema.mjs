import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adStudio = await readFile(new URL('../ad-studio.html', import.meta.url), 'utf8');
const adLoadStart = adStudio.indexOf("document.getElementById('loadSplatBtn').addEventListener");
const adLoadEnd = adStudio.indexOf('// ── 4D setup', adLoadStart);
assert.ok(adLoadStart >= 0 && adLoadEnd > adLoadStart, 'Ad Studio load handler must exist');
const adLoad = adStudio.slice(adLoadStart, adLoadEnd);
assert.ok(adLoad.includes("from('nif_files')"), 'Ad Studio must list deployed NIF records');
assert.ok(adLoad.includes('is_public.eq.true,user_id.eq.${user.id}'), 'picker must show public NIFs and the signed-in user private NIFs');
assert.ok(!adLoad.includes("from('splats')"), 'Ad Studio must not query retired splats table');

const preview = await readFile(new URL('../public-preview.html', import.meta.url), 'utf8');
assert.ok(preview.includes("from('nif_files')"), 'public preview must resolve NIF records from nif_files');
assert.ok(preview.includes(".eq('is_public', true)"), 'public preview must not expose private NIF records');
assert.ok(preview.includes('/viewer.html?nifId='), 'NIF records must open in the NIF viewer, not the .fumoc player');
assert.ok(!preview.includes("from('splats')"), 'public preview must not query retired splats table');

const feed = await readFile(new URL('../feed.html', import.meta.url), 'utf8');
assert.ok(feed.includes("from('nif_files')"), 'feed stories and tags must use nif_files');
assert.ok(feed.includes(".eq('is_public',true)"), 'stories and trending tags must filter to public NIFs');
assert.ok(feed.includes("from('reconstruction_jobs')"), 'action-needed notification count must use reconstruction jobs');
assert.ok(!feed.includes("from('splats')"), 'feed must not query the retired splats table');
assert.ok(!feed.includes("from('processing_jobs')"), 'feed must not query the retired processing_jobs table');
console.log('Ad Studio, public preview and feed NIF schema contracts passed.');
