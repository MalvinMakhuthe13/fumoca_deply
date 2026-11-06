import assert from 'node:assert/strict';
import { savePosterSnapshot } from '../js/modules/poster-cloud-persistence.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=';
const gif = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
function fixture({ dbError = null, owner = 'user-1', uploadErrorAt = 0, cleanupError = null } = {}) {
  const uploads = [], removals = [], writes = [];
  const r2 = { from(bucket) {
    assert.equal(bucket, 'thumbnails');
    return {
      async upload(key, blob) {
        uploads.push({ key, type: blob.type, size: blob.size });
        if (uploadErrorAt && uploads.length === uploadErrorAt) throw new Error('simulated image upload failure');
        return { publicUrl: 'https://cdn.example.test/' + key, fileKey: key };
      },
      async remove(keys) { removals.push([...keys]); if (cleanupError) throw cleanupError; return { error: null }; },
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
    assets: { images: [{ id: 'logo', src: png, x: 0.82, y: 0.17, width: 0.31, rotation: 23, z: 7, visible: true, locked: false, sizeMode: 'fixed', fixedWidthPx: 310 }] },
    subjects: [
      { id: 'subject_main', label: 'Main product', source: { type: 'current' }, x: 0.41, y: 0.62, scale: 1.35, rotation: 18, visible: true, locked: false, z: 2 },
      { id: 'subject_side', label: 'Side product', source: { type: 'nif', assetId: 'nif-side-22' }, x: 0.78, y: 0.48, scale: 0.72, rotation: -31, visible: false, locked: true, z: 5 },
    ],
    title: { visible: true, text: 'MADE TO MOVE', align: 'right', fontSize: 64, color: '#ffffff' },
  }}};
  return { r2Client: r2, supabase, record, snapshot, uploads, removals, writes };
}

{
  const f = fixture();
  const result = await savePosterSnapshot({ ...f, createSnapshot: () => structuredClone(f.snapshot) });
  assert.equal(f.uploads.length, 2, 'background and supporting image should both upload');
  assert.equal(f.uploads[0].type, 'image/png');
  assert.equal(f.writes.length, 1, 'one metadata commit should occur');
  assert.equal(f.writes[0].column, 'id');
  assert.equal(f.writes[0].id, 'nif-1');
  assert.equal(result.metadata.retained, 'yes');
  assert.equal(result.metadata.legacy, 'kept');
  assert.match(result.savedData.poster.composition.background.value, /^https:\/\/cdn\.example\.test\//);
  assert.match(result.savedData.poster.composition.assets.images[0].src, /^https:\/\/cdn\.example\.test\//);
  assert.ok(result.savedData.poster.composition.assets.images[0].r2Key);
  assert.deepEqual(result.savedData.poster.composition.subjects, f.snapshot.poster.composition.subjects, 'all splat source IDs, transforms, visibility, lock state and layer order must survive cloud snapshotting');
  assert.deepEqual(result.savedData.poster.composition.assets.images[0], {
    id: 'logo', src: result.savedData.poster.composition.assets.images[0].src,
    x: 0.82, y: 0.17, width: 0.31, rotation: 23, z: 7, visible: true, locked: false,
    sizeMode: 'fixed', fixedWidthPx: 310, r2Key: result.savedData.poster.composition.assets.images[0].r2Key,
    bucket: 'thumbnails',
  }, 'supporting image transforms and responsive sizing must survive image upload');
  assert.deepEqual(result.savedData.poster.composition.title, f.snapshot.poster.composition.title, 'poster typography settings must survive persistence');
  assert.deepEqual(f.writes[0].value.meta.present.poster.composition.subjects, f.snapshot.poster.composition.subjects, 'the complete subject stack must be committed to nif_files.meta.present');
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


{
  const f = fixture();
  const snapshot = structuredClone(f.snapshot);
  snapshot.poster.composition.background.value = gif;
  const result = await savePosterSnapshot({ ...f, createSnapshot: () => snapshot });
  assert.equal(f.uploads[0].type, 'image/gif', 'GIF backgrounds supported by the composer must persist as GIF');
  assert.match(result.savedData.poster.composition.background.value, /^https:\/\/cdn\.example\.test\//);
}

{
  const f = fixture({ uploadErrorAt: 2, cleanupError: new Error('simulated R2 cleanup failure') });
  await assert.rejects(
    () => savePosterSnapshot({ ...f, createSnapshot: () => structuredClone(f.snapshot) }),
    /simulated image upload failure/,
    'a rollback failure must not hide the original upload failure',
  );
  assert.equal(f.uploads.length, 2);
  assert.equal(f.removals.length, 1, 'partial successful uploads should still trigger cleanup');
}

console.log('Poster cloud persistence integration contract passed with mocked Supabase and R2.');
