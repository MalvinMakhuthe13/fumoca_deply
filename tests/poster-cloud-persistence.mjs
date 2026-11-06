import assert from 'node:assert/strict';
import { savePosterSnapshot } from '../js/modules/poster-cloud-persistence.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=';
function fixture({ dbError = null, owner = 'user-1' } = {}) {
  const uploads = [], removals = [], writes = [];
  const r2 = { from(bucket) {
    assert.equal(bucket, 'thumbnails');
    return {
      async upload(key, blob) {
        uploads.push({ key, type: blob.type, size: blob.size });
        return { publicUrl: 'https://cdn.example.test/' + key, fileKey: key };
      },
      async remove(keys) { removals.push([...keys]); return { error: null }; },
    };
  }};
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: 'user-1' } }, error: null }; } },
    from(table) {
      assert.equal(table, 'nif_files');
      return { update(value) { return { async eq(column, id) {
        writes.push({ value, column, id });
        return { error: dbError };
      }}; }};
    },
  };
  const record = { id: 'nif-1', user_id: owner, meta: { retained: 'yes' }, metadata: { legacy: 'kept' } };
  const snapshot = { poster: { composition: {
    background: { type: 'image', value: png },
    assets: { images: [{ id: 'logo', src: png }] },
  }}};
  return { r2, supabase, record, snapshot, uploads, removals, writes };
}

{
  const f = fixture();
  const result = await savePosterSnapshot({ ...f, createSnapshot: () => structuredClone(f.snapshot) });
  assert.equal(f.uploads.length, 2, 'background and supporting image should both upload');
  assert.equal(f.writes.length, 1, 'one metadata commit should occur');
  assert.equal(f.writes[0].column, 'id');
  assert.equal(f.writes[0].id, 'nif-1');
  assert.equal(result.metadata.retained, 'yes');
  assert.equal(result.metadata.legacy, 'kept');
  assert.match(result.savedData.poster.composition.background.value, /^https:\/\/cdn\.example\.test\//);
  assert.match(result.savedData.poster.composition.assets.images[0].src, /^https:\/\/cdn\.example\.test\//);
  assert.ok(result.savedData.poster.composition.assets.images[0].r2Key);
  assert.equal(f.removals.length, 0);
}

{
  const f = fixture({ owner: 'someone-else' });
  await assert.rejects(() => savePosterSnapshot({ ...f, createSnapshot: () => structuredClone(f.snapshot) }), /only save poster media/);
  assert.equal(f.uploads.length, 0, 'ownership failure must happen before any upload');
  assert.equal(f.writes.length, 0, 'ownership failure must happen before database write');
}

{
  const f = fixture({ dbError: new Error('simulated metadata failure') });
  await assert.rejects(() => savePosterSnapshot({ ...f, createSnapshot: () => structuredClone(f.snapshot) }), /simulated metadata failure/);
  assert.equal(f.uploads.length, 2);
  assert.equal(f.removals.length, 1, 'failed metadata commit must clean up uploaded R2 objects');
  assert.equal(f.removals[0].length, 2);
  assert.equal(f.snapshot.poster.composition.background.value, png, 'editor source snapshot remains retryable');
  assert.equal(f.snapshot.poster.composition.assets.images[0].src, png, 'editor image source remains retryable');
}

console.log('Poster cloud persistence integration contract passed with mocked Supabase and R2.');
