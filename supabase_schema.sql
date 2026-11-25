-- ============================================================
-- FUMOCA RESTART SCHEMA (safe to run on a new project)
-- ============================================================
create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  first_name text default '',
  last_name text default '',
  bio text,
  avatar_url text,
  account_type text not null default 'creator' check (account_type in ('creator','brand')),
  creator_type text,
  brand_name text,
  website text,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  splat_count integer not null default 0,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.splats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  category text default 'other',
  tags text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public','followers','private')),
  video_bucket text not null default 'splat-videos',
  video_path text,
  video_url text,
  video_filename text,
  splat_url text,
  thumbnail_url text,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  processing_stage text not null default 'queued' check (processing_stage in (
    'queued','downloading_video','extracting_frames','building_colmap_scene','training_gaussians','uploading_assets','done','failed'
  )),
  processing_progress integer not null default 0 check (processing_progress between 0 and 100),
  processing_started_at timestamptz,
  processing_completed_at timestamptz,
  processing_error text,
  monetize_sale boolean not null default false,
  price_zar numeric(10,2),
  monetize_print boolean not null default false,
  like_count integer not null default 0,
  view_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.processing_jobs (
  id uuid primary key default uuid_generate_v4(),
  splat_id uuid not null references public.splats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_bucket text not null default 'splat-videos',
  video_path text not null,
  video_url text,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  stage text not null default 'queued' check (stage in (
    'queued','downloading_video','extracting_frames','building_colmap_scene','training_gaussians','uploading_assets','done','failed'
  )),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  log_output text,
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id)
);

create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  splat_id uuid not null references public.splats(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, splat_id)
);

create table if not exists public.comments (
  id uuid primary key default uuid_generate_v4(),
  splat_id uuid not null references public.splats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  parent_id uuid references public.comments(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default uuid_generate_v4(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  splat_id uuid not null references public.splats(id) on delete cascade,
  order_type text not null check (order_type in ('digital','print')),
  amount_zar numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending','paid','fulfilled','refunded')),
  payment_ref text,
  shipping_address jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.viewer_events (
  id uuid primary key default uuid_generate_v4(),
  splat_id uuid references public.splats(id) on delete set null,
  event_type text not null default 'view' check (event_type in ('view','cta_click','sound_play','share_open')),
  mode text not null default 'other' check (mode in ('car','property','event','other')),
  ref_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.splats enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.follows enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.orders enable row level security;
alter table public.viewer_events enable row level security;

drop policy if exists "Public profiles viewable" on public.profiles;
create policy "Public profiles viewable" on public.profiles for select using (true);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Public splats viewable" on public.splats;
create policy "Public splats viewable" on public.splats for select using (visibility = 'public' or auth.uid() = user_id);
drop policy if exists "Owners manage splats" on public.splats;
create policy "Owners manage splats" on public.splats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users view own jobs" on public.processing_jobs;
create policy "Users view own jobs" on public.processing_jobs for select using (auth.uid() = user_id);
drop policy if exists "Users insert jobs" on public.processing_jobs;
create policy "Users insert jobs" on public.processing_jobs for insert with check (auth.uid() = user_id);

drop policy if exists "Follows viewable" on public.follows;
create policy "Follows viewable" on public.follows for select using (true);
drop policy if exists "Users manage own follows" on public.follows;
create policy "Users manage own follows" on public.follows for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

drop policy if exists "Likes viewable" on public.likes;
create policy "Likes viewable" on public.likes for select using (true);
drop policy if exists "Users manage own likes" on public.likes;
create policy "Users manage own likes" on public.likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Comments viewable" on public.comments;
create policy "Comments viewable" on public.comments for select using (true);
drop policy if exists "Users manage own comments" on public.comments;
create policy "Users manage own comments" on public.comments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users view own orders" on public.orders;
create policy "Users view own orders" on public.orders for select using (auth.uid() = buyer_id);
drop policy if exists "Users create orders" on public.orders;
create policy "Users create orders" on public.orders for insert with check (auth.uid() = buyer_id);

drop policy if exists "Viewer events insertable" on public.viewer_events;
create policy "Viewer events insertable" on public.viewer_events for insert with check (true);
drop policy if exists "Viewer events readable by everyone" on public.viewer_events;
create policy "Viewer events readable by everyone" on public.viewer_events for select using (true);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists trg_splats_touch on public.splats;
create trigger trg_splats_touch before update on public.splats for each row execute function public.touch_updated_at();
drop trigger if exists trg_jobs_touch on public.processing_jobs;
create trigger trg_jobs_touch before update on public.processing_jobs for each row execute function public.touch_updated_at();
drop trigger if exists trg_orders_touch on public.orders;
create trigger trg_orders_touch before update on public.orders for each row execute function public.touch_updated_at();

create or replace function public.increment_like_count() returns trigger as $$
begin
  update public.splats set like_count = like_count + 1 where id = new.splat_id;
  return new;
end;
$$ language plpgsql security definer;

create or replace function public.decrement_like_count() returns trigger as $$
begin
  update public.splats set like_count = greatest(0, like_count - 1) where id = old.splat_id;
  return old;
end;
$$ language plpgsql security definer;

drop trigger if exists on_like_insert on public.likes;
create trigger on_like_insert after insert on public.likes for each row execute function public.increment_like_count();
drop trigger if exists on_like_delete on public.likes;
create trigger on_like_delete after delete on public.likes for each row execute function public.decrement_like_count();

create or replace function public.update_splat_count() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set splat_count = splat_count + 1 where id = new.user_id;
  elsif tg_op = 'DELETE' then
    update public.profiles set splat_count = greatest(0, splat_count - 1) where id = old.user_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_splat_change on public.splats;
create trigger on_splat_change after insert or delete on public.splats for each row execute function public.update_splat_count();

create or replace function public.update_follow_counts() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set follower_count = follower_count + 1 where id = new.following_id;
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
  elsif tg_op = 'DELETE' then
    update public.profiles set follower_count = greatest(0, follower_count - 1) where id = old.following_id;
    update public.profiles set following_count = greatest(0, following_count - 1) where id = old.follower_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_follow_change on public.follows;
create trigger on_follow_change after insert or delete on public.follows for each row execute function public.update_follow_counts();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, first_name, last_name, account_type)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1) || '_' || substr(new.id::text,1,6)),
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'account_type', 'creator')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.claim_next_job()
returns table (
  id uuid,
  splat_id uuid,
  user_id uuid,
  video_bucket text,
  video_path text,
  status text,
  stage text,
  progress_percent integer,
  queued_at timestamptz
) as $$
declare
  v_job public.processing_jobs;
begin
  select *
  into v_job
  from public.processing_jobs
  where status = 'queued'
  order by queued_at asc
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.processing_jobs
  set status = 'running',
      stage = case when stage = 'queued' then 'downloading_video' else stage end,
      started_at = now(),
      updated_at = now()
  where public.processing_jobs.id = v_job.id;

  return query
  select j.id, j.splat_id, j.user_id, j.video_bucket, j.video_path, j.status, j.stage, j.progress_percent, j.queued_at
  from public.processing_jobs j
  where j.id = v_job.id;
end;
$$ language plpgsql security definer;

grant execute on function public.claim_next_job() to authenticated, service_role;
