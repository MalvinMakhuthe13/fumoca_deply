# FUMOCA Restart Build — Kaggle testing edition

## ⚠️ Testing locally? Read this first.
**Don't open the `.html` files by double-clicking them.** This app uses ES modules for
most of its interactive JS, and browsers refuse to load ES modules over the `file://`
protocol — that's a real Chrome/Edge/Firefox security restriction, not a bug here.
Opening files directly will show correct styling but silently fail to run anything
interactive (uploads, the feed, nav user info) — which looks like "everything is
broken" when it's really just "wrong way to open it."

**Instead, run one command:**
```bash
./scripts/serve-local.sh        # Mac/Linux
scripts\serve-local.bat         # Windows (double-click it, or run from a terminal)
```
Then open **http://localhost:8000/feed.html** in your browser — not a `file://` link.
If you ever do open a page via `file://` by mistake, the app now shows a banner
explaining exactly this, instead of failing silently.

This rebuild keeps the premium UI direction, keeps Supabase as the main database/auth/storage layer, and removes the old extra backend dependency so testing is cleaner.

## What is now properly wired
- static frontend stays intact
- Supabase handles auth, database, storage, queue state, and viewer analytics
- source videos upload into a private `splat-videos` bucket
- uploads create `splats` + `processing_jobs` records directly in Supabase
- Kaggle notebook can poll queued jobs and update progress back into Supabase
- viewer interactions are written straight into `viewer_events`

## Important fixes in this build
- removed the old extra runtime config and backend API calls from the frontend
- removed the bundled unused backend from the project
- added a Kaggle-first worker folder and setup guide
- kept the queue shape simple so local, Kaggle, or later GPU workers can reuse it
- kept `video_bucket` + `video_path` so workers can fetch source files correctly

## Setup order
1. Copy `config.example.js` to `config.js` and fill in real values.
2. Run `supabase_schema.sql` in Supabase SQL editor.
3. Run `supabase_storage_policies.sql` in Supabase SQL editor.
4. Create the storage buckets named in the SQL comments.
5. Deploy the static frontend.
6. Open the Kaggle notebook and run the worker against your Supabase project for testing.

## Viewer modes
Examples:
- `viewer.html?mode=car&title=BMW%20M4`
- `viewer.html?mode=property&title=Modern%20Sandton%20Penthouse`
- `viewer.html?mode=event&title=Wedding%20Reception`

## What this testing version is designed for
- seamless upload → queue → process testing
- clean Supabase-first flow without an extra backend in the middle
- fast iteration while you prove the full splat pipeline

## What still is not magically solved
- Kaggle sessions are not always-on production infrastructure
- long jobs can still be interrupted by notebook/runtime limits
- heavy production COLMAP/GPU workloads will still need a more permanent worker later
- advanced queue requests (event_fast_clean, fourd_reconstruction, motion tracking metadata) now persist their full payload into splats.metadata.processing_requests so a dispatcher/worker can consume the real request details later


## Real splat viewer and storage setup

This bundle now resolves real splat records from `splats.splat_url` in `viewer.html` and opens viewer links with `splatId`, so finished Kaggle jobs load the real `.ply` asset instead of staying in the premium shell.

Before testing uploads, run `supabase_storage_policies.sql`. That file now creates the required buckets automatically:
- `splat-videos`
- `splat-files`
- `thumbnails`
- `avatars`

Then rerun the Kaggle worker with `USE_REAL_ENGINE=1` when you are ready for true splat generation instead of the fallback placeholder.


## Storage setup is mandatory before first upload
Run `supabase_storage_policies.sql` in the Supabase SQL editor, then run `STORAGE_SETUP_CHECK.sql` to confirm the four buckets exist before testing uploads.
