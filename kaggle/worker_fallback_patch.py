"""
FUMOCA Worker Fallback Hardening Patch
═══════════════════════════════════════════════════════════════════════════
Replaces the 8-vertex cube fallback with a graceful failure path that does
NOT upload a broken placeholder asset. The original create_fallback() wrote
a literal hard-coded cube to point_cloud.ply whenever reconstruction failed,
and the worker then uploaded that cube as if it were the client's splat.

The fix:
  1. Change the default of ENABLE_FALLBACK_ON_FAILURE from "1" to "0" so
     failures fail loudly instead of silently producing garbage.
  2. When fallback IS explicitly enabled, produce a diagnostic marker PLY
     that has enough points to at least suggest 3D structure, AND mark the
     splat record with status="failed_reconstruction" so the viewer can
     show a "still processing — try again" state instead of loading it.
  3. Never upload a fallback PLY to the main splat_url column. Store it at
     a separate path so the viewer knows it is a diagnostic, not a result.

HOW TO APPLY
─────────────
Option A (recommended) — import the patched functions at the top of
  fumoca_kaggle_worker.py, after the other imports:

      from worker_fallback_patch import (
          ENABLE_FALLBACK_ON_FAILURE as _EFOF_OVERRIDE,
          create_fallback_safe,
          mark_reconstruction_failed,
      )
      # Override the module-level constant defined further down:
      ENABLE_FALLBACK_ON_FAILURE = _EFOF_OVERRIDE
      # Replace the function reference:
      create_fallback = create_fallback_safe

  Then in process_job(), replace the `mark_done(...)` call inside the
  fallback branch with `mark_reconstruction_failed(...)`.

Option B — apply the changes inline by copying the three functions below
  into fumoca_kaggle_worker.py, overwriting the existing create_fallback
  and updating the failure-handling block in process_job.

See INTEGRATION_DIFF.md in this bundle for the exact diff to apply.
═══════════════════════════════════════════════════════════════════════════
"""

import os
import math
from pathlib import Path
from typing import Optional

# Hardened default: failures fail loudly. Operators who explicitly want the
# old behaviour can still set ENABLE_FALLBACK_ON_FAILURE=1, but it no longer
# causes a cube to be shown to clients — see create_fallback_safe below.
ENABLE_FALLBACK_ON_FAILURE = os.getenv("ENABLE_FALLBACK_ON_FAILURE", "0") == "1"


def create_fallback_safe(job_dir: Path, video_path: Path):
    """
    Emergency fallback producer. Called ONLY when reconstruction has failed
    AND the operator has explicitly opted in by setting
    ENABLE_FALLBACK_ON_FAILURE=1.

    The original implementation wrote a hard-coded 8-vertex cube which
    looked like broken output to anyone who opened the viewer. This version
    produces a sphere of ~2000 points, which at least reads as "something
    3D is happening here" — but more importantly, the caller is expected
    to NOT upload the result to the main splat_url and to mark the splat
    record as failed. This file is only for internal diagnostic inspection.
    """
    out_dir = job_dir / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    ply = out_dir / "point_cloud_diagnostic.ply"

    # Build a Fibonacci-lattice sphere — even coverage, no clustering.
    # 2000 points is enough to read as a shape at any zoom without being heavy.
    n = 2000
    lines = [
        "ply",
        "format ascii 1.0",
        "comment FUMOCA diagnostic placeholder — reconstruction failed",
        f"element vertex {n}",
        "property float x",
        "property float y",
        "property float z",
        "property uchar red",
        "property uchar green",
        "property uchar blue",
        "end_header",
    ]
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        y = 1 - (i / (n - 1)) * 2  # y from 1 to -1
        radius = math.sqrt(max(0.0, 1 - y * y))
        theta = golden * i
        x = math.cos(theta) * radius
        z = math.sin(theta) * radius
        # Gradient colour — cyan at top to magenta at bottom. Signals "diagnostic"
        # without being visually offensive.
        t = (y + 1) / 2
        r = int(255 * (1 - t) * 0.9)
        g = int(255 * t * 0.5 + 50)
        b = int(255 * (0.4 + t * 0.6))
        lines.append(f"{x:.5f} {y:.5f} {z:.5f} {r} {g} {b}")
    ply.write_text("\n".join(lines) + "\n")

    thumb = out_dir / "thumb_diagnostic.jpg"
    # The caller's extract_thumbnail is still the right tool for the source
    # video. We do not reimplement it here.
    return ply, thumb


def mark_reconstruction_failed(
    supabase,
    job_id: str,
    splat_id: str,
    error_message: str,
    diagnostic_url: Optional[str] = None,
):
    """
    Record a reconstruction failure on both processing_jobs and splats.

    Importantly, this does NOT populate splats.splat_url or splats.file_url
    — the viewer checks those columns to decide whether to load a 3D asset,
    so leaving them null keeps the viewer in its "still processing" state
    instead of loading a broken fallback and presenting it as the client's
    splat.

    The diagnostic PLY URL, if one was uploaded, goes into metadata for the
    operator to inspect but is never surfaced to the end user.
    """
    from datetime import datetime, timezone
    stamp = datetime.now(timezone.utc).isoformat()
    trimmed = str(error_message)[:5000]

    supabase.table("processing_jobs").update({
        "status": "failed",
        "stage": "reconstruction_failed",
        "completed_at": stamp,
        "updated_at": stamp,
        "error_message": trimmed,
    }).eq("id", job_id).execute()

    # Fetch current metadata to merge rather than overwrite
    current = supabase.table("splats").select("metadata").eq("id", splat_id).maybeSingle().execute()
    existing_meta = {}
    if current and getattr(current, "data", None):
        existing_meta = dict(current.data.get("metadata") or {})
    if diagnostic_url:
        existing_meta.setdefault("diagnostics", {})["fallback_ply_url"] = diagnostic_url
    existing_meta["last_failure"] = {"at": stamp, "reason": trimmed[:500]}

    supabase.table("splats").update({
        "status": "failed_reconstruction",
        "processing_stage": "failed",
        "processing_completed_at": stamp,
        "processing_error": trimmed,
        "metadata": existing_meta,
        "updated_at": stamp,
        # Deliberately NOT setting splat_url, file_url, output_url.
        # The viewer falls back to its "still processing" shell when these
        # are null, which is the correct UX for a failed reconstruction.
    }).eq("id", splat_id).execute()
