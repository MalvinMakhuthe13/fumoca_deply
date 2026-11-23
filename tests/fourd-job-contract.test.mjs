import assert from 'node:assert/strict';
import { build4DCaptureJobs, createMotionSequenceId } from '../js/modules/fourd-job-contract.js';

const analysis = {
  motionClass: 'moderate',
  jobs: [
    { label: 'Moment 1', momentTime: 1.25, frameTimes: [1.2, 0.4, 1.2, -1, 'bad', 0.8], colmapMode: 'sequential' },
    { label: 'Moment 2', momentTime: 3.5, frameTimes: [3, 3.5, 4] },
  ],
};
const jobs = build4DCaptureJobs({
  analysis, recordId: 'source-record', sourceKey: 'raw/user/4d/source.mp4',
  userId: 'user-1', sequenceId: 'sequence-1', vertical: 'person', requestedIsolation: true,
});
assert.equal(jobs.length, 2);
assert.equal(jobs[0].capture_mode, 'video');
assert.equal(jobs[0].vertical, 'person');
assert.equal(jobs[0].raw_r2_key, 'raw/user/4d/source.mp4');
assert.deepEqual(jobs[0].meta.frame_times, [0.4, 0.8, 1.2]);
assert.equal(jobs[0].meta.motion_sequence_id, 'sequence-1');
assert.equal(jobs[1].meta.motion_state_index, 1);
assert.equal(jobs[1].meta.motion_state_count, 2);
assert.equal(jobs[0].meta.subject_isolation_requested, true);
assert.throws(() => build4DCaptureJobs({ analysis: { jobs: [] }, sourceKey: 'x', userId: 'u', sequenceId: 's' }), /no reconstruction jobs/);
assert.throws(() => build4DCaptureJobs({ analysis, sourceKey: '', userId: 'u', sequenceId: 's' }), /source video key/);
assert.throws(() => build4DCaptureJobs({ analysis: { jobs: [{ frameTimes: [1, 1] }] }, sourceKey: 'x', userId: 'u', sequenceId: 's' }), /fewer than three/);
assert.ok(createMotionSequenceId({ randomUUID: () => 'uuid-test' }) === 'uuid-test');
console.log('4D capture job contract: 10 assertions passed');
