-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: embeds table + embed_token column + view-count RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS:
-- js/modules/embed-manager.js has been calling supabase.from('embeds')...,
-- reading/writing a nif_files.embed_token column, and calling an
-- increment_embed_view RPC since it was written — but none of the three
-- exist in the real, live schema (confirmed against production: only
-- nif_files/reconstruction_jobs exist — NOT splats/processing_jobs, which
-- the rest of the JS app was mistakenly built against). This migration adds
-- the missing pieces against the table that's actually deployed.
--
-- Run this against your Supabase project (SQL Editor, or `supabase db push`
-- if you're using the CLI with migrations/).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. embed_token column on nif_files — embed-manager.js writes this after
--    creating an embed, so the app can quickly check "does this NIF have
--    an embed yet" without a join.
alter table public.nif_files
  add column if not exists embed_token uuid;

create index if not exists idx_nif_files_embed_token
  on public.nif_files (embed_token);

-- 2. embeds table
create table if not exists public.embeds (
  id               uuid primary key default gen_random_uuid(),
  token            uuid not null default gen_random_uuid() unique,
  splat_id         uuid not null references public.nif_files(id) on delete cascade,
  label            text,
  allowed_origins  text[] not null default '{}',
  embed_config     jsonb not null default '{}'::jsonb,
  view_count       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists idx_embeds_splat_id on public.embeds (splat_id);
create index if not exists idx_embeds_token on public.embeds (token);

-- 3. increment_embed_view RPC — embed-manager.js calls this first and only
--    falls back to a manual select+update if the RPC is missing. Defining
--    it means every view increments atomically instead of racing. This is
--    deliberately separate from the existing increment_view_count(uuid)
--    function already in your schema — that one counts total views of a
--    NIF; this one counts views through a specific embed link.
create or replace function public.increment_embed_view(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.embeds
  set view_count = view_count + 1,
      updated_at = now()
  where token = p_token;
$$;

-- 4. RLS — embeds must be publicly readable by token (that's the whole point
--    of an embed link) but only the owner of the underlying NIF may create
--    or modify one.
alter table public.embeds enable row level security;

drop policy if exists "Anyone can read an embed by token" on public.embeds;
create policy "Anyone can read an embed by token"
  on public.embeds for select
  using (true);

drop policy if exists "NIF owners can create embeds" on public.embeds;
create policy "NIF owners can create embeds"
  on public.embeds for insert
  with check (
    exists (
      select 1 from public.nif_files n
      where n.id = splat_id and n.user_id = auth.uid()
    )
  );

drop policy if exists "NIF owners can update their embeds" on public.embeds;
create policy "NIF owners can update their embeds"
  on public.embeds for update
  using (
    exists (
      select 1 from public.nif_files n
      where n.id = splat_id and n.user_id = auth.uid()
    )
  );

drop policy if exists "NIF owners can delete their embeds" on public.embeds;
create policy "NIF owners can delete their embeds"
  on public.embeds for delete
  using (
    exists (
      select 1 from public.nif_files n
      where n.id = splat_id and n.user_id = auth.uid()
    )
  );

-- increment_embed_view must be callable by anonymous visitors (that's who
-- views an embed) — grant execute to anon/authenticated explicitly.
grant execute on function public.increment_embed_view(uuid) to anon, authenticated;
