
/**
 * DELETE ownership. Identity comes from the verified principal, not the request body.
 */
export function sanitiseKey(rawPath) {
  return String(rawPath || '')
    .replace(/\.\./g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .slice(0, 1024);
}

export function canDelete(principal, fileKey) {
  if (!principal?.id) return { ok: false, status: 401, reason: 'unauthenticated' };
  const key = sanitiseKey(fileKey);
  if (!key) return { ok: false, status: 400, reason: 'bad_key' };
  if (principal.kind === 'server-to-server') return { ok: true, status: 200, reason: 'server' };
  const owned = key.startsWith(principal.id + '/') || key.startsWith('poster-assets/' + principal.id + '/');
  if (owned) return { ok: true, status: 200, reason: 'owner' };
  return { ok: false, status: 403, reason: 'not_owner' };
}
