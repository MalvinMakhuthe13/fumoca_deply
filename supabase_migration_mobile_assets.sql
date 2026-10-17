-- FUMOCA mobile widget registry
-- Apply to a staging Supabase project first; this file does not change production.
-- The R2 object remains the widget payload. This table stores its lookup metadata.

create table if not exists public.mobile_assets (
  splat_id uuid primary key references public.nif_files(id) on delete cascade,
  asset_url text not null,
  r2_key text not null,
  format text not null default 'fumoca-widget',
  interaction_rules jsonb not null default '{}'::jsonb,
  states jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing installations may already have the table from an earlier prototype.
-- Add the key column idempotently; legacy rows can remain NULL until regenerated.
alter table public.mobile_assets add column if not exists r2_key text;

alter table public.mobile_assets enable row level security;

drop policy if exists mobile_assets_select_visible_parent on public.mobile_assets;
create policy mobile_assets_select_visible_parent
  on public.mobile_assets
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.nif_files n
      where n.id = mobile_assets.splat_id
        and (n.user_id = auth.uid() or n.is_public = true)
    )
  );

drop policy if exists mobile_assets_insert_owner on public.mobile_assets;
create policy mobile_assets_insert_owner
  on public.mobile_assets
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.nif_files n
      where n.id = mobile_assets.splat_id
        and n.user_id = auth.uid()
    )
  );

drop policy if exists mobile_assets_update_owner on public.mobile_assets;
create policy mobile_assets_update_owner
  on public.mobile_assets
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.nif_files n
      where n.id = mobile_assets.splat_id
        and n.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.nif_files n
      where n.id = mobile_assets.splat_id
        and n.user_id = auth.uid()
    )
  );

drop policy if exists mobile_assets_delete_owner on public.mobile_assets;
create policy mobile_assets_delete_owner
  on public.mobile_assets
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.nif_files n
      where n.id = mobile_assets.splat_id
        and n.user_id = auth.uid()
    )
  );

grant select on public.mobile_assets to anon, authenticated;
grant insert, update, delete on public.mobile_assets to authenticated;
