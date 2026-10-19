"""
FUMOCA Quick Splat — Kaggle lean path
=====================================
Upload video → extract frames → light Gaussian train (or dense RGB fallback)
→ upload .ply to R2 → mark reconstruction_jobs complete.

No full NIF, rembg, SAM, or mesh on this path.
Studio cleans the PLY; Create NIF happens later on the client.

Activate:
  export FUMOCA_QUICK_SPLAT=1
  # and/or job.capture_mode in ("splat_only", "quick_splat")

  import fumoca_quick_splat
  fumoca_quick_splat.install_quick_splat_route()
  import fumoca_nif_worker
  fumoca_nif_worker.main()

Env knobs:
  FUMOCA_MAX_RECON_FRAMES   default 36
  FUMOCA_GS_ITERS           default 200
  FUMOCA_QUICK_MAX_SIDE     default 640
  FUMOCA_QUICK_BUCKET       default nif-files
"""

from __future__ import annotations

import io
import math
import os
import shutil
import struct
import subprocess
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, List, Optional, Tuple

# ── limits ──────────────────────────────────────────────────────────
MAX_FRAMES = int(os.getenv("FUMOCA_MAX_RECON_FRAMES", "36"))
GS_ITERS = int(os.getenv("FUMOCA_GS_ITERS", "200"))
MAX_SIDE = int(os.getenv("FUMOCA_QUICK_MAX_SIDE", "640"))
OUTPUT_BUCKET = os.getenv("FUMOCA_QUICK_BUCKET", "nif-files")
RAW_BUCKET = os.getenv("FUMOCA_RAW_BUCKET", "nif-videos")
QUICK_ON = os.getenv("FUMOCA_QUICK_SPLAT", "0").strip() in ("1", "true", "True", "yes")


def log(msg: str) -> None:
    print(f"[QUICK] {msg}", flush=True)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _is_quick_job(capture_mode: str) -> bool:
    mode = (capture_mode or "").lower().strip()
    if mode in ("splat_only", "quick_splat", "ply_only"):
        return True
    return QUICK_ON


# ── R2 via boto3 ────────────────────────────────────────────────────
def _r2_client():
    import boto3
    from botocore.config import Config

    account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("ACCOUNT_ID")
    key = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not all([account, key, secret]):
        raise RuntimeError("R2 secrets missing (CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)")
    endpoint = f"https://{account}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _download_r2(key: str, dest: Path, bucket: str = RAW_BUCKET) -> Path:
    client = _r2_client()
    dest.parent.mkdir(parents=True, exist_ok=True)
    log(f"download s3://{bucket}/{key} → {dest}")
    client.download_file(bucket, key, str(dest))
    if not dest.exists() or dest.stat().st_size < 1000:
        raise RuntimeError(f"Download failed or empty: {key}")
    return dest


def _upload_r2(path: Path, key: str, bucket: str = OUTPUT_BUCKET, content_type: str = "application/octet-stream") -> str:
    client = _r2_client()
    log(f"upload {path.name} → s3://{bucket}/{key}")
    extra = {"ContentType": content_type}
    client.upload_file(str(path), bucket, key, ExtraArgs=extra)
    account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("ACCOUNT_ID")
    # Prefer public-style URL if a custom domain is set; otherwise R2 key path.
    public = os.getenv("FUMOCA_R2_PUBLIC_BASE", "").rstrip("/")
    if public:
        return f"{public}/{key}"
    return f"r2://{bucket}/{key}"


# ── frames ──────────────────────────────────────────────────────────
def _ffmpeg() -> str:
    return shutil.which("ffmpeg") or "ffmpeg"


def _extract_frames(video: Path, out_dir: Path) -> List[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    # Cap resolution and count for speed
    vf = f"fps=6,scale='min({MAX_SIDE},iw)':-2"
    pattern = str(out_dir / "%05d.jpg")
    cmd = [_ffmpeg(), "-y", "-i", str(video), "-vf", vf, "-q:v", "3", pattern]
    log(f"ffmpeg extract max_side={MAX_SIDE}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    frames = sorted(out_dir.glob("*.jpg"))
    if len(frames) < 4:
        raise RuntimeError(
            f"Too few frames ({len(frames)}). Need a longer orbit video. ffmpeg: {r.stderr[-400:]}"
        )
    if len(frames) > MAX_FRAMES:
        # Keep evenly spaced
        step = len(frames) / MAX_FRAMES
        keep = [frames[int(i * step)] for i in range(MAX_FRAMES)]
        for f in frames:
            if f not in keep:
                f.unlink(missing_ok=True)
        frames = keep
    log(f"using {len(frames)} frames")
    return frames


def _thumbnail(video: Path, dest: Path) -> Optional[Path]:
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [_ffmpeg(), "-y", "-ss", "1", "-i", str(video), "-vframes", "1", "-q:v", "4", str(dest)],
            capture_output=True,
            check=False,
        )
        return dest if dest.exists() else None
    except Exception:
        return None


# ── synthetic orbit poses (no COLMAP) ───────────────────────────────
def _synthetic_poses(n: int, radius: float = 2.5) -> List[Tuple[float, float, float]]:
    """Camera positions on a horizontal ring looking at origin."""
    poses = []
    for i in range(n):
        ang = 2 * math.pi * i / n
        x = radius * math.sin(ang)
        z = radius * math.cos(ang)
        y = 0.35
        poses.append((x, y, z))
    return poses


# ── PLY writers ─────────────────────────────────────────────────────
def _write_ascii_xyzrgb_ply(path: Path, points: List[Tuple[float, float, float, int, int, int]]) -> None:
    with path.open("w", encoding="ascii") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        f.write("end_header\n")
        for x, y, z, r, g, b in points:
            f.write(f"{x:.6f} {y:.6f} {z:.6f} {r} {g} {b}\n")


def _build_point_cloud_from_frames(frames: List[Path], poses: List[Tuple[float, float, float]]) -> Path:
    """
    Dense-ish coloured point cloud from frame RGB + synthetic depth plane.
    Opens in Studio as a point cloud for cleaning; not a trained Gaussian
    but valid PLY. Prefer train path when torch/gsplat are available.
    """
    from PIL import Image
    import numpy as np

    points: List[Tuple[float, float, float, int, int, int]] = []
    stride = 4  # pixel stride for speed
    for frame_path, (cx, cy, cz) in zip(frames, poses):
        img = Image.open(frame_path).convert("RGB")
        w, h = img.size
        arr = np.asarray(img)
        # Simple pinhole: map pixels to a fronto-parallel plane in front of camera
        fx = fy = 0.9 * max(w, h)
        for v in range(0, h, stride):
            for u in range(0, w, stride):
                r, g, b = arr[v, u]
                # skip near-black / near-white extremes a bit
                if int(r) + int(g) + int(b) < 30:
                    continue
                x_n = (u - w * 0.5) / fx
                y_n = -(v - h * 0.5) / fy
                depth = 1.6
                # camera looks toward origin — approximate world pos
                # camera at (cx,cy,cz), forward ≈ -position
                forward = np.array([-cx, -cy, -cz], dtype=np.float64)
                nrm = np.linalg.norm(forward) + 1e-8
                forward /= nrm
                # rough right/up
                up = np.array([0.0, 1.0, 0.0])
                right = np.cross(forward, up)
                rn = np.linalg.norm(right) + 1e-8
                right /= rn
                upv = np.cross(right, forward)
                cam = np.array([cx, cy, cz])
                world = cam + forward * depth + right * x_n * depth + upv * y_n * depth
                points.append((float(world[0]), float(world[1]), float(world[2]), int(r), int(g), int(b)))

    if len(points) < 500:
        raise RuntimeError(f"Point cloud too sparse ({len(points)} pts)")
    # Cap size
    if len(points) > 400_000:
        step = len(points) // 400_000
        points = points[::step]
    out = frames[0].parent.parent / "quick_point_cloud.ply"
    _write_ascii_xyzrgb_ply(out, points)
    log(f"PLY fallback points={len(points)} → {out}")
    return out


def _try_train_gsplat(frames: List[Path], work: Path) -> Optional[Path]:
    """Best-effort short train. Returns PLY path or None."""
    try:
        import torch
    except ImportError:
        log("torch not available — skip train")
        return None

    if not torch.cuda.is_available():
        log("CUDA not available — skip heavy train, use RGB lift")
        return None

    # Prefer official graphdeco repo if present
    gs_dir = Path(os.getenv("GS_REPO_DIR", "/kaggle/working/gaussian-splatting"))
    if not (gs_dir / "train.py").exists():
        log("gaussian-splatting train.py not found — RGB lift path")
        return None

    # Building a full COLMAP scene is expensive; quick path skips it.
    log(f"GS repo present but Quick Splat uses synthetic RGB lift (iters budget={GS_ITERS})")
    return None


# ── core job ────────────────────────────────────────────────────────
def run_quick_splat(job_id: str, user_id: str, raw_r2_key: str, meta: Optional[dict] = None) -> dict:
    meta = dict(meta or {})
    work = Path(tempfile.mkdtemp(prefix=f"quick_{job_id[:8]}_"))
    log(f"mode=ON (PLY only — no full NIF) job={job_id[:8]}")
    log(f"work={work}")

    try:
        _patch_job(job_id, {"status": "processing", "progress": 5, "error_message": None})

        video = work / "input.mp4"
        # raw key may be full path inside bucket
        _download_r2(raw_r2_key, video)
        _patch_job(job_id, {"progress": 15})

        frames_dir = work / "frames"
        frames = _extract_frames(video, frames_dir)
        log(f"pose_source=synthetic_no_colmap")  # fine for now
        poses = _synthetic_poses(len(frames))
        _patch_job(job_id, {"progress": 30})

        ply = _try_train_gsplat(frames, work)
        if ply is None:
            ply = _build_point_cloud_from_frames(frames, poses)
        _patch_job(job_id, {"progress": 75})

        thumb = work / "thumb.jpg"
        _thumbnail(video, thumb)

        ply_key = f"{user_id}/{job_id}/point_cloud.ply"
        ply_url = _upload_r2(ply, ply_key, bucket=OUTPUT_BUCKET)
        thumb_url = None
        if thumb.exists():
            try:
                thumb_url = _upload_r2(thumb, f"{user_id}/{job_id}/thumb.jpg", content_type="image/jpeg")
            except Exception as e:
                log(f"thumb upload skip: {e}")

        result_meta = {
            **meta,
            "quick_splat": True,
            "ply_r2_key": ply_key,
            "ply_url": ply_url,
            "thumbnail_url": thumb_url,
            "frame_count": len(frames),
            "pose_source": "synthetic_no_colmap",
            "gs_iters_budget": GS_ITERS,
            "max_side": MAX_SIDE,
            "pipeline": "fumoca_quick_splat",
            "completed_at": _now(),
        }

        _patch_job(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "nif_r2_key": ply_key,  # Studio can resolve PLY from this until NIF exists
                "file_size": ply.stat().st_size,
                "gaussian_count": None,
                "meta": result_meta,
                "completed_at": _now(),
                "error_message": None,
            },
        )
        log(f"PLY {ply.stat().st_size / 1e6:.2f} MB key={ply_key}")
        log("DONE")
        return result_meta
    except Exception as e:
        log(f"FAILED: {e}")
        traceback.print_exc()
        try:
            _patch_job(
                job_id,
                {
                    "status": "failed",
                    "error_message": f"Quick Splat: {str(e)[:1800]}",
                    "progress": 0,
                },
            )
        except Exception:
            pass
        raise
    finally:
        try:
            shutil.rmtree(work, ignore_errors=True)
        except Exception:
            pass


def _patch_job(job_id: str, payload: dict) -> None:
    try:
        from supabase import create_client

        url = os.environ["SUPABASE_URL"]
        key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        sb = create_client(url, key)
        sb.table("reconstruction_jobs").update(payload).eq("id", job_id).execute()
    except Exception as e:
        log(f"job patch warn: {e}")


# ── install into nif worker ─────────────────────────────────────────
_INSTALLED = False


def install_quick_splat_route() -> None:
    """
    Patch ReconstructionWorker so splat_only / FUMOCA_QUICK_SPLAT jobs
    take the lean PLY path instead of full NIF.
    """
    global _INSTALLED
    if _INSTALLED:
        log("route already installed")
        return

    log(f"mode={'ON' if QUICK_ON else 'OFF (use capture_mode=splat_only)'} (PLY only — no full NIF)")
    log(f"limits frames≤{MAX_FRAMES} side≤{MAX_SIDE} iters_budget={GS_ITERS}")

    try:
        import sys
        root = Path(__file__).resolve().parents[1]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from engine_next_path import ensure  # type: ignore
    except Exception:
        pass

    # Patch at nif_worker loop level is more reliable than deep pipeline import.
    import fumoca_nif_worker as nw

    original_main = nw.main

    def main_quick():
        log("nif_worker.main wrapped by Quick Splat")
        # Replicate poll loop with branch — call original code paths by importing pipeline
        import traceback as tb
        import time as _time

        # Ensure GPU message still applies for optional train
        SB = nw.SB
        POLL_SECONDS = getattr(nw, "POLL_SECONDS", 8)
        pipeline = nw.pipeline

        while True:
            try:
                claimed = SB.rpc("claim_next_reconstruction_job", {}).execute()
                rows = claimed.data or []
            except Exception as e:
                log(f"claim failed: {e}")
                _time.sleep(POLL_SECONDS)
                continue

            if not rows:
                _time.sleep(POLL_SECONDS)
                continue

            job = rows[0]
            job_id = job["id"]
            user_id = job["user_id"]
            raw_r2_key = job.get("raw_r2_key")
            vertical = job.get("vertical") or "generic"
            capture_mode = job.get("capture_mode") or "video"
            meta = job.get("meta") or {}

            log(
                f"Claimed {job_id[:8]} mode={capture_mode} quick={_is_quick_job(capture_mode)} key={raw_r2_key}"
            )

            if not raw_r2_key:
                SB.table("reconstruction_jobs").update(
                    {"status": "failed", "error_message": "Job has no raw_r2_key"}
                ).eq("id", job_id).execute()
                continue

            try:
                if _is_quick_job(capture_mode):
                    run_quick_splat(job_id, user_id, raw_r2_key, meta)
                else:
                    worker = pipeline.ReconstructionWorker(job_id, user_id)
                    if capture_mode == "mesh_only":
                        worker.run_mesh_only(raw_r2_key, meta)
                    else:
                        worker.run(raw_r2_key, vertical, capture_mode, meta)
                    log(f"{job_id[:8]}: complete (full pipeline)")
            except Exception as e:
                log(f"{job_id[:8]}: FAILED — {e}")
                tb.print_exc()
                try:
                    SB.table("reconstruction_jobs").update(
                        {"status": "failed", "error_message": str(e)[:2000]}
                    ).eq("id", job_id).execute()
                except Exception:
                    pass

            _time.sleep(2)

    nw.main = main_quick
    _INSTALLED = True
    log("install_quick_splat_route OK — splat_only jobs will produce PLY only")


def process_job_id(job_id: str) -> dict:
    """One-shot: load job from Supabase and run Quick Splat (no poll loop)."""
    from supabase import create_client

    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    sb = create_client(url, key)
    res = sb.table("reconstruction_jobs").select("*").eq("id", job_id).single().execute()
    job = res.data
    if not job:
        raise RuntimeError(f"Job not found: {job_id}")
    return run_quick_splat(job["id"], job["user_id"], job["raw_r2_key"], job.get("meta") or {})


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        jid = sys.argv[1]
        print(process_job_id(jid))
    else:
        print("Usage: python fumoca_quick_splat.py <job_id>")
        print("Or: install_quick_splat_route() then fumoca_nif_worker.main()")
