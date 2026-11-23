/**
 * Assemble completed independent NIF motion moments into the v1 sequence manifest.
 * This intentionally uses hold playback: independently trained reconstructions
 * do not share proven Gaussian identity or ordering.
 */
import r2 from '../r2Client.js';

export function buildMotionSequenceManifest(records, sequenceId, publicUrl = (key) => key) {
  if (!Array.isArray(records)) throw new TypeError('NIF records must be an array');
  if (!sequenceId || typeof sequenceId !== 'string') throw new TypeError('motion sequence id is required');
  const eligible = records.filter(row =>
    row?.r2_key &&
    Number.isInteger(Number(row.gaussian_count)) && Number(row.gaussian_count) > 0 &&
    row.meta?.motion_sequence_id === sequenceId
  );
  const ordered = eligible.map(row => ({
    row,
    index: Number(row.meta.motion_state_index),
    time: Number(row.meta.motion_state_time)
  })).sort((a, b) => a.index - b.index);

  if (ordered.length < 2) throw new Error('A motion sequence needs at least two completed NIF moments');
  const seenIndices = new Set();
  const frames = ordered.map(({ row, index, time }) => {
    if (!Number.isInteger(index) || index < 0 || seenIndices.has(index)) {
      throw new Error('Motion sequence contains a missing or duplicate state index');
    }
    seenIndices.add(index);
    if (!Number.isFinite(time) || time < 0) throw new Error(`Motion state ${index} has no valid timestamp`);
    const url = publicUrl(row.r2_key);
    if (typeof url !== 'string' || !url.trim()) throw new Error(`NIF ${row.id} has no resolvable asset URL`);
    return {
      time,
      url,
      format: 'nif',
      gaussianCount: Number(row.gaussian_count),
      // Independent jobs have independent Gaussian identities. Unique IDs
      // force hold playback and prevent unsafe interpolation.
      topologyId: `independent-nif:${row.id}`,
      stateId: row.id,
      label: row.meta.motion_state_label || row.title || `Moment ${index + 1}`
    };
  });
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].time <= frames[i - 1].time) {
      throw new Error('Motion moment timestamps must be strictly increasing');
    }
  }
  const frameRate = 30;
  const duration = Math.max(frames[frames.length - 1].time + 1 / frameRate, 1 / frameRate);
  return {
    schema: 'fumoca.4d.sequence',
    version: 1,
    id: sequenceId,
    duration,
    frameRate,
    interpolation: 'hold',
    frames
  };
}

export async function loadMotionSequence(supabase, sequenceId) {
  if (!supabase) throw new TypeError('Supabase client is required');
  const { data, error } = await supabase
    .from('nif_files')
    .select('id,title,r2_key,gaussian_count,meta,created_at')
    .contains('meta', { motion_sequence_id: sequenceId });
  if (error) throw error;
  return buildMotionSequenceManifest(data || [], sequenceId, key => r2.publicUrl('nif-files', key));
}

let _loadGeneration = 0;
async function _onRecordLoaded(event) {
  const record = event?.detail?.record || window._fumocaCurrentRecord || null;
  const sequenceId = record?.meta?.motion_sequence_id;
  if (!sequenceId || !window._fumocaSupabase) return;
  const generation = ++_loadGeneration;
  try {
    const manifest = await loadMotionSequence(window._fumocaSupabase, sequenceId);
    if (generation !== _loadGeneration) return;
    window._fumocaMotionSequenceManifest = manifest;
    window.dispatchEvent(new CustomEvent('fumoca:motionSequenceReady', {
      detail: { sequenceId, manifest, frameCount: manifest.frames.length }
    }));
  } catch (error) {
    if (generation !== _loadGeneration) return;
    console.warn('[FUMOCA 4D] Motion sequence is not ready yet:', error);
    window.dispatchEvent(new CustomEvent('fumoca:motionSequenceUnavailable', {
      detail: { sequenceId, message: error?.message || String(error) }
    }));
  }
}

const Fumoca4DSequenceLibrary = {
  buildMotionSequenceManifest,
  loadMotionSequence,
  refresh: _onRecordLoaded
};
if (typeof window !== 'undefined') {
  window.Fumoca4DSequenceLibrary = Fumoca4DSequenceLibrary;
  window.addEventListener('fumoca:recordLoaded', _onRecordLoaded);
  if (window._fumocaCurrentRecord) _onRecordLoaded({ detail: { record: window._fumocaCurrentRecord } });
}
export default Fumoca4DSequenceLibrary;
