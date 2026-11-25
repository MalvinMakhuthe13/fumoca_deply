/**
 * Safe NIF meta updates.
 *
 * nif_files.meta holds many independent features (present/poster/platform/
 * rig/living, variants, processing requests…). Writing back a copy of meta
 * read when the page opened silently erased anything saved since — from
 * Studio in another tab, or from another feature on the same page.
 * patchNifMeta re-reads the latest meta right before writing and applies
 * only this change to it.
 */
export async function patchNifMeta(supabase, id, mutate, { userId = null } = {}) {
  if (!supabase || !id || typeof mutate !== 'function') throw new Error('patchNifMeta: missing arguments');
  let q = supabase.from('nif_files').select('meta').eq('id', id);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This capture could not be found (or is not yours to change).');
  const latest = data.meta && typeof data.meta === 'object' ? structuredClone(data.meta) : {};
  const next = (await mutate(latest)) || latest;
  let u = supabase.from('nif_files').update({ meta: next }).eq('id', id);
  if (userId) u = u.eq('user_id', userId);
  const { error: writeError } = await u;
  if (writeError) throw writeError;
  return next;
}
