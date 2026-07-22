/**
 * Print export — "export my current selection as a printable figurine"
 * ════════════════════════════════════════════════════════════════════════════
 * Bridges the studio's existing lasso/erase edit state (window.S) to the
 * server-side mesh_only reconstruction path (pipeline.py's run_mesh_only()).
 * Real triangulation + STL export happens server-side — this module only
 * packages whatever the user currently has "alive" after their edits and
 * queues the job.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { encodeGeometryOnly } from './nif-format.js';
import r2 from '../r2Client.js';

/**
 * @param {object} opts
 *   title    string   optional label for the print job
 *   onStatus function  optional (message: string) => void, for UI feedback
 * @returns {Promise<string>} the reconstruction_jobs id — poll it for status
 */
export async function exportSelectionAsFigurine({ title, onStatus } = {}) {
  const sb = window._fumocaSupabase;
  if (!sb) throw new Error('Supabase client not available');

  const S = window.S;
  if (!S?.alive) throw new Error('Nothing loaded in the studio to export');

  onStatus?.('Packing your current selection…');

  const aliveIndices = [];
  for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) aliveIndices.push(i);
  if (aliveIndices.length < 200) {
    throw new Error(
      `Only ${aliveIndices.length} points survived your edits — that's too ` +
      `few for a solid print. Keep a bit more of the subject before exporting.`
    );
  }

  let geoBlob;
  if (S.fileType === 'ply') {
    // PLY case has no per-point scale/rotation — encodeGeometryOnly's
    // isotropic-point path handles this, same as the rest of the app.
    const positions   = new Float32Array(aliveIndices.length * 3);
    const colors01     = new Float32Array(aliveIndices.length * 3);
    const opacities01  = new Float32Array(aliveIndices.length);
    aliveIndices.forEach((i, row) => {
      const pc = S.paintColors;
      const r = pc && pc[i*3]   >= 0 ? pc[i*3]   : S.colors[i*3];
      const g = pc && pc[i*3+1] >= 0 ? pc[i*3+1] : S.colors[i*3+1];
      const b = pc && pc[i*3+2] >= 0 ? pc[i*3+2] : S.colors[i*3+2];
      positions[row*3]=S.positions[i*3]; positions[row*3+1]=S.positions[i*3+1]; positions[row*3+2]=S.positions[i*3+2];
      colors01[row*3]=r; colors01[row*3+1]=g; colors01[row*3+2]=b;
      opacities01[row]=S.opacity[i];
    });
    geoBlob = encodeGeometryOnly({ positions, colors01, opacities01 });
  } else {
    if (!S.sourceBuffer) throw new Error('No source geometry buffer available for this splat');
    geoBlob = encodeGeometryOnly({
      sourceBuffer: new Uint8Array(S.sourceBuffer),
      aliveIndices,
      rowSize: S.splatRowSize ?? 32,
    });
  }

  onStatus?.(`Uploading (${(geoBlob.byteLength / 1024).toFixed(0)} KB)…`);
  const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: {} }));
  const path = `print-source/${user?.id || 'anon'}/${Date.now()}_selection.bin`;
  const { fileKey, error: upErr } = await r2
    .from('splat-files')
    .upload(path, new Blob([geoBlob], { type: 'application/octet-stream' }), {
      contentType: 'application/octet-stream',
    });
  if (upErr) throw new Error('Upload failed: ' + upErr.message);

  onStatus?.('Queuing mesh + STL generation…');
  const { data: job, error: jobErr } = await sb.from('reconstruction_jobs').insert({
    user_id: user?.id || null,
    status: 'queued',
    progress: 0,
    vertical: 'figurine',
    capture_mode: 'mesh_only',
    raw_r2_key: fileKey,
    meta: { title: title || 'Figurine export', point_count: aliveIndices.length },
  }).select().single();
  if (jobErr) throw jobErr;

  onStatus?.('Queued. This runs server-side — check back in a few minutes.');
  return job.id;
}

/**
 * Poll a mesh_only job until it completes or fails.
 * @param {string} jobId
 * @param {(job: object) => void} onUpdate  called on every poll with the raw row
 * @param {number} intervalMs
 * @returns {() => void} call to stop polling
 */
export function pollPrintJob(jobId, onUpdate, intervalMs = 4000) {
  const sb = window._fumocaSupabase;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const { data: job, error } = await sb.from('reconstruction_jobs').select('*').eq('id', jobId).single();
    if (!error && job) {
      onUpdate(job);
      if (job.status === 'complete' || job.status === 'failed') return; // stop polling
    }
    if (!stopped) setTimeout(tick, intervalMs);
  }
  tick();

  return () => { stopped = true; };
}
