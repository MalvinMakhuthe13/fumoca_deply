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
  if (key.startsWith(prefix)) return { ok: true, status: 200, key, reason: 'owner' };
  // Namespaced layouts the app already writes: <namespace>/<userId>/...
  // The user-id segment must be the caller's own id.
  const scoped = key.match(SCOPED_NAMESPACE);
  if (scoped) {
    return scoped[2] === principal.id
      ? { ok: true, status: 200, key, reason: 'owner' }
      : { ok: false, status: 403, reason: 'foreign_prefix' };
  }
  // Any other layout (bare names, '<splatId>/edited_….nif', 'review/…',
  // 'open-variants/…', …) is bound under the caller's own prefix. The caller
  // can never land outside its prefix, and existing clients keep working
  // because r2Client returns the stored fileKey/publicUrl to them.
  return { ok: true, status: 200, key: prefix + key, reason: 'bound' };
}

const SCOPED_NAMESPACE = /^(raw|vehicle-captures|poster-assets|poster-subjects|verify-refs|print-source)\/([^/]+)\//;

/** Same prefix rule for presign, PUT /upload/:key, and multipart. */
export function authorizeStoredKey(principal, bucket, rawKey) {
  return assertUpload(principal, bucket, rawKey);
}
