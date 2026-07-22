# FUMOCA Kaggle worker setup

Use this version for testing the real queue flow without an extra backend in the middle.

## What Kaggle does here
- polls Supabase for queued jobs
- downloads the private source video from Supabase
- runs frame extraction / COLMAP / Gaussian Splatting
- uploads outputs back to Supabase storage
- updates `processing_jobs` and `splats` directly

## Folder to use
- `kaggle/kaggle_bootstrap.py`
- `kaggle/fumoca_kaggle_worker.py`

## Recommended Kaggle flow
1. Create a Kaggle notebook with internet enabled.
2. Add your secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Copy the files from the `kaggle/` folder into the notebook working area.
4. Run:
   - `python kaggle_bootstrap.py`
   - `python fumoca_kaggle_worker.py`

## Suggested environment variables
- `VIDEO_BUCKET=splat-videos`
- `SPLAT_BUCKET=splat-files`
- `THUMB_BUCKET=thumbnails`
- `POLL_SECONDS=10`
- `FRAME_FPS=3`
- `MAX_FRAMES=180`
- `TRAIN_ITERS=7000`
- `USE_REAL_ENGINE=1`
- `GS_REPO_DIR=/kaggle/working/gaussian-splatting`
- `GS_DATA_ROOT=/kaggle/working/fumoca_jobs`
- `COLMAP_BIN=colmap`
- `FFMPEG_BIN=ffmpeg`

## Clean testing flow
1. User uploads a video in FUMOCA.
2. Frontend stores the video in Supabase Storage.
3. Frontend inserts a queued `splats` row.
4. Frontend inserts a queued `processing_jobs` row.
5. Kaggle worker picks up the next queued job.
6. Kaggle worker updates progress in Supabase.
7. Viewer loads the produced asset when the job is done.

## Notes
- Kaggle is good for proving the loop and getting test results.
- It is not your forever production worker.
- Once the loop is stable, you can later swap Kaggle for a dedicated GPU worker without changing the frontend queue flow.

## Kaggle headless COLMAP note

This bundle now runs COLMAP in headless mode with `QT_QPA_PLATFORM=offscreen` and CPU SIFT (`--SiftExtraction.use_gpu 0`, `--SiftMatching.use_gpu 0`) because Kaggle notebooks do not provide a normal X display for Qt-based GPU SIFT.
