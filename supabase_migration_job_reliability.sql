-- FUMOCA job reliability (2026-11-25). Safe to run more than once.
--
-- Production had 15 reconstruction jobs stuck in 'processing' since Sept/Oct
-- (the Kaggle worker died mid-job) and 2 mesh-only jobs that could never be
-- claimed because claim_next_mesh_only_job() was never created. Users saw
-- "processing" forever with no way to retry.

-- 1. The CPU mesh-only worker's claim function (from supabase_migration_cpu_mesh_worker.sql).
create or replace function public.claim_next_mesh_only_job()
returns setof public.reconstruction_jobs
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare claimed_job public.reconstruction_jobs;
begin
  select * into claimed_job from public.reconstruction_jobs
   where status = 'queued' and capture_mode = 'mesh_only'
   order by created_at asc for update skip locked limit 1;
  if not found then return; end if;
  update public.reconstruction_jobs
     set status = 'processing', progress = greatest(coalesce(progress, 0), 1),
         started_at = coalesce(started_at, now()), error_message = null
   where id = claimed_job.id returning * into claimed_job;
  return next claimed_job;
end; $$;
revoke all on function public.claim_next_mesh_only_job() from public, anon, authenticated;
grant execute on function public.claim_next_mesh_only_job() to service_role;

-- 2. Watchdog: a job still 'processing'/'running' long after it started has
--    lost its worker. Mark it failed with a message the app shows, so the
--    owner can retry instead of waiting forever.
create or replace function public.expire_stale_reconstruction_jobs(max_age interval default interval '6 hours')
returns integer
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare n integer;
begin
  update public.reconstruction_jobs
     set status = 'failed',
         completed_at = coalesce(completed_at, now()),
         error_message = coalesce(nullif(error_message, ''), 'Processing stopped responding')
                         || ' — the worker timed out. Retry from your profile.'
   where status in ('processing', 'running')
     and coalesce(started_at, created_at) < now() - max_age;
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.expire_stale_reconstruction_jobs(interval) from public, anon, authenticated;
grant execute on function public.expire_stale_reconstruction_jobs(interval) to service_role;

-- 3. Run the watchdog every 15 minutes.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fumoca-expire-stale-jobs';
select cron.schedule('fumoca-expire-stale-jobs', '*/15 * * * *', $$select public.expire_stale_reconstruction_jobs()$$);
