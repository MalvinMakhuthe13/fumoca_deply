-- FUMOCA: CPU-only oriented-surfel reconstruction queue.
-- Safe to run more than once. Claims only existing-geometry mesh_only jobs;
-- full video/photo reconstruction remains assigned to its separate worker.

create or replace function public.claim_next_mesh_only_job()
returns setof public.reconstruction_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_job public.reconstruction_jobs;
begin
  select *
    into claimed_job
    from public.reconstruction_jobs
   where status = 'queued'
     and capture_mode = 'mesh_only'
   order by created_at asc
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.reconstruction_jobs
     set status = 'processing',
         progress = greatest(coalesce(progress, 0), 1),
         started_at = coalesce(started_at, now()),
         error_message = null
   where id = claimed_job.id
   returning * into claimed_job;

  return next claimed_job;
  return;
end;
$$;

revoke all on function public.claim_next_mesh_only_job() from public;
grant execute on function public.claim_next_mesh_only_job() to service_role;
