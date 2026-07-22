-- FUMOCA storage bootstrap + policies
-- Run this in Supabase SQL editor as the project owner.
-- It creates the required buckets if they are missing and applies policies for uploads and worker writes.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('splat-videos', 'splat-videos', true, 2147483648, array['video/mp4','video/quicktime','video/x-msvideo','video/webm','video/mpeg']),
  ('splat-files', 'splat-files', true, 2147483648, array['application/octet-stream','application/ply','text/plain']),
  ('thumbnails', 'thumbnails', true, 104857600, array['image/jpeg','image/png','image/webp']),
  ('avatars', 'avatars', true, 10485760, array['image/jpeg','image/png','image/webp']),
  ('preview-videos', 'preview-videos', true, 2147483648, array['video/webm','video/mp4','video/quicktime'])
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- authenticated uploads for source videos
 drop policy if exists "Users upload source videos" on storage.objects;
 create policy "Users upload source videos"
 on storage.objects for insert
 to authenticated
 with check (
   bucket_id = 'splat-videos'
   and (storage.foldername(name))[1] = auth.uid()::text
 );

 drop policy if exists "Users read source videos" on storage.objects;
 create policy "Users read source videos"
 on storage.objects for select
 to authenticated
 using (
   bucket_id = 'splat-videos'
   and (
     (storage.foldername(name))[1] = auth.uid()::text
     or auth.role() = 'service_role'
   )
 );

 drop policy if exists "Users update source videos" on storage.objects;
 create policy "Users update source videos"
 on storage.objects for update
 to authenticated
 using (
   bucket_id = 'splat-videos'
   and (storage.foldername(name))[1] = auth.uid()::text
 )
 with check (
   bucket_id = 'splat-videos'
   and (storage.foldername(name))[1] = auth.uid()::text
 );

 drop policy if exists "Users delete source videos" on storage.objects;
 create policy "Users delete source videos"
 on storage.objects for delete
 to authenticated
 using (
   bucket_id = 'splat-videos'
   and (storage.foldername(name))[1] = auth.uid()::text
 );

-- service role full access
 drop policy if exists "Service role manages source videos" on storage.objects;
 create policy "Service role manages source videos"
 on storage.objects for all
 to service_role
 using (bucket_id = 'splat-videos')
 with check (bucket_id = 'splat-videos');

 drop policy if exists "Public read splat files" on storage.objects;
 create policy "Public read splat files"
 on storage.objects for select
 to public
 using (bucket_id = 'splat-files');

 drop policy if exists "Service role manages splat files" on storage.objects;
 create policy "Service role manages splat files"
 on storage.objects for all
 to service_role
 using (bucket_id = 'splat-files')
 with check (bucket_id = 'splat-files');

 
 drop policy if exists "Public read preview videos" on storage.objects;
 create policy "Public read preview videos"
 on storage.objects for select
 to public
 using (bucket_id = 'preview-videos');

 drop policy if exists "Authenticated upload preview videos" on storage.objects;
 create policy "Authenticated upload preview videos"
 on storage.objects for insert
 to authenticated
 with check (bucket_id = 'preview-videos');

 drop policy if exists "Authenticated update preview videos" on storage.objects;
 create policy "Authenticated update preview videos"
 on storage.objects for update
 to authenticated
 using (bucket_id = 'preview-videos')
 with check (bucket_id = 'preview-videos');

 drop policy if exists "Authenticated delete preview videos" on storage.objects;
 create policy "Authenticated delete preview videos"
 on storage.objects for delete
 to authenticated
 using (bucket_id = 'preview-videos');

 drop policy if exists "Service role manages preview videos" on storage.objects;
 create policy "Service role manages preview videos"
 on storage.objects for all
 to service_role
 using (bucket_id = 'preview-videos')
 with check (bucket_id = 'preview-videos');

drop policy if exists "Public read thumbnails" on storage.objects;
 create policy "Public read thumbnails"
 on storage.objects for select
 to public
 using (bucket_id = 'thumbnails');

 drop policy if exists "Service role manages thumbnails" on storage.objects;
 create policy "Service role manages thumbnails"
 on storage.objects for all
 to service_role
 using (bucket_id = 'thumbnails')
 with check (bucket_id = 'thumbnails');

 drop policy if exists "Users upload avatars" on storage.objects;
 create policy "Users upload avatars"
 on storage.objects for insert
 to authenticated
 with check (
   bucket_id = 'avatars'
   and (storage.foldername(name))[1] = auth.uid()::text
 );

 drop policy if exists "Public read avatars" on storage.objects;
 create policy "Public read avatars"
 on storage.objects for select
 to public
 using (bucket_id = 'avatars');

commit;
