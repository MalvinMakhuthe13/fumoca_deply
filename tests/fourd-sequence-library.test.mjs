import assert from 'node:assert/strict';
import { buildMotionSequenceManifest } from '../js/modules/fourd-sequence-library.js';

const rows = [
  { id: 'nif-b', title: 'Exit', r2_key: 'u/b.nif', gaussian_count: 900, meta: { motion_sequence_id: 'seq', motion_state_index: 1, motion_state_time: 2.5, motion_state_label: 'Exit' } },
  { id: 'nif-a', title: 'Arrival', r2_key: 'u/a.nif', gaussian_count: 1000, meta: { motion_sequence_id: 'seq', motion_state_index: 0, motion_state_time: 0.5, motion_state_label: 'Arrival' } },
  { id: 'other', title: 'Other', r2_key: 'u/c.nif', gaussian_count: 1000, meta: { motion_sequence_id: 'different', motion_state_index: 2, motion_state_time: 4 } },
];
const manifest = buildMotionSequenceManifest(rows, 'seq', key => `https://cdn.example/${key}`);
assert.equal(manifest.schema, 'fumoca.4d.sequence');
assert.equal(manifest.interpolation, 'hold');
assert.equal(manifest.frames.length, 2);
assert.equal(manifest.frames[0].stateId, 'nif-a');
assert.equal(manifest.frames[1].time, 2.5);
assert.equal(manifest.frames[0].url, 'https://cdn.example/u/a.nif');
assert.notEqual(manifest.frames[0].topologyId, manifest.frames[1].topologyId);
assert.ok(manifest.duration > 2.5);
assert.throws(() => buildMotionSequenceManifest(rows.slice(0, 1), 'seq'), /at least two/);
assert.throws(() => buildMotionSequenceManifest([
  rows[1], { ...rows[0], meta: { ...rows[0].meta, motion_state_time: 0.5 } }
], 'seq'), /strictly increasing/);
assert.throws(() => buildMotionSequenceManifest([
  rows[1], { ...rows[0], meta: { ...rows[0].meta, motion_state_index: 0 } }
], 'seq'), /duplicate state index/);
console.log('4D sequence manifest: 10 assertions passed');
