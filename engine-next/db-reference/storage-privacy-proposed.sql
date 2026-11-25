-- PROPOSED. Do not run against production without explicit approval.
-- Makes source captures private. This file does not change live policies.

update storage.buckets set public = false where id = 'splat-videos';
update storage.buckets set public = false where id = 'splat-files';

-- thumbnails and avatars stay public by intent.
-- Published NIF delivery stays on the R2 worker GET /file path.

-- Rollback:
-- update storage.buckets set public = true where id in ('splat-videos', 'splat-files');
