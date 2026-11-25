import assert from 'node:assert/strict';
import { patchNifMeta } from '../js/modules/meta-patch.js';

// Fake Supabase table with one row; another "tab" writes between page load and save.
const db = { id: 'n1', user_id: 'u1', meta: { present: { rig: { a: 1 } }, variants: [] } };
const sb = {
  from() {
    const filters = {}; let op = 'select', patch = null;
    const api = {
      select() { op = 'select'; return api; },
      update(p) { op = 'update'; patch = p; return api; },
      eq(k, v) { filters[k] = v; return api; },
      async maybeSingle() { return { data: Object.entries(filters).every(([k, v]) => db[k] === v) ? { meta: structuredClone(db.meta) } : null, error: null }; },
      then(res) { if (op === 'update' && Object.entries(filters).every(([k, v]) => db[k] === v)) db.meta = patch.meta; res({ error: null }); },
    };
    return api;
  },
};
const staleCopy = structuredClone(db.meta);            // what the viewer read at page load
db.meta.present.living = { enabled: true };             // Studio saved a living photo meanwhile
await patchNifMeta(sb, 'n1', (latest) => { latest.variants = [{ name: 'v1' }]; return latest; });
assert.deepEqual(db.meta.present.living, { enabled: true }, 'concurrent change kept');
assert.deepEqual(db.meta.variants, [{ name: 'v1' }], 'our change applied');
assert.ok(!('living' in staleCopy.present));
await assert.rejects(() => patchNifMeta(sb, 'n1', m => m, { userId: 'someone-else' }), /not be found/);
console.log('meta-patch: all tests passed');
