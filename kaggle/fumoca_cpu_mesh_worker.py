"""
FUMOCA CPU mesh-only worker.

Processes only existing-geometry jobs (capture_mode='mesh_only'). It does not
train Gaussians, estimate depth, run COLMAP, or initialize neural models.
Run this in a Kaggle notebook with Accelerator=None, or any ordinary CPU host.

Required environment:
  SUPABASE_URL
  SUPABASE_SECRET_KEY
  CF_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY

Install:
  pip install -r engine-next/reconstruction/requirements-mesh-only.txt

Then:
  python kaggle/fumoca_cpu_mesh_worker.py
"""
import os
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine-next" / "reconstruction"))

POLL_SECONDS = max(3, int(os.environ.get("POLL_SECONDS", "12")))


def log(message: str) -> None:
    print(f"[CPU-MESH-WORKER] {message}", flush=True)


def main() -> None:
    required = (
        "SUPABASE_URL", "SUPABASE_SECRET_KEY", "CF_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    )
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError("Missing required secrets: " + ", ".join(missing))

    try:
        import pipeline
    except Exception as exc:
        raise RuntimeError(
            "Could not import the mesh-only pipeline. Install "
            "engine-next/reconstruction/requirements-mesh-only.txt and check secrets."
        ) from exc

    if pipeline.torch is not None:
        log("PyTorch is installed, but this worker will not use it.")
    if pipeline.gsplat is not None:
        log("gsplat is installed, but this worker will not use it.")
    log(
        f"Ready in CPU mode. RAW_BUCKET={pipeline.RAW_BUCKET} "
        f"OUTPUT_BUCKET={pipeline.OUTPUT_BUCKET}; polling mesh_only jobs."
    )

    while True:
        try:
            claimed = pipeline.SB.rpc("claim_next_mesh_only_job", {}).execute()
            rows = claimed.data or []
        except Exception as exc:
            log(f"claim_next_mesh_only_job failed: {exc}")
            time.sleep(POLL_SECONDS)
            continue

        if not rows:
            time.sleep(POLL_SECONDS)
            continue

        job = rows[0]
        job_id = job["id"]
        user_id = job["user_id"]
        raw_key = job.get("raw_r2_key")
        meta = job.get("meta") or {}
        log(f"Claimed {job_id[:8]} ({meta.get('point_count', '?')} Gaussian rows)")

        if not raw_key:
            message = "Mesh-only job has no raw_r2_key."
            pipeline.SB.table("reconstruction_jobs").update({
                "status": "failed", "error_message": message,
            }).eq("id", job_id).execute()
            log(f"{job_id[:8]} failed: {message}")
            continue

        try:
            worker = pipeline.ReconstructionWorker(
                job_id, user_id, initialize_deblur=False
            )
            worker.run_mesh_only(raw_key, meta)
            log(f"{job_id[:8]} completed")
        except Exception as exc:
            log(f"{job_id[:8]} failed: {exc}")
            traceback.print_exc()
            try:
                pipeline.SB.table("reconstruction_jobs").update({
                    "status": "failed", "error_message": str(exc)[:2000],
                }).eq("id", job_id).execute()
            except Exception as patch_exc:
                log(f"Could not persist failure state: {patch_exc}")

        time.sleep(2)


if __name__ == "__main__":
    main()
