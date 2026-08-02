# FUMOCA Kaggle worker setup

## Use `fumoca_nif_worker.py` — this is the real NIF pipeline

As of this pass, `kaggle/fumoca_nif_worker.py` + `engine-next/reconstruction/pipeline.py`
is the worker that matches what NIF is actually supposed to be: it trains Gaussians only
as an intermediate step, then extracts a real watertight triangulated **mesh** (marching
cubes over a signed-distance volume built from the trained Gaussians) plus depth maps,
alpha masks, layered geometry, and semantic labels, and packs all of it into one chunked
`.nif` binary. The old worker below produces a raw Gaussian point cloud — not a NIF in
the sense the format is meant to have.

### What it does
- Polls `reconstruction_jobs` (the real, live queue table — confirmed directly against
  the fumoca-production Supabase project) via the `claim_next_reconstruction_job()` RPC
- Downloads the raw capture from the `nif-videos` R2 bucket
- Runs: deblur → depth estimation → background removal → SAM2 segmentation → COLMAP
  pose estimation → Gaussian training → **real mesh extraction** → layer splitting →
  proxy video encode → pack `.nif`
- Uploads outputs to the `nif-files` R2 bucket
- Writes progress directly to `reconstruction_jobs`, and on success registers the result
  in `nif_files`

### Setup
1. Create a Kaggle notebook. **Notebook Settings → Accelerator → GPU** (T4 x2 or P100 —
   Gaussian training is impractical on CPU).
2. Add secrets (Add-ons → Secrets):
   - `SUPABASE_URL` — `https://cicaxmthjdinbqvqmwxe.supabase.co`
   - `SUPABASE_SECRET_KEY` — your **service_role** key (Supabase dashboard → Settings →
     API — NOT the anon key)
   - `CF_ACCOUNT_ID` — your Cloudflare account ID (same one in `wrangler.jsonc`)
   - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — create an R2 API token in the
     Cloudflare dashboard (R2 → Manage API Tokens) with read/write on `nif-videos` and
     `nif-files`
3. Copy `kaggle/kaggle_nif_bootstrap.py`, `kaggle/fumoca_nif_worker.py`, and
   `engine-next/reconstruction/pipeline.py` (keep pipeline.py at
   `engine-next/reconstruction/pipeline.py` relative to the worker, or edit the
   `sys.path.insert` line at the top of `fumoca_nif_worker.py`) into the notebook.
4. Run:
   ```
   python kaggle_nif_bootstrap.py
   python fumoca_nif_worker.py
   ```
5. Upload a video through FUMOCA. Watch the notebook logs — `[NIF-WORKER]` lines show
   claim/progress/completion; `[NIF]` lines are from inside `pipeline.py` itself.

### Optional environment variables
- `POLL_SECONDS=15` — how often to check for a new queued job
- `R2_RAW_BUCKET=nif-videos` / `R2_OUTPUT_BUCKET=nif-files` — override if your bucket
  names differ from production's
- `FUMOCA_MAX_RECON_FRAMES=40` — caps frames fed into COLMAP (even-strided across the
  capture, not truncated, so full orbit coverage is kept). This is the single biggest
  lever on processing time — COLMAP's feature matching scales badly with frame count.
  Raise it later for quality once the pipeline is proven end-to-end; 40 is tuned for
  fast first-test turnaround, not final quality.
- `FUMOCA_N_GAUSSIANS=20000` — starting Gaussian count (was a fixed 50,000). Lower =
  faster training, less fine detail.
- `FUMOCA_GS_ITERS=1200` — Gaussian training steps (was a fixed 3,000). Lower = faster,
  less converged/noisier result.

These three defaults together should meaningfully cut turnaround time for early
testing at a real, visible quality cost — that trade is intentional right now (get
something working end-to-end fast, dial quality back up once the pipeline itself is
proven). To go back toward original quality once you're past initial testing:
```
FUMOCA_MAX_RECON_FRAMES=120
FUMOCA_N_GAUSSIANS=50000
FUMOCA_GS_ITERS=3000
```

### Known gaps (real, not yet fixed)
- COLMAP pose estimation falls back to synthetic (non-multiview) poses if it fails,
  degrading reconstruction quality without hard-failing the job — worth watching
  `reconstruction_quality` in a completed job's `meta` to see how often this triggers
- SAM2 segmentation is optional — `pipeline.py` falls back to single-segment mode if the
  import fails, which affects only the semantic/interactive-layer chunk, not the mesh

---

## Legacy: `fumoca_kaggle_worker.py` — old Gaussian-splat worker

Still present in `kaggle/` but **no longer the one to run** for new work. It polls
`processing_jobs`/`splats` (a separate, older queue table also live in production) and
produces a raw `.ply` (optionally wrapped via `fumoc_encoder`), not a real `.nif`. Kept
only for reference/rollback — don't point new capture uploads at this path.

- `kaggle/kaggle_bootstrap.py` (old bootstrap — clones graphdeco-inria/gaussian-splatting)
- `kaggle/fumoca_kaggle_worker.py`
