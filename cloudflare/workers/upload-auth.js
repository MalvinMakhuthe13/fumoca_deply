/**
 * Upload key ownership.
 * The server binds the key to the verified principal. Caller-supplied prefixes are not trusted.
 */
const ALLOWED = new Set(['nif-files', 'nif-videos', 'preview-videos', 'thumbnails', 'avatars']);

export function assertUpload(principal, bucket, rawKey) {
  if (!principal?.id) return { ok: false, status: 401, reason: 'unauthenticated' };
  if (principal.kind === 'server-to-server') return { ok: true, status: 200, key: String(rawKey || ''), reason: 'server' };
  if (!ALLOWED.has(bucket)) return { ok: false, status: 400, reason: 'invalid_bucket' };
  const key = String(rawKey || '').replace(/\.\./g, '').replace(/^\/+/, '');
  if (!key) return { ok: false, status: 400, reason: 'invalid_key' };
  const prefix = principal.id + '/';
  if (key.startsWith(prefix) || key.startsWith('poster-assets/' + principal.id + '/')) {
    return { ok: true, status: 200, key, reason: 'owner' };
  }
  if (key.includes('/') && !key.startsWith(prefix)) {
    return { ok: false, status: 403, reason: 'foreign_prefix' };
  }
  return { ok: true, status: 200, key: prefix + key, reason: 'bound' };
}

/** Same prefix rule for presign, PUT /upload/:key, and multipart. */
export function authorizeStoredKey(principal, bucket, rawKey) {
  return assertUpload(principal, bucket, rawKey);
}
