import { supabase } from '../supabaseClient.js';
import r2 from '../r2Client.js';

/**
 * Queue a video capture using the deployed NIF schema.
 * Source media is stored in nif-videos; reconstruction_jobs is the queue of
 * record. The resulting nif_files row is created by the reconstruction worker
 * only after a valid output artifact exists.
 */
export async function processUpload(file, userId, metadata = {}) {
  if (!file || typeof file.name !== 'string' || !file.size) {
    throw new Error('Choose a non-empty video file before uploading.');
  }
  if (!userId) throw new Error('Sign in before uploading a capture.');

  const safeName = file.name
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(-160) || 'capture.mp4';
  const storagePath = `${userId}/captures/${Date.now()}_${safeName}`;
  const { publicUrl: videoUrl, fileKey, error: uploadError } = await r2
    .from('nif-videos')
    .upload(storagePath, file, { contentType: file.type || 'video/mp4' });

  if (uploadError) throw new Error(`R2 upload failed: ${uploadError.message}`);
  if (!fileKey) throw new Error('R2 upload returned no storage key.');

  const jobPayload = {
    user_id: userId,
    status: 'queued',
    progress: 0,
    vertical: metadata.vertical || metadata.category || 'generic',
    capture_mode: metadata.capture_mode || 'video',
    raw_r2_key: fileKey,
    file_size: file.size,
    meta: {
      title: metadata.title || file.name,
      description: metadata.description || null,
      original_filename: file.name,
      content_type: file.type || 'video/mp4',
      source: 'browser-upload',
    },
  };

  const { data: job, error: jobError } = await supabase
    .from('reconstruction_jobs')
    .insert(jobPayload)
    .select()
    .single();

  if (jobError || !job) {
    try {
      const { error: cleanupError } = await r2.from('nif-videos').remove([fileKey]);
      if (cleanupError) console.warn('[FUMOCA upload] orphan source cleanup failed', cleanupError);
    } catch (cleanupError) {
      console.warn('[FUMOCA upload] orphan source cleanup failed', cleanupError);
    }
    throw jobError || new Error('Could not create a reconstruction job.');
  }

  return { job, jobId: job.id, videoUrl, fileKey };
}
