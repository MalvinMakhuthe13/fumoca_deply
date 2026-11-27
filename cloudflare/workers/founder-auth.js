/**
 * Server-side founder check.
 * Trusts only the user id returned by Supabase for a validated token.
 * Does not trust email or role sent by the browser.
 */
export function founderIds(env) {
  return String(env?.FUMOCA_FOUNDER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function isFounderId(userId, env) {
  if (!userId) return false;
  const ids = founderIds(env);
  if (!ids.length) return false;
  return ids.includes(userId);
}

export async function authorizeFounder(request, env, fetchImpl = fetch) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return { ok: false, status: 401, reason: 'no_token' };
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) return { ok: false, status: 503, reason: 'auth_unconfigured' };
  const resp = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (resp.status === 401 || resp.status === 403) return { ok: false, status: 401, reason: 'invalid_token' };
  if (!resp.ok) return { ok: false, status: 401, reason: 'rejected_token' };
  const user = await resp.json();
  if (!user?.id) return { ok: false, status: 401, reason: 'no_user' };
  if (!isFounderId(user.id, env)) return { ok: false, status: 403, reason: 'not_founder', userId: user.id };
  return { ok: true, status: 200, userId: user.id };
}
