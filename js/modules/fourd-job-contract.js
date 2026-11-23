/**
 * FUMOCA 4D capture job contract.
 * Converts the browser's motion analysis into the existing reconstruction_jobs schema.
 * No database or storage access lives here, so the contract can be tested without credentials.
 */
export function build4DCaptureJobs({ analysis, recordId = null, sourceKey, userId, sequenceId, vertical = 'generic', requestedIsolation = true }) {
  if (!analysis || !Array.isArray(analysis.jobs) || !analysis.jobs.length) {
    throw new TypeError('4D capture analysis contains no reconstruction jobs');
  }
  if (!sourceKey || typeof sourceKey !== 'string') throw new TypeError('A stored source video key is required');
  if (!userId || typeof userId !== 'string') throw new TypeError('An authenticated user is required');
  if (!sequenceId || typeof sequenceId !== 'string') throw new TypeError('A motion sequence id is required');

  return analysis.jobs.map((job, index) => {
    const frameTimes = [...new Set((job.frameTimes || [])
      .map(Number)
      .filter(Number.isFinite)
      .filter(time => time >= 0)
      .map(time => Math.round(time * 1000) / 1000))]
      .sort((a, b) => a - b);
    if (frameTimes.length < 3) {
      throw new RangeError(`Moment ${index + 1} has fewer than three usable frame timestamps`);
    }
    return {
      user_id: userId,
      status: 'queued',
      progress: 0,
      vertical: String(vertical || 'generic'),
      capture_mode: 'video',
      raw_r2_key: sourceKey,
      meta: {
        title: job.label || `Motion moment ${index + 1}`,
        source: 'fourd_capture',
        source_nif_id: recordId,
        motion_sequence_id: sequenceId,
        motion_state_index: index,
        motion_state_count: analysis.jobs.length,
        motion_state_label: job.label || `Moment ${index + 1}`,
        motion_state_time: Number.isFinite(job.momentTime) ? job.momentTime : frameTimes[0],
        motion_class: analysis.motionClass || job.motionClass || 'unknown',
        colmap_mode: job.colmapMode || 'sequential',
        subject_isolation_requested: Boolean(requestedIsolation),
        frame_times: frameTimes,
        source_capture: {
          type: 'video',
          r2_key: sourceKey,
          frame_selection: 'motion-analysis',
          frame_count: frameTimes.length
        }
      }
    };
  });
}

export function createMotionSequenceId(cryptoObject = globalThis.crypto) {
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `motion_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
