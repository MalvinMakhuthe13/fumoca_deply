/**
 * READ ownership for private storage keys.
 *
 * Most objects are public by design (published NIFs, thumbnails, previews,
 * review videos). Raw capture material is not: burst-photo zips under
 * raw/<user>/, vehicle captures under vehicle-captures/<user>/, verification
 * reference photos under verify-refs/<user>/, and source uploads under
 * <user>/sources/ or <user>/<filename>. Public review/<id> videos stay public. Those are readable only by their
 * owner (or the server workers), and are never put in the shared cache.
 */
const PRIVATE_RULES = {
  'nif-videos': [
    /^vehicle-captures\/([0-9a-f-]{36})\//i,
    /^raw\/([0-9a-f-]{36})\//i,
    /^verify-refs\/([0-9a-f-]{36})\//i,
    /^([0-9a-f-]{36})\/sources\//i,
    /^([0-9a-f-]{36})\/[^/]+$/i,
  ],
};

/** Returns the owner id if the key is private, otherwise null. */
export function privateOwner(bucket, key) {
  for (const rule of PRIVATE_RULES[bucket] || []) {
    const m = String(key || '').match(rule);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function canRead(principal, bucket, key) {
  const owner = privateOwner(bucket, key);
  if (!owner) return { ok: true, status: 200, private: false };
  if (!principal?.id) return { ok: false, status: 401, private: true };
  if (principal.kind === 'server-to-server') return { ok: true, status: 200, private: true };
  if (String(principal.id).toLowerCase() === owner) return { ok: true, status: 200, private: true };
  return { ok: false, status: 404, private: true };      // don't confirm the file exists
}
