/**
 * Authenticated persistence for poster media attached to a saved NIF asset.
 * Dependencies are injected so upload/commit/rollback can be tested without
 * production Supabase or Cloudflare credentials.
 */
function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Poster image data is invalid. Please upload the image again.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1].toLowerCase() });
}
export async function persistPosterImagesToR2(poster, userId, recordId, r2Client) {
  const uploadedKeys = [];
  const bucket = r2Client.from('thumbnails');
  const uploadDataUrl = async (dataUrl, fileKey) => {
    const blob = dataUrlToBlob(dataUrl);
    const result = await bucket.upload(fileKey, blob, { contentType: blob.type });
    if (result.error || !result.publicUrl || !result.fileKey) throw result.error || new Error('Image upload did not return a public asset URL.');
    uploadedKeys.push(result.fileKey);
    return { src: result.publicUrl, r2Key: result.fileKey, bucket: 'thumbnails' };
  };
  const composition = poster?.composition;
  if (!composition) return uploadedKeys;
  try {
    const background = composition.background;
    if (/^data:image\//i.test(background?.value || '')) {
      const stored = await uploadDataUrl(background.value, 'poster-assets/' + userId + '/' + recordId + '/background-' + Date.now() + '.webp');
      composition.background = { ...background, value: stored.src, r2Key: stored.r2Key, bucket: stored.bucket };
    }
    for (const item of composition.assets?.images || []) {
      if (!/^data:image\//i.test(item.src || '')) continue;
      const safeId = String(item.id || Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
      const stored = await uploadDataUrl(item.src, 'poster-assets/' + userId + '/' + recordId + '/' + (safeId || 'image') + '-' + Date.now() + '.webp');
      item.src = stored.src; item.r2Key = stored.r2Key; item.bucket = stored.bucket;
    }
    return uploadedKeys;
  } catch (error) {
    if (uploadedKeys.length) {
      try {
        const cleanup = await bucket.remove(uploadedKeys);
        if (cleanup?.error) console.warn('[Poster Composer] Could not clean up partial R2 uploads:', cleanup.error);
      } catch (cleanupError) {
        // Preserve the original upload/conversion failure so the user sees the
        // actionable cause; cleanup can be retried independently.
        console.warn('[Poster Composer] Partial R2 upload cleanup failed:', cleanupError);
      }
    }
    throw error;
  }
}
export async function savePosterSnapshot({ record, supabase, r2Client, createSnapshot }) {
  if (!record?.id) throw new Error('Open a saved NIF asset before saving a poster to the cloud.');
  if (!supabase?.auth?.getUser || !supabase?.from) throw new Error('Account connection is not ready.');
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) throw new Error('Sign in before saving this poster to the cloud.');
  if (!record.user_id || record.user_id !== authData.user.id) throw new Error('You can only save poster media to a NIF asset owned by your signed-in account.');
  let uploadedKeys = [];
  let metadataCommitted = false;
  try {
    const savedData = createSnapshot();
    uploadedKeys = await persistPosterImagesToR2(savedData.poster, authData.user.id, record.id, r2Client);
    const metadata = { ...(record.metadata || {}), ...(record.meta || {}), present: savedData };
    const { error } = await supabase.from('nif_files').update({ meta: metadata }).eq('id', record.id);
    if (error) throw error;
    metadataCommitted = true;
    return { savedData, metadata, uploadedKeys };
  } catch (error) {
    if (!metadataCommitted && uploadedKeys.length) {
      try {
        const cleanup = await r2Client.from('thumbnails').remove(uploadedKeys);
        if (cleanup.error) console.warn('[Poster Composer] Could not clean up failed cloud-save uploads:', cleanup.error);
      } catch (cleanupError) {
        console.warn('[Poster Composer] Could not clean up failed cloud-save uploads:', cleanupError);
      }
    }
    throw error;
  }
}
