-- UCE composition presets: private, account-synchronised presentation layouts.
create table if not exists public.uce_composition_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  layers jsonb not null default '[]'::jsonb check (jsonb_typeof(layers) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists uce_composition_presets_owner_updated_idx
  on public.uce_composition_presets(user_id, updated_at desc);

alter table public.uce_composition_presets enable row level security;

drop policy if exists "Users manage own UCE composition presets" on public.uce_composition_presets;
create policy "Users manage own UCE composition presets"
  on public.uce_composition_presets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
