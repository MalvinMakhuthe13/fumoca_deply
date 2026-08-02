"""
FUMOCA NIF Worker — Kaggle polling wrapper for engine-next/reconstruction/pipeline.py
fumoca.co.za

WHAT THIS REPLACES
-------------------
`fumoca_kaggle_worker.py` (the old worker) polls `processing_jobs` / `splats`
and produces a raw Gaussian `.ply` (optionally boxed into a `.fumoc` via
`fumoc_encoder`). That is the legacy pipeline — a splat renamed, not a NIF.

This worker instead drives `engine-next/reconstruction/pipeline.py`'s
`ReconstructionWorker`, which:
  - trains Gaussians only as an intermediate step
  - extracts a REAL watertight triangulated mesh from them (marching cubes
    over a signed-distance volume built from the trained Gaussians)
  - packs depth, alpha, layered geo, semantic labels, mesh, and proxy video
    into one chunked `.nif` binary

WHY A SEPARATE POLLING WRAPPER, NOT JUST `python pipeline.py`
----------------------------------------------------------------
`pipeline.py` is written to process exactly ONE job per invocation (it takes
job_id/user_id/raw_r2_key as CLI args) — it expects something else to claim
jobs and invoke it per job. In the full architecture that's meant to be
`engine-next/backend-api`, but per ROADMAP.md that API is still "untested...
not yet wired" and isn't deployed. Kaggle notebooks can't be invoked
externally per-job anyway — they need to poll on their own, the same way the
old worker did. So this script owns the poll/claim loop and calls
`ReconstructionWorker` directly, in-process, per job.

VERIFIED AGAINST THE LIVE fumoca-production SUPABASE PROJECT (2026-08-01):
  - `reconstruction_jobs` and `nif_files` tables exist and are the real,
    live tables (columns: id, user_id, status, progress, vertical,
    capture_mode, raw_r2_key, nif_r2_key, file_size, gaussian_count,
    error_message, meta, created_at, started_at, completed_at)
  - `claim_next_reconstruction_job()` RPC exists and atomically claims the
    oldest queued row (`FOR UPDATE SKIP LOCKED`, sets status='processing')
  - Raw captures are uploaded by js/modules/upload-page.js to the
    `nif-videos` R2 bucket; this pipeline's outputs belong in `nif-files`
    (see pipeline.py's RAW_BUCKET / OUTPUT_BUCKET — fixed in this pass,
    they previously assumed one nonexistent 'fumoca-nif-storage' bucket)

REQUIRED SECRETS (Kaggle notebook → Add-ons → Secrets)
--------------------------------------------------------
  SUPABASE_URL            = https://cicaxmthjdinbqvqmwxe.supabase.co
  SUPABASE_SECRET_KEY     = <service_role key, NOT anon key>
  CF_ACCOUNT_ID            = <Cloudflare account ID, from wrangler.jsonc>
  R2_ACCESS_KEY_ID          = <R2 API token access key — create in Cloudflare
                                dashboard: R2 → Manage API Tokens>
  R2_SECRET_ACCESS_KEY      = <R2 API token secret>

These are the SAME five vars pipeline.py itself requires (REQUIRED list at
the top of that file) — this worker imports pipeline.py directly, so if
pipeline.py's own env check passes, this worker has what it needs too.

USAGE
-----
  python kaggle_bootstrap.py        # installs deps (see that file)
  python fumoca_nif_worker.py       # starts polling

Runs forever, polling every POLL_SECONDS (default 15). Ctrl+C or let the
Kaggle session time out to stop.
"""

import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")  # Kaggle has no X display; COLMAP needs this
import sys
import time
import traceback

# pipeline.py lives next to this file
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine-next', 'reconstruction'))

POLL_SECONDS = int(os.environ.get('POLL_SECONDS', '15'))


def log(msg: str):
    print(f'[NIF-WORKER] {msg}', flush=True)


def main():
    # Import here (not at module top) so a missing env var / dependency gives
    # a clear error message instead of an import-time traceback.
    try:
        import pipeline
    except Exception as e:
        log(f'FATAL: could not import pipeline.py — {e}')
        log('Make sure engine-next/reconstruction/pipeline.py and its requirements.txt '
            'deps are installed (see kaggle_bootstrap.py), and that all required env '
            'vars/secrets are set: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, '
            'SUPABASE_URL, SUPABASE_SECRET_KEY.')
        raise

    SB = pipeline.SB
    log(f'Ready. RAW_BUCKET={pipeline.RAW_BUCKET} OUTPUT_BUCKET={pipeline.OUTPUT_BUCKET} '
        f'DEVICE={pipeline.DEVICE}')

    if pipeline.DEVICE == 'cpu':
        log('WARNING: no CUDA GPU detected. Gaussian training will be extremely slow '
            'or impractical on CPU. On Kaggle, enable a GPU: Notebook Settings → '
            'Accelerator → GPU T4 x2 (or P100).')

    while True:
        try:
            claimed = SB.rpc('claim_next_reconstruction_job', {}).execute()
            rows = claimed.data or []
        except Exception as e:
            log(f'claim_next_reconstruction_job failed: {e}')
            time.sleep(POLL_SECONDS)
            continue

        if not rows:
            time.sleep(POLL_SECONDS)
            continue

        job = rows[0]
        job_id       = job['id']
        user_id      = job['user_id']
        raw_r2_key   = job.get('raw_r2_key')
        vertical     = job.get('vertical') or 'generic'
        capture_mode = job.get('capture_mode') or 'video'
        meta         = job.get('meta') or {}

        log(f'Claimed job {job_id[:8]} user={user_id[:8]} vertical={vertical} '
            f'capture_mode={capture_mode} raw_r2_key={raw_r2_key}')

        if not raw_r2_key:
            err = 'Job has no raw_r2_key — nothing to download.'
            log(f'{job_id[:8]}: {err}')
            SB.table('reconstruction_jobs').update({
                'status': 'failed', 'error_message': err,
            }).eq('id', job_id).execute()
            continue

        try:
            worker = pipeline.ReconstructionWorker(job_id, user_id)
            if capture_mode == 'mesh_only':
                worker.run_mesh_only(raw_r2_key, meta)
            else:
                worker.run(raw_r2_key, vertical, capture_mode, meta)
            log(f'{job_id[:8]}: complete')
        except Exception as e:
            log(f'{job_id[:8]}: FAILED — {e}')
            traceback.print_exc()
            # pipeline.py's own except-blocks already write status='failed' +
            # error_message for both run() and run_mesh_only() — this is a
            # safety net in case the failure happened before that point
            # (e.g. R2/Supabase client construction inside ReconstructionWorker.__init__).
            try:
                SB.table('reconstruction_jobs').update({
                    'status': 'failed', 'error_message': str(e)[:2000],
                }).eq('id', job_id).execute()
            except Exception:
                pass

        time.sleep(2)  # brief pause before polling for the next job


if __name__ == '__main__':
    main()
