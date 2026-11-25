-- FUMOCA security hardening — 2026-11-25 QA/QC (applied to fumoca-production).
-- Every change was checked against the app code: the browser only calls
-- create_order_from_cart, increment_view_count, increment_embed_view,
-- is_valid_username and search_nifs; workers and backend-api use the
-- service_role key, which is unaffected by these grants and RLS.

-- 1. SECURITY DEFINER functions that nobody outside the backend should call.
--    fork_nif let anyone create NIF rows owned by any user; get_revenue_summary
--    leaked any user's licence revenue; create_notification let anyone send
--    notifications (with links) to any user; claim_next_job handed out other
--    users' jobs and video paths.
revoke execute on function public.claim_next_job() from public, anon, authenticated;
revoke execute on function public.fork_nif(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.get_revenue_summary(uuid) from public, anon, authenticated;
revoke execute on function public.create_notification(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.increment_nif_count(uuid) from public, anon, authenticated;
revoke execute on function public.get_nif_view_stats(uuid) from public, anon, authenticated;
-- Worker queue claims (workers use service_role).
revoke execute on function public.claim_next_reconstruction_job() from public, anon, authenticated;
revoke execute on function public.claim_next_print_job() from public, anon, authenticated;
revoke execute on function public.claim_next_presentation_render() from public, anon, authenticated;
-- Trigger functions: triggers do not need EXECUTE for the calling role.
revoke execute on function public.create_user_quota() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_follow() from public, anon, authenticated;
revoke execute on function public.handle_like() from public, anon, authenticated;
revoke execute on function public.increment_like_count() from public, anon, authenticated;
revoke execute on function public.decrement_like_count() from public, anon, authenticated;
revoke execute on function public.notify_on_comment() from public, anon, authenticated;
revoke execute on function public.notify_on_follow() from public, anon, authenticated;
revoke execute on function public.update_follow_counts() from public, anon, authenticated;
revoke execute on function public.update_splat_count() from public, anon, authenticated;
grant execute on function
  public.claim_next_job(), public.fork_nif(uuid, text, uuid), public.get_revenue_summary(uuid),
  public.create_notification(uuid, text, text, text, text, jsonb), public.increment_nif_count(uuid),
  public.get_nif_view_stats(uuid), public.claim_next_reconstruction_job(), public.claim_next_print_job(),
  public.claim_next_presentation_render()
  to service_role;

-- 2. Pin search_path on every public function (prevents search-path hijacking).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', f.sig);
  end loop;
end $$;

-- 3. Tables that had RLS switched off (fully readable/writable with the anon key).
alter table public.verticals enable row level security;
drop policy if exists "verticals readable" on public.verticals;
create policy "verticals readable" on public.verticals for select using (true);

-- Backend-only (service_role bypasses RLS): no client policies at all.
alter table public.analytics_events enable row level security;
alter table public.delivery_views enable row level security;   -- holds visitor IPs

alter table public.nif_collection_items enable row level security;
drop policy if exists "collection items readable" on public.nif_collection_items;
create policy "collection items readable" on public.nif_collection_items for select using (
  exists (select 1 from public.nif_collections c
          where c.id = nif_collection_items.collection_id and (c.is_public or c.user_id = auth.uid())));
drop policy if exists "collection owner manages items" on public.nif_collection_items;
create policy "collection owner manages items" on public.nif_collection_items for all
  using (exists (select 1 from public.nif_collections c where c.id = nif_collection_items.collection_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.nif_collections c where c.id = nif_collection_items.collection_id and c.user_id = auth.uid()));

alter table public.social_shares enable row level security;
drop policy if exists "own shares" on public.social_shares;
create policy "own shares" on public.social_shares for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Feed views ran with the creator's rights (bypassing RLS). They only show
--    public NIFs, so running them as the caller changes nothing visible.
alter view public.social_feed set (security_invoker = on);
alter view public.discover_feed set (security_invoker = on);
alter view public.nif_feed set (security_invoker = on);
alter view public.nif_trending set (security_invoker = on);
alter view public.nif_moment_highlights set (security_invoker = on);

-- 5. Legacy orders: buyers may only create unpaid, pending orders.
drop policy if exists "Users create orders" on public.orders;
create policy "Users create orders" on public.orders for insert with check (
  auth.uid() = buyer_id and status = 'pending' and payment_ref is null and amount_zar > 0);

-- 6. Storage: any signed-in user could overwrite/delete anyone's preview video.
drop policy if exists "Authenticated update preview videos" on storage.objects;
create policy "Authenticated update preview videos" on storage.objects for update to authenticated
  using (bucket_id = 'preview-videos' and owner = auth.uid())
  with check (bucket_id = 'preview-videos' and owner = auth.uid());
drop policy if exists "Authenticated delete preview videos" on storage.objects;
create policy "Authenticated delete preview videos" on storage.objects for delete to authenticated
  using (bucket_id = 'preview-videos' and owner = auth.uid());
-- Raw capture videos should never be world-readable by URL (bucket is empty; uploads use R2).
update storage.buckets set public = false where id = 'splat-videos';
