import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

import requests
from supabase import Client, create_client
try:
    from fumoc_encoder import encode_ply_to_fumoc
    FUMOC_ENCODER_AVAILABLE = True
except ImportError:
    FUMOC_ENCODER_AVAILABLE = False
    print("[FUMOCA] fumoc_encoder not available — will upload .ply only")

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://sjxkgdaaknflnviwjbej.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
VIDEO_BUCKET = os.getenv("VIDEO_BUCKET", "splat-videos")
SPLAT_BUCKET = os.getenv("SPLAT_BUCKET", "splat-files")
THUMB_BUCKET = os.getenv("THUMB_BUCKET", "thumbnails")
PREVIEW_BUCKET = os.getenv("PREVIEW_BUCKET", "preview-videos")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "10"))
FRAME_FPS = int(os.getenv("FRAME_FPS", "3"))  # v60: was 2
MAX_FRAMES = int(os.getenv("MAX_FRAMES", "180"))  # v60: was 120
TRAIN_ITERS = int(os.getenv("TRAIN_ITERS", "8000"))  # v60: was 3000
MAX_PLY_MB   = int(os.getenv("MAX_PLY_MB", "400"))  # TUS handles large files; only compress truly massive ones
USE_REAL_ENGINE = os.getenv("USE_REAL_ENGINE", "1") == "1"
ENABLE_FALLBACK_ON_FAILURE = os.getenv("ENABLE_FALLBACK_ON_FAILURE", "0") == "1"  # v78 — default flipped; see worker_fallback_patch.py
USE_COLMAP_GPU = os.getenv("USE_COLMAP_GPU", "auto").lower()
ENCODE_FUMOC      = os.getenv("ENCODE_FUMOC", "1") in {"1","true","yes"}
FUMOC_MESH_TRIS   = int(os.getenv("FUMOC_MESH_TRIS", "8192"))
FUMOC_BUCKET      = os.getenv("FUMOC_BUCKET", "splat-files")
COLMAP_THREADS = int(os.getenv("COLMAP_THREADS", "2"))
GS_REPO_DIR = Path(os.getenv("GS_REPO_DIR", "/kaggle/working/gaussian-splatting"))
GS_DATA_ROOT = Path(os.getenv("GS_DATA_ROOT", "/kaggle/working/fumoca_jobs"))
COLMAP_BIN = os.getenv("COLMAP_BIN", "colmap")
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")

if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(msg: str):
    print(f"[FUMOCA] {msg}", flush=True)


def sh(cmd, cwd: Optional[Path] = None, check: bool = True, env: Optional[dict] = None):
    rendered = " ".join(str(x) for x in cmd)
    log(f"RUN: {rendered}")
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    proc = subprocess.run(
        [str(x) for x in cmd],
        cwd=str(cwd) if cwd else None,
        check=False,
        env=merged_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if proc.stdout:
        print(proc.stdout[-12000:], flush=True)
    if check and proc.returncode != 0:
        tail = (proc.stdout or "")[-4000:]
        raise RuntimeError(f"Command failed ({proc.returncode}): {rendered}\n{tail}")
    return proc


def has_nvidia() -> bool:
    try:
        proc = subprocess.run(["nvidia-smi", "-L"], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return proc.returncode == 0 and bool((proc.stdout or "").strip())
    except Exception:
        return False


def wants_colmap_gpu() -> bool:
    if USE_COLMAP_GPU in {"1", "true", "yes", "on"}:
        return True
    if USE_COLMAP_GPU in {"0", "false", "no", "off"}:
        return False
    return has_nvidia()


def coerce_public_url(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("publicUrl", "public_url", "signedURL", "signedUrl", "url"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
        data = value.get("data")
        if isinstance(data, dict):
            for key in ("publicUrl", "public_url", "signedURL", "signedUrl", "url"):
                candidate = data.get(key)
                if isinstance(candidate, str) and candidate:
                    return candidate
    candidate = getattr(value, "public_url", None) or getattr(value, "publicUrl", None)
    if isinstance(candidate, str) and candidate:
        return candidate
    raise RuntimeError(f"Could not resolve a public URL from storage response: {value!r}")


def verify_remote_asset(url: str, description: str):
    try:
        response = requests.head(url, timeout=30, allow_redirects=True)
        if response.status_code >= 400:
            response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
    except Exception as exc:
        raise RuntimeError(f"{description} is not reachable at {url}: {exc}") from exc


def append_job_log(job_id: str, text: str):
    try:
        current = supabase.table("processing_jobs").select("log_output").eq("id", job_id).single().execute().data or {}
        prev = current.get("log_output") or ""
        combined = ((prev + "\n") if prev else "") + text
        supabase.table("processing_jobs").update({"log_output": combined[-50000:]}).eq("id", job_id).execute()
    except Exception:
        pass


def update_stage(job_id: str, splat_id: str, stage: str, progress: int, status: str = "running", splat_status: str = "processing", extra: Optional[dict] = None):
    stamp = now_iso()
    payload = {
        "status": status,
        "stage": stage,
        "progress_percent": progress,
        "updated_at": stamp,
    }
    if status == "running":
        payload["started_at"] = stamp
    if extra:
        payload.update(extra)
    supabase.table("processing_jobs").update(payload).eq("id", job_id).execute()

    splat_payload = {
        "status": splat_status,
        "processing_stage": stage,
        "processing_progress": progress,
        "updated_at": stamp,
    }
    if splat_status == "processing":
        splat_payload["processing_started_at"] = stamp
    if extra and extra.get("error_message"):
        splat_payload["processing_error"] = str(extra["error_message"])[:5000]
    supabase.table("splats").update(splat_payload).eq("id", splat_id).execute()
    append_job_log(job_id, f"[{stage}] progress={progress}%")


def mark_done(job_id: str, splat_id: str, splat_url: str, thumbnail_url: Optional[str], storage_path: str, thumbnail_path: Optional[str], result_message: str = "Real splat ready", extra_metadata: Optional[dict] = None):
    stamp = now_iso()
    metadata = {"splat_storage_path": storage_path, "thumbnail_storage_path": thumbnail_path}
    if extra_metadata:
        metadata.update(extra_metadata)
    supabase.table("processing_jobs").update({
        "status": "done",
        "stage": "done",
        "progress_percent": 100,
        "completed_at": stamp,
        "updated_at": stamp,
        "output_url": splat_url,
        "thumbnail_url": thumbnail_url,
        "result_message": result_message,
        "metadata": metadata,
        "error_message": None,
    }).eq("id", job_id).execute()
    payload = {
        "status": "done",
        "processing_stage": "done",
        "processing_progress": 100,
        "processing_completed_at": stamp,
        "splat_url": splat_url,
        "updated_at": stamp,
    }
    if thumbnail_url:
        payload["thumbnail_url"] = thumbnail_url
    if extra_metadata and extra_metadata.get("preview_video_url"):
        payload["preview_video_url"] = extra_metadata["preview_video_url"]
    supabase.table("splats").update(payload).eq("id", splat_id).execute()
    append_job_log(job_id, f"[done] {result_message}\nsplat_url={splat_url}\nthumbnail_url={thumbnail_url or ''}")


def mark_failed(job_id: str, splat_id: str, error_message: str):
    stamp = now_iso()
    trimmed = error_message[:5000]
    supabase.table("processing_jobs").update({
        "status": "failed",
        "stage": "failed",
        "completed_at": stamp,
        "updated_at": stamp,
        "error_message": trimmed,
    }).eq("id", job_id).execute()
    supabase.table("splats").update({
        "status": "failed",
        "processing_stage": "failed",
        "processing_completed_at": stamp,
        "processing_error": trimmed,
        "updated_at": stamp,
    }).eq("id", splat_id).execute()
    append_job_log(job_id, f"[failed] {trimmed}")


def ensure_repo():
    GS_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    if GS_REPO_DIR.exists():
        return
    sh(["git", "clone", "https://github.com/graphdeco-inria/gaussian-splatting.git", "--recursive", str(GS_REPO_DIR)])


def fetch_next_metadata_request():
    rows = (
        supabase.table("splats")
        .select("id,user_id,title,description,file_url,splat_url,source_video_url,video_url,metadata")
        .order("updated_at", desc=False)
        .limit(120)
        .execute()
        .data
        or []
    )
    for row in rows:
        metadata = row.get("metadata") or {}
        requests_list = metadata.get("processing_requests") or []
        if not isinstance(requests_list, list):
            continue
        for req in requests_list:
            if isinstance(req, dict) and req.get("status") in (None, "queued", "retrying", "saved_locally"):
                return row, req
    return None, None


def update_request_status(splat_row: dict, request_id: str, status: str, stage: str, extra: Optional[dict] = None):
    metadata = dict(splat_row.get("metadata") or {})
    requests_list = list(metadata.get("processing_requests") or [])
    changed = False
    for idx, req in enumerate(requests_list):
        if not isinstance(req, dict):
            continue
        if req.get("id") == request_id:
            req = {**req, "status": status, "stage": stage, "updated_at": now_iso()}
            if extra:
                req.update(extra)
            requests_list[idx] = req
            metadata["last_processing_request"] = req
            changed = True
            break
    if changed:
        metadata["processing_requests"] = requests_list
        supabase.table("splats").update({"metadata": metadata, "updated_at": now_iso()}).eq("id", splat_row["id"]).execute()


def create_job_from_request(splat_row: dict, req: dict):
    video_url = req.get("video_url") or req.get("source_video_url") or splat_row.get("source_video_url") or splat_row.get("video_url")
    if not video_url:
        raise RuntimeError("No source video URL available for advanced request.")
    payload = {
        "splat_id": splat_row["id"],
        "user_id": splat_row.get("user_id"),
        "owner_id": splat_row.get("user_id"),
        "video_url": video_url,
        "video_path": req.get("video_path"),
        "source_video_path": req.get("video_path"),
        "job_type": req.get("kind") or "gaussian_splat",
        "source_type": "metadata_request",
        "status": "queued",
        "stage": "queued",
        "progress_percent": 0,
        "retry_count": 0,
        "log_output": json.dumps({
            "request_id": req.get("id"),
            "request_kind": req.get("kind"),
            "frame_times": req.get("frame_times"),
            "motion_class": req.get("motion_class")
        }, default=str),
    }
    created = supabase.table("processing_jobs").insert(payload).execute().data or []
    if not created:
        raise RuntimeError("Failed to create processing_job from metadata request.")
    return created[0]


def process_metadata_request(splat_row: dict, req: dict):
    kind = req.get("kind") or "mesh_cleanup"
    request_id = req.get("id")
    update_request_status(splat_row, request_id, "running", "dispatching")
    if kind in ("fourd_reconstruction", "motion_state_reconstruction", "event_fast_clean"):
        job = create_job_from_request(splat_row, req)
        update_request_status(splat_row, request_id, "running", "queued_job", {"job_id": job.get("id")})
        return True

    metadata = dict(splat_row.get("metadata") or {})
    variants = list(metadata.get("variants") or [])
    variant = {
        "id": req.get("id") or f"{kind}_{int(time.time())}",
        "name": f"{kind.replace('_', ' ').title()} recipe",
        "created_at": now_iso(),
        "kind": kind,
        "status": "done",
        "source_splat_url": splat_row.get("splat_url") or splat_row.get("file_url") or "",
        "request_payload": req,
    }
    variants.insert(0, variant)
    metadata["variants"] = variants[:25]
    metadata["last_processing_request"] = {**req, "status": "done", "stage": "recipe_saved", "updated_at": now_iso()}
    requests_list = list(metadata.get("processing_requests") or [])
    for idx, item in enumerate(requests_list):
        if isinstance(item, dict) and item.get("id") == request_id:
            requests_list[idx] = metadata["last_processing_request"]
            break
    metadata["processing_requests"] = requests_list
    supabase.table("splats").update({"metadata": metadata, "updated_at": now_iso()}).eq("id", splat_row["id"]).execute()
    return True


def claim_next_job():
    res = (
        supabase.table("processing_jobs")
        .select("*")
        .in_("status", ["queued", "retrying"])
        .order("queued_at", desc=False)
        .limit(8)
        .execute()
    )
    rows = res.data or []
    for row in rows:
        updated = supabase.table("processing_jobs").update({
            "status": "running",
            "stage": row.get("stage") or "starting",
            "started_at": now_iso(),
            "updated_at": now_iso(),
        }).eq("id", row["id"]).in_("status", ["queued", "retrying"]).execute()
        if updated.data:
            return updated.data[0]
    return None


def stream_download(url: str, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(output_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)


def process_convert_job(job: dict):
    """
    Lightweight conversion job — no video, no COLMAP, no training.
    Downloads an existing .ply/.splat, encodes to .fumoc, uploads result.
    Triggered when processing_jobs.job_type = 'convert'.
    """
    job_id   = job["id"]
    splat_id = job["splat_id"]

    job_dir  = GS_DATA_ROOT / splat_id
    if job_dir.exists(): shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)

    thumb_path = job_dir / "thumb.jpg"
    splat_row  = supabase.table("splats").select("id,title,metadata").eq("id", splat_id).maybe_single().execute().data or {}
    title      = splat_row.get("title") or "Untitled Scene"
    meta       = dict(splat_row.get("metadata") or {})
    mesh_tris  = int(job.get("mesh_tris") or meta.get("convert_mesh_tris") or FUMOC_MESH_TRIS)

    # ── Download source .ply / .splat ────────────────────────────────────────
    update_stage(job_id, splat_id, "downloading_ply", 10)
    source_url = job.get("source_ply_url") or splat_row.get("file_url") or splat_row.get("splat_url") or ""
    if not source_url:
        mark_failed(job_id, splat_id, "No source PLY URL found in job or splat row")
        return

    ext      = source_url.split("?")[0].rsplit(".", 1)[-1].lower() or "ply"
    ply_path = job_dir / f"source.{ext}"
    append_job_log(job_id, f"[Convert] Downloading {source_url[:200]}")
    stream_download(source_url, ply_path)
    validate_exists(ply_path, "source splat file")
    append_job_log(job_id, f"[Convert] Downloaded {ply_path.stat().st_size/1048576:.1f} MB")

    # If it's a .splat (binary, not PLY), convert to raw splat binary for encoder
    # fumoc_encoder.py handles both .ply (with header) and raw .splat (headerless 32-byte rows)
    if ext == "splat":
        # Rename so encoder knows it's headerless
        new_path = ply_path.with_suffix(".raw_splat")
        ply_path.rename(new_path)
        ply_path = new_path

    # ── Install deps ─────────────────────────────────────────────────────────
    import subprocess, sys
    def _pip(pkg):
        try: __import__(pkg.split("==")[0].replace("-","_"))
        except ImportError: subprocess.run([sys.executable,"-m","pip","install",pkg,"--quiet"],check=False)
    _pip("open3d")
    _pip("DracoPy")

    # ── Encode to .fumoc ─────────────────────────────────────────────────────
    update_stage(job_id, splat_id, "encoding_fumoc", 40)
    fumoc_path = job_dir / f"{splat_id}.fumoc"
    try:
        encode_ply_to_fumoc(
            ply_path         = ply_path,
            out_path         = fumoc_path,
            title            = title,
            thumb_jpg_path   = thumb_path if thumb_path.exists() else None,
            build_mesh       = True,
            mesh_target_tris = mesh_tris,
            precompute_sort  = True,
        )
    except Exception as enc_err:
        mark_failed(job_id, splat_id, f"Encoding failed: {enc_err}")
        return

    validate_exists(fumoc_path, ".fumoc output")
    fumoc_size = fumoc_path.stat().st_size
    append_job_log(job_id, f"[Convert] .fumoc size: {fumoc_size/1048576:.2f} MB")

    # ── Upload .fumoc ─────────────────────────────────────────────────────────
    update_stage(job_id, splat_id, "uploading_assets", 85)
    fumoc_storage_path = f"{splat_id}/scene.fumoc"
    fumoc_url = upload_file(FUMOC_BUCKET, fumoc_storage_path, fumoc_path, verify=False)
    append_job_log(job_id, f"[Convert] Uploaded: {fumoc_url}")

    # ── Update splats table ───────────────────────────────────────────────────
    meta.update({
        "fumoc_url":          fumoc_url,
        "fumoc_storage_path": fumoc_storage_path,
        "fumoc_size_bytes":   fumoc_size,
        "convert_mesh_tris":  mesh_tris,
    })
    try:
        supabase.table("splats").update({
            "metadata":  meta,
            "fumoc_url": fumoc_url,
            "status":    "ready",
        }).eq("id", splat_id).execute()
    except Exception:
        supabase.table("splats").update({"metadata": meta, "status": "ready"}).eq("id", splat_id).execute()

    mark_done(
        job_id, splat_id,
        splat_url      = fumoc_url,
        thumbnail_url  = None,
        storage_path   = fumoc_storage_path,
        thumbnail_path = None,
        result_message = f".fumoc conversion complete ({fumoc_size/1048576:.2f} MB)",
        extra_metadata = {"fumoc_url": fumoc_url},
    )
    append_job_log(job_id, "[Convert] Done ✓")


def resolve_video_download_url(job: dict) -> str:
    video_url = job.get("video_url")
    if video_url:
        return video_url
    bucket = job.get("video_bucket") or VIDEO_BUCKET
    path = job.get("video_path") or job.get("source_video_path")
    if not path:
        raise RuntimeError("Job is missing both video_url and storage path.")
    signed = supabase.storage.from_(bucket).create_signed_url(path, 60 * 60)
    return coerce_public_url(signed)


def extract_thumbnail(video_path: Path, thumb_path: Path):
    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    sh([FFMPEG_BIN, "-y", "-i", str(video_path), "-ss", "00:00:01.000", "-vframes", "1", str(thumb_path)])


def extract_preview(video_path: Path, preview_path: Path):
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    sh([
        FFMPEG_BIN, "-y", "-i", str(video_path),
        "-vf", "fps=24,scale='min(1280,iw)':-2",
        "-t", "8",
        "-an",
        "-movflags", "+faststart",
        str(preview_path),
    ])


def extract_frames(video_path: Path, frames_dir: Path):
    frames_dir.mkdir(parents=True, exist_ok=True)
    sh([
        FFMPEG_BIN, "-y", "-i", str(video_path),
        "-vf", f"fps={FRAME_FPS},scale='min(1920,iw)':-2",
        str(frames_dir / "%05d.png"),
    ])
    frames = sorted(frames_dir.glob("*.png"))
    if len(frames) < 20:
        raise RuntimeError(f"Too few frames extracted: {len(frames)}. Upload a longer, smoother orbit video.")
    if len(frames) > MAX_FRAMES:
        for old in frames[MAX_FRAMES:]:
            old.unlink(missing_ok=True)
        frames = frames[:MAX_FRAMES]
    return frames


def copy_frames_to_scene(frames, scene_input_dir: Path):
    scene_input_dir.mkdir(parents=True, exist_ok=True)
    for idx, src in enumerate(frames, start=1):
        shutil.copy2(src, scene_input_dir / f"{idx:05d}.png")
    copied = list(scene_input_dir.glob("*.png"))
    if len(copied) < 20:
        raise RuntimeError("Scene input folder was not populated correctly.")


def validate_exists(path: Path, description: str):
    if not path.exists():
        raise RuntimeError(f"Missing required output: {description} -> {path}")


def normalize_undistorted_workspace(undistorted_dir: Path) -> Path:
    images_dir = undistorted_dir / "images"
    sparse_dir = undistorted_dir / "sparse"
    sparse_zero = sparse_dir / "0"
    validate_exists(images_dir, "undistorted images folder")
    validate_exists(sparse_dir, "undistorted sparse folder")

    root_bins = [sparse_dir / name for name in ("cameras.bin", "images.bin", "points3D.bin")]
    zero_bins = [sparse_zero / name for name in ("cameras.bin", "images.bin", "points3D.bin")]
    if all(path.exists() for path in zero_bins):
        return undistorted_dir
    if all(path.exists() for path in root_bins):
        sparse_zero.mkdir(parents=True, exist_ok=True)
        for src in root_bins:
            dst = sparse_zero / src.name
            if not dst.exists():
                shutil.copy2(src, dst)
        return undistorted_dir
    raise RuntimeError(
        "COLMAP undistortion completed, but sparse model files were not found in either "
        f"{sparse_dir} or {sparse_zero}."
    )


def run_colmap_pipeline(job_dir: Path):
    scene_dir = job_dir / "scene"
    input_dir = scene_dir / "input"
    distorted_dir = scene_dir / "distorted"
    sparse_dir = distorted_dir / "sparse"
    undistorted_dir = scene_dir / "undistorted"
    db_path = distorted_dir / "database.db"
    distorted_dir.mkdir(parents=True, exist_ok=True)
    sparse_dir.mkdir(parents=True, exist_ok=True)

    use_gpu = wants_colmap_gpu()
    gpu_flag = "1" if use_gpu else "0"
    colmap_env = {"QT_QPA_PLATFORM": "offscreen", "CUDA_VISIBLE_DEVICES": os.getenv("CUDA_VISIBLE_DEVICES", "0")}
    append_job_log(job_dir.name, f"COLMAP GPU enabled={use_gpu}")

    extractor_cmd = [
        COLMAP_BIN, "feature_extractor",
        "--database_path", db_path,
        "--image_path", input_dir,
        "--ImageReader.single_camera", "1",
        "--SiftExtraction.use_gpu", gpu_flag,
        "--SiftExtraction.max_image_size", "1920",
        "--SiftExtraction.max_num_features", "8192",  # v60: more features = better reconstruction
        "--SiftExtraction.num_threads", str(COLMAP_THREADS),
    ]
    matcher_cmd = [
        COLMAP_BIN, "sequential_matcher",
        "--database_path", db_path,
        "--SiftMatching.use_gpu", gpu_flag,
        "--SiftMatching.num_threads", str(COLMAP_THREADS),
    ]
    mapper_cmd = [
        COLMAP_BIN, "mapper",
        "--database_path", db_path,
        "--image_path", input_dir,
        "--output_path", sparse_dir,
        "--Mapper.num_threads", str(COLMAP_THREADS),
        "--Mapper.ba_global_max_num_iterations", "50",
    ]

    try:
        sh(extractor_cmd, env=colmap_env)
        sh(matcher_cmd, env=colmap_env)
    except Exception:
        if use_gpu and USE_COLMAP_GPU == "auto":
            append_job_log(job_dir.name, "GPU COLMAP path failed, retrying on CPU.")
            extractor_cmd[extractor_cmd.index("--SiftExtraction.use_gpu") + 1] = "0"
            matcher_cmd[matcher_cmd.index("--SiftMatching.use_gpu") + 1] = "0"
            sh(extractor_cmd, env=colmap_env)
            sh(matcher_cmd, env=colmap_env)
        else:
            raise

    sh(mapper_cmd, env=colmap_env)
    sparse_zero = sparse_dir / "0"
    validate_exists(sparse_zero / "cameras.bin", "COLMAP cameras.bin")
    validate_exists(sparse_zero / "images.bin", "COLMAP images.bin")
    validate_exists(sparse_zero / "points3D.bin", "COLMAP points3D.bin")
    sh([
        COLMAP_BIN, "image_undistorter",
        "--image_path", input_dir,
        "--input_path", sparse_zero,
        "--output_path", undistorted_dir,
        "--output_type", "COLMAP",
    ], env=colmap_env)
    return normalize_undistorted_workspace(undistorted_dir)


def run_training(scene_dir: Path, model_dir: Path):
    sh([
        "python", "train.py",
        "-s", str(scene_dir),
        "-m", str(model_dir),
        "--iterations", str(TRAIN_ITERS),
        "--test_iterations", "-1",
        "--save_iterations", str(TRAIN_ITERS),
    ], cwd=GS_REPO_DIR)
    candidates = [
        model_dir / "point_cloud" / f"iteration_{TRAIN_ITERS}" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_3000" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_5000" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_7000" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_30000" / "point_cloud.ply",
    ]
    for c in candidates:
        if c.exists():
            return c
    found = list(model_dir.rglob("point_cloud.ply"))
    if found:
        return found[-1]
    raise RuntimeError("Training finished without producing point_cloud.ply")


def create_fallback(job_dir: Path, video_path: Path):
    out_dir = job_dir / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    ply = out_dir / "point_cloud.ply"
    ply.write_text("""ply
format ascii 1.0
element vertex 8
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
-0.5 -0.5 -0.5 0 212 255
0.5 -0.5 -0.5 0 212 255
0.5 0.5 -0.5 0 212 255
-0.5 0.5 -0.5 0 212 255
-0.5 -0.5 0.5 124 58 237
0.5 -0.5 0.5 124 58 237
0.5 0.5 0.5 255 45 120
-0.5 0.5 0.5 255 45 120
""")
    thumb = out_dir / "thumb.jpg"
    extract_thumbnail(video_path, thumb)
    return ply, thumb


def infer_content_type(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".ply":
        return "application/octet-stream"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".mp4":
        return "video/mp4"
    return "application/octet-stream"


def compress_ply(ply_path: Path, max_mb: int = MAX_PLY_MB) -> Path:
    """
    Safely reduce PLY size without changing the file format.
    This function never renames gzip data to .ply.
    Strategy:
      1. If already under limit -> return as-is.
      2. If binary PLY -> subsample vertices while preserving binary layout.
      3. If ascii PLY -> subsample vertex lines while preserving plain-text PLY.
      4. Keep a little headroom below the upload limit.
    """
    import math
    import re

    size_mb = ply_path.stat().st_size / (1024 * 1024)
    if size_mb <= max_mb:
        return ply_path

    raw = ply_path.read_bytes()
    header_end = raw.find(b"end_header\n")
    header_token = b"end_header\n"
    if header_end == -1:
        header_end = raw.find(b"end_header\r\n")
        header_token = b"end_header\r\n"
    if header_end == -1:
        print(f"[FUMOCA] Could not parse PLY header for {ply_path.name}; uploading original file")
        return ply_path

    header_end += len(header_token)
    header_bytes = raw[:header_end]
    body = raw[header_end:]
    header_text = header_bytes.decode("ascii", errors="replace")

    m = re.search(r"element vertex (\d+)", header_text)
    if not m:
        print(f"[FUMOCA] No vertex count found in {ply_path.name}; uploading original file")
        return ply_path
    n_verts = int(m.group(1))
    if n_verts <= 0:
        return ply_path

    is_ascii = "format ascii" in header_text.lower()
    target_bytes = int(max_mb * 1024 * 1024 * 0.82)  # headroom below provider limit
    approx_keep_ratio = max(0.05, min(1.0, target_bytes / max(len(raw), 1)))
    step = max(1, math.ceil(1 / approx_keep_ratio))

    def rewrite_header(new_count: int) -> bytes:
        updated = re.sub(r"element vertex \d+", f"element vertex {new_count}", header_text, count=1)
        return updated.encode("ascii")

    if is_ascii:
        lines = body.splitlines(keepends=True)
        kept = lines[::step]
        if not kept:
            kept = lines[:1]
        new_body = b"".join(kept)
        new_count = len(kept)
        ply_path.write_bytes(rewrite_header(new_count) + new_body)
        new_mb = ply_path.stat().st_size / (1024 * 1024)
        print(f"[FUMOCA] ASCII PLY reduced: {n_verts} -> {new_count} vertices, {size_mb:.1f} -> {new_mb:.1f} MB")
        return ply_path

    bytes_per_vert = len(body) // n_verts if n_verts else 0
    if bytes_per_vert <= 0:
        print(f"[FUMOCA] Invalid binary vertex stride for {ply_path.name}; uploading original file")
        return ply_path

    chunks = []
    for i in range(0, n_verts, step):
        start = i * bytes_per_vert
        end = start + bytes_per_vert
        if end <= len(body):
            chunks.append(body[start:end])
    if not chunks:
        chunks.append(body[:bytes_per_vert])
    new_body = b"".join(chunks)
    new_count = len(chunks)
    new_bytes = rewrite_header(new_count) + new_body
    ply_path.write_bytes(new_bytes)
    new_mb = ply_path.stat().st_size / (1024 * 1024)
    print(f"[FUMOCA] Binary PLY reduced: {n_verts} -> {new_count} vertices, {size_mb:.1f} -> {new_mb:.1f} MB")
    return ply_path


def _b64(s: str) -> str:
    """Base64-encode a string for TUS Upload-Metadata header (no padding issues)."""
    import base64
    return base64.b64encode(s.encode()).decode()


def upload_file(bucket: str, storage_path: str, file_path: Path, verify: bool = True):
    """
    Upload to Supabase Storage.
    Files < 40 MB  → standard single-shot upload.
    Files >= 40 MB → TUS resumable chunked upload (6 MB chunks).
    This eliminates the 413 Payload Too Large error on large PLY splat files.
    """
    import math

    SMALL_MB = 40
    CHUNK = 6 * 1024 * 1024  # 6 MB

    validate_exists(file_path, f"local file before upload ({storage_path})")

    if file_path.suffix.lower() == ".ply":
        file_path = compress_ply(file_path)

    size_bytes = file_path.stat().st_size
    size_mb = size_bytes / (1024 * 1024)
    content_type = infer_content_type(file_path)

    if size_mb < SMALL_MB:
        # ── Standard single-shot ──────────────────────────────────────────────
        file_options = {"upsert": "true", "content-type": content_type}
        with open(file_path, "rb") as fh:
            supabase.storage.from_(bucket).upload(storage_path, fh, file_options)
    else:
        # ── TUS resumable chunked upload ──────────────────────────────────────
        print(f"[FUMOCA] Large file ({size_mb:.1f} MB) — TUS upload: {storage_path}")
        tus_ep = f"{SUPABASE_URL}/storage/v1/upload/resumable"
        create_headers = {
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Tus-Resumable": "1.0.0",
            "Upload-Length": str(size_bytes),
            "Upload-Metadata": (
                f"bucketName {_b64(bucket)},"
                f"objectName {_b64(storage_path)},"
                f"contentType {_b64(content_type)},"
                f"cacheControl {_b64('3600')}"
            ),
            "x-upsert": "true",
        }
        resp = requests.post(tus_ep, headers=create_headers, timeout=60)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"TUS create failed {resp.status_code}: {resp.text[:400]}")
        upload_url = resp.headers.get("Location", "")
        if upload_url.startswith("/"):
            upload_url = SUPABASE_URL.rstrip("/") + upload_url
        if not upload_url:
            raise RuntimeError("TUS create: missing Location header")

        n_chunks = math.ceil(size_bytes / CHUNK)
        offset = 0
        with open(file_path, "rb") as fh:
            idx = 0
            while offset < size_bytes:
                chunk = fh.read(CHUNK)
                if not chunk:
                    break
                idx += 1
                patch_headers = {
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Content-Type": "application/offset+octet-stream",
                    "Tus-Resumable": "1.0.0",
                    "Upload-Offset": str(offset),
                    "Content-Length": str(len(chunk)),
                }
                pr = requests.patch(upload_url, data=chunk, headers=patch_headers, timeout=180)
                if pr.status_code not in (200, 204):
                    raise RuntimeError(f"TUS PATCH chunk {idx} offset {offset}: {pr.status_code} {pr.text[:300]}")
                offset += len(chunk)
                print(f"[FUMOCA] TUS chunk {idx}/{n_chunks} — {offset/(1024*1024):.1f}/{size_mb:.1f} MB")

        print(f"[FUMOCA] TUS upload complete: {storage_path}")

    public_url = coerce_public_url(supabase.storage.from_(bucket).get_public_url(storage_path))
    if verify:
        verify_remote_asset(public_url, f"Uploaded asset {storage_path}")
    return public_url


def process_job(job):
    # Route convert jobs (no video/COLMAP/training needed)
    if job.get("job_type") == "convert":
        process_convert_job(job)
        return

    job_id = job["id"]
    splat_id = job["splat_id"]
    ensure_repo()

    job_dir = GS_DATA_ROOT / splat_id
    if job_dir.exists():
        shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)

    video_path = job_dir / "input.mp4"
    thumb_path = job_dir / "thumb.jpg"
    preview_path = job_dir / "preview.mp4"
    frames_dir = job_dir / "frames"
    scene_input_dir = job_dir / "scene" / "input"
    model_dir = job_dir / "model"
    splat_row = supabase.table("splats").select("id,metadata").eq("id", splat_id).maybe_single().execute().data or {}

    update_stage(job_id, splat_id, "downloading_video", 5)
    video_url = resolve_video_download_url(job)
    append_job_log(job_id, f"Downloading from {video_url[:200]}")
    stream_download(video_url, video_path)
    validate_exists(video_path, "downloaded video")
    append_job_log(job_id, "Video downloaded")

    update_stage(job_id, splat_id, "extracting_frames", 15)
    extract_thumbnail(video_path, thumb_path)
    try:
        extract_preview(video_path, preview_path)
    except Exception as exc:
        append_job_log(job_id, f"Preview generation skipped: {exc}")
    frames = extract_frames(video_path, frames_dir)
    copy_frames_to_scene(frames, scene_input_dir)
    append_job_log(job_id, f"Extracted {len(frames)} frames | fps={FRAME_FPS} | max_frames={MAX_FRAMES}")

    result_message = "Real splat ready"
    output_ply: Path
    fallback_reason = None

    if USE_REAL_ENGINE:
        try:
            update_stage(job_id, splat_id, "building_colmap_scene", 35)
            real_scene_dir = run_colmap_pipeline(job_dir)
            append_job_log(job_id, f"COLMAP scene ready at {real_scene_dir}")

            update_stage(job_id, splat_id, "training_gaussians", 70)
            output_ply = run_training(real_scene_dir, model_dir)
            validate_exists(output_ply, "trained point cloud")
        except Exception as exc:
            fallback_reason = f"Reconstruction failed: {type(exc).__name__}: {exc}"
            append_job_log(job_id, fallback_reason)
            # v78 — do not upload a placeholder cube as the client's splat.
            # Mark the job/splat as failed and bail. The viewer shows its
            # "still processing" state, which is the correct UX for a failed
            # reconstruction. See docs/V78_PATCH_NOTES.md for rationale.
            if not ENABLE_FALLBACK_ON_FAILURE:
                from worker_fallback_patch import mark_reconstruction_failed
                mark_reconstruction_failed(supabase, job_id, splat_id, fallback_reason)
                return
            update_stage(job_id, splat_id, "fallback_export", 82, extra={"error_message": fallback_reason})
            output_ply, thumb_path = create_fallback(job_dir, video_path)
            result_message = "Fallback placeholder exported after real-engine failure"
    else:
        append_job_log(job_id, "USE_REAL_ENGINE=0, creating fallback placeholder")
        update_stage(job_id, splat_id, "fallback_export", 82)
        output_ply, thumb_path = create_fallback(job_dir, video_path)
        result_message = "Fallback placeholder exported"

    # ── FUMOC encoding ──────────────────────────────────────────────────────
    fumoc_path  = None
    fumoc_url   = None
    if ENCODE_FUMOC and FUMOC_ENCODER_AVAILABLE and output_ply.exists():
        try:
            update_stage(job_id, splat_id, "encoding_fumoc", 85)
            append_job_log(job_id, "[FUMOC] Starting .fumoc encoding with mesh reconstruction…")

            # Install deps if not present (Kaggle/Colab environment)
            import subprocess, sys
            def _pip(pkg):
                try:
                    __import__(pkg.split("==")[0].replace("-","_"))
                except ImportError:
                    subprocess.run([sys.executable,"-m","pip","install",pkg,"--quiet"], check=False)
            _pip("open3d")
            _pip("DracoPy")

            splat_row_full = supabase.table("splats").select("id,title,metadata").eq("id", splat_id).maybe_single().execute().data or {}
            scene_title    = splat_row_full.get("title") or "FUMOCA Scene"
            fumoc_path     = job_dir / f"{splat_id}.fumoc"

            encode_ply_to_fumoc(
                ply_path         = output_ply,
                out_path         = fumoc_path,
                title            = scene_title,
                thumb_jpg_path   = thumb_path if thumb_path.exists() else None,
                build_mesh       = True,
                mesh_target_tris = FUMOC_MESH_TRIS,
                precompute_sort  = True,
            )
            append_job_log(job_id, f"[FUMOC] Encoded: {fumoc_path.stat().st_size/1048576:.2f} MB")
        except Exception as fumoc_err:
            append_job_log(job_id, f"[FUMOC] Encoding failed (splat upload continues): {fumoc_err}")
            fumoc_path = None

    update_stage(job_id, splat_id, "uploading_assets", 90)
    splat_storage_path = f"{splat_id}/point_cloud.ply"
    thumb_storage_path = f"{splat_id}/thumb.jpg"
    preview_storage_path = f"{splat_id}/preview.mp4"
    splat_url = upload_file(SPLAT_BUCKET, splat_storage_path, output_ply)
    thumbnail_url = upload_file(THUMB_BUCKET, thumb_storage_path, thumb_path) if thumb_path.exists() else None
    preview_url = None
    if preview_path.exists():
        try:
            preview_url = upload_file(PREVIEW_BUCKET, preview_storage_path, preview_path, verify=False)
        except Exception as exc:
            append_job_log(job_id, f"Preview upload skipped: {exc}")

    metadata_update = dict((splat_row.get("metadata") or {}))
    pipeline_info = metadata_update.get("pipeline") if isinstance(metadata_update.get("pipeline"), dict) else {}
    pipeline_info.update({
        "frame_fps": FRAME_FPS,
        "max_frames": MAX_FRAMES,
        "train_iters": TRAIN_ITERS,
        "use_real_engine": USE_REAL_ENGINE,
        "fallback_reason": fallback_reason,
        "updated_at": now_iso(),
    })
    metadata_update["pipeline"] = pipeline_info
    try:
        supabase.table("splats").update({"metadata": metadata_update}).eq("id", splat_id).execute()
    except Exception:
        pass

    # Upload .fumoc if encoded
    if fumoc_path and fumoc_path.exists():
        try:
            fumoc_storage_path = f"{splat_id}/scene.fumoc"
            fumoc_url = upload_file(FUMOC_BUCKET, fumoc_storage_path, fumoc_path, verify=False)
            append_job_log(job_id, f"[FUMOC] Uploaded: {fumoc_url}")
            # Store fumoc_url in splats table metadata
            try:
                existing_meta = dict((splat_row.get("metadata") or {}))
                existing_meta["fumoc_url"]          = fumoc_url
                existing_meta["fumoc_storage_path"] = fumoc_storage_path
                existing_meta["fumoc_size_bytes"]   = fumoc_path.stat().st_size
                supabase.table("splats").update({
                    "metadata":  existing_meta,
                    "fumoc_url": fumoc_url,
                }).eq("id", splat_id).execute()
            except Exception as meta_err:
                # fumoc_url column may not exist yet — store in metadata only
                try:
                    existing_meta = dict((splat_row.get("metadata") or {}))
                    existing_meta["fumoc_url"] = fumoc_url
                    supabase.table("splats").update({"metadata": existing_meta}).eq("id", splat_id).execute()
                except Exception:
                    pass
        except Exception as up_err:
            append_job_log(job_id, f"[FUMOC] Upload failed: {up_err}")

    mark_done(
        job_id,
        splat_id,
        splat_url,
        thumbnail_url,
        splat_storage_path,
        thumb_storage_path if thumbnail_url else None,
        result_message=result_message,
        extra_metadata={"preview_video_url": preview_url, "preview_storage_path": preview_storage_path if preview_url else None},
    )


def run_once():
    job = claim_next_job()
    if job:
        try:
            process_job(job)
        except Exception as exc:
            error_message = f"{type(exc).__name__}: {exc}"
            mark_failed(job["id"], job["splat_id"], error_message)
            log(error_message)
        return True

    splat_row, req = fetch_next_metadata_request()
    if splat_row and req:
        try:
            process_metadata_request(splat_row, req)
        except Exception as exc:
            error_message = f"{type(exc).__name__}: {exc}"
            update_request_status(splat_row, req.get("id"), "failed", "failed", {"error_message": error_message})
            log(error_message)
        return True

    log("No queued jobs")
    return False


def loop_forever():
    while True:
        found = run_once()
        time.sleep(POLL_SECONDS if not found else 3)


if __name__ == "__main__":
    loop_forever()
