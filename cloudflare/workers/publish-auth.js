/**
 * Public delivery boundary.
 * A file is public only if the server registry marks it published, or it is a thumbnail/avatar.
 */
export function canReadPublic({ key, bucket, registry }) {
  if (!key) return { ok: false, status: 400, reason: 'missing_key' };
  if (bucket && !['nif-files', 'thumbnails', 'avatars', 'preview-videos'].includes(bucket)) {
    return { ok: false, status: 400, reason: 'bucket_rejected' };
  }
  if (bucket === 'thumbnails' || bucket === 'avatars' || key.startsWith('thumbs/') || key.startsWith('avatars/')) {
    return { ok: true, status: 200, reason: 'intentional_public' };
  }
  const published = registry?.has?.(key) || registry?.[key] === true;
  if (!published) return { ok: false, status: 404, reason: 'not_published' };
  return { ok: true, status: 200, reason: 'published' };
}

export function canPublish(principal, env) {
  if (!principal?.id) return { ok: false, status: 401, reason: 'unauthenticated' };
  const ids = String(env?.FUMOCA_FOUNDER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.includes(principal.id)) return { ok: false, status: 403, reason: 'not_founder' };
  return { ok: true, status: 200, reason: 'founder' };
}
