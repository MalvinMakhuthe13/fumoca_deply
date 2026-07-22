import { supabase } from '../supabaseClient.js';
import { r2 } from '../r2Client.js';

export async function processUpload(file, userId, metadata = {}) {
  const safeName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
  const storagePath = `${userId}/${safeName}`;

  // ── Upload to R2 (was: supabase.storage.from('splats')) ──────────────────
  const { publicUrl: videoUrl, error: uploadError } = await r2
    .from('splat-videos')
    .upload(storagePath, file, { contentType: file.type || 'video/mp4' });

  if (uploadError) throw new Error(`R2 upload failed: ${uploadError.message}`);

  // ── DB insert — Supabase DB unchanged ────────────────────────────────────
  const { data: splatRow, error: splatError } = await supabase
    .from('splats')
    .insert({
      user_id: userId,
      title: metadata.title || file.name,
      description: metadata.description || null,
      category: metadata.category || null,
      video_url: videoUrl,
      video_filename: file.name,
      status: 'queued',
      visibility: 'public',
    })
    .select()
    .single();

  if (splatError) throw splatError;

  const { error: jobError } = await supabase
    .from('processing_jobs')
    .insert({
      splat_id: splatRow.id,
      user_id: userId,
      video_url: videoUrl,
      status: 'queued',
    });

  if (jobError) throw jobError;

  return { splat: splatRow, videoUrl };
}
