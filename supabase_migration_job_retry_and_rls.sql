-- FUMOCA job retry + tighter job permissions (2026-11-25). Safe to run more than once.
--
-- Before: one policy "own jobs" (ALL, no WITH CHECK) let a signed-in user
-- UPDATE their own job rows freely — e.g. mark a job 'complete' or point
-- nif_r2_key at any object. No client code updates jobs; only the workers
-- (service role) do. Users now get: read own jobs, create a fresh queued job,
-- delete their own failed/queued job, and retry a failed one through a
-- checked function (max 3 retries, only when the original upload exists).

drop policy if exists "own jobs" on public.reconstruction_jobs;
drop policy if exists "own jobs read" on public.reconstruction_jobs;
drop policy if exists "own jobs create" on public.reconstruction_jobs;
drop policy if exists "own jobs delete" on public.reconstruction_jobs;

create policy "own jobs read" on public.reconstruction_jobs
  for select to authenticated using (auth.uid() = user_id);

create policy "own jobs create" on public.reconstruction_jobs
  for insert to authenticated with check (
    auth.uid() = user_id
    and status in ('queued', 'staged', 'pending')
    and raw_r2_key is not null
    and (
      split_part(raw_r2_key, '/', 1) = auth.uid()::text
      or (
        split_part(raw_r2_key, '/', 1) in ('raw', 'vehicle-captures', 'poster-assets', 'poster-subjects', 'verify-refs', 'print-source')
        and split_part(raw_r2_key, '/', 2) = auth.uid()::text
      )
    )
    and nif_r2_key is null
    and coalesce(progress, 0) = 0
    and error_message is null
    and started_at is null and completed_at is null
  );

create policy "own jobs delete" on public.reconstruction_jobs
  for delete to authenticated using (auth.uid() = user_id and status in ('failed', 'queued', 'staged', 'pending'));

create or replace function public.retry_reconstruction_job(p_job uuid)
returns public.reconstruction_jobs
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare j public.reconstruction_jobs;
declare tries integer;
begin
  if auth.uid() is null then raise exception 'Sign in to retry.' using errcode = '28000'; end if;
  select * into j from public.reconstruction_jobs where id = p_job for update;
  if not found or j.user_id is distinct from auth.uid() then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if j.status <> 'failed' then raise exception 'Only failed jobs can be retried.' using errcode = '22023'; end if;
  if coalesce(j.raw_r2_key, '') = '' then
    raise exception 'The original upload is missing — please upload again.' using errcode = '22023';
  end if;
  if coalesce(j.meta->>'retry_count', '') = '' then
    tries := 0;
  elsif j.meta->>'retry_count' ~ '^[0-9]+
  if tries >= 3 then raise exception 'This job has been retried 3 times — please upload again.' using errcode = '22023'; end if;
  update public.reconstruction_jobs
     set status = 'queued', progress = 0, error_message = null,
         started_at = null, completed_at = null,
         meta = coalesce(meta, '{}'::jsonb)
                || jsonb_build_object('retry_count', tries + 1,
                                      'last_error', j.error_message,
                                      'retried_at', now())
   where id = j.id returning * into j;
  return j;
end; $$;
revoke all on function public.retry_reconstruction_job(uuid) from public, anon;
grant execute on function public.retry_reconstruction_job(uuid) to authenticated;
 then
    tries := (j.meta->>'retry_count')::int;
  else
    raise exception 'Retry counter is invalid — contact support before retrying.' using errcode = '22023';
  end if;
  if tries >= 3 then raise exception 'This job has been retried 3 times — please upload again.' using errcode = '22023'; end if;
  update public.reconstruction_jobs
     set status = 'queued', progress = 0, error_message = null,
         started_at = null, completed_at = null,
         meta = coalesce(meta, '{}'::jsonb)
                || jsonb_build_object('retry_count', tries + 1,
                                      'last_error', j.error_message,
                                      'retried_at', now())
   where id = j.id returning * into j;
  return j;
end; $$;
revoke all on function public.retry_reconstruction_job(uuid) from public, anon;
grant execute on function public.retry_reconstruction_job(uuid) to authenticated;
