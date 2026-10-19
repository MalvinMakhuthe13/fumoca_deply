"""
FUMOCA Quick Splat B — real poses + short Gaussian train
========================================================
Video → frames → COLMAP (if available) → graphdeco train.py
→ point_cloud.ply on R2 → Studio clean → NIF later.

No full NIF / rembg / SAM / mesh on Kaggle.

Env:
  FUMOCA_QUICK_SPLAT=1
  FUMOCA_MAX_RECON_FRAMES=36
  FUMOCA_GS_ITERS=1500          # short but real train
  FUMOCA_QUICK_MAX_SIDE=640
  GS_REPO_DIR=/kaggle/working/gaussian-splatting
  COLMAP_BIN=colmap
"""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile
import time
import traceback
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import quote

MAX_FRAMES = int(os.getenv("FUMOCA_MAX_RECON_FRAMES", "36"))
GS_ITERS = int(os.getenv("FUMOCA_GS_ITERS", "1500"))
MAX_SIDE = int(os.getenv("FUMOCA_QUICK_MAX_SIDE", "640"))
OUTPUT_BUCKET = os.getenv("FUMOCA_QUICK_BUCKET", "nif-files")
RAW_BUCKET = os.getenv("FUMOCA_RAW_BUCKET", "nif-videos")
GS_REPO_DIR = Path(os.getenv("GS_REPO_DIR", "/kaggle/working/gaussian-splatting"))
COLMAP_BIN = os.getenv("COLMAP_BIN", "colmap")
QUICK_ON = os.getenv("FUMOCA_QUICK_SPLAT", "0").strip() in ("1", "true", "True", "yes")
_INSTALLED = False


def log(msg: str) -> None:
    print(f"[QUICK] {msg}", flush=True)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _is_quick_job(capture_mode: str) -> bool:
    mode = (capture_mode or "").lower().strip()
    if mode in ("splat_only", "quick_splat", "ply_only"):
        return True
    return QUICK_ON


def _sh(cmd, cwd=None, check=True, env=None):
    log("$ " + " ".join(str(c) for c in cmd))
    r = subprocess.run(
        [str(c) for c in cmd],
        cwd=str(cwd) if cwd else None,
        env=env or os.environ.copy(),
        capture_output=True,
        text=True,
    )
    if r.stdout:
        print(r.stdout[-2000:], flush=True)
    if r.returncode != 0:
        print(r.stderr[-3000:], flush=True)
        if check:
            raise RuntimeError(f"Command failed ({r.returncode}): {cmd[0]}")
    return r


# ── R2 ──────────────────────────────────────────────────────────────
def _r2_client():
    import boto3
    from botocore.config import Config

    account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("ACCOUNT_ID")
    key = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not all([account, key, secret]):
        raise RuntimeError("R2 secrets missing")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _download_r2(key: str, dest: Path, bucket: str = RAW_BUCKET) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    log(f"download s3://{bucket}/{key}")
    _r2_client().download_file(bucket, key, str(dest))
    if dest.stat().st_size < 1000:
        raise RuntimeError(f"Empty download: {key}")
    return dest


def _upload_r2(path: Path, key: str, bucket: str = OUTPUT_BUCKET, content_type: str = "application/octet-stream") -> str:
    log(f"upload {path.name} → s3://{bucket}/{key}")
    _r2_client().upload_file(str(path), bucket, key, ExtraArgs={"ContentType": content_type})
    public = os.getenv("FUMOCA_R2_PUBLIC_BASE", "").rstrip("/")
    if public:
        return f"{public}/{key}"
    worker = os.getenv(
        "FUMOCA_R2_WORKER",
        "https://fumoca-r2.ntuthukochildofkrist.workers.dev",
    ).rstrip("/")
    return f"{worker}/file/{quote(key, safe='')}?bucket={bucket}"


def _patch_job(job_id: str, payload: dict) -> None:
    try:
        from supabase import create_client

        url = os.environ["SUPABASE_URL"]
        key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        create_client(url, key).table("reconstruction_jobs").update(payload).eq("id", job_id).execute()
    except Exception as e:
        log(f"job patch warn: {e}")


def _supabase():
    from supabase import create_client

    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


# ── frames ──────────────────────────────────────────────────────────
def _ffmpeg() -> str:
    return shutil.which("ffmpeg") or "ffmpeg"


def _extract_frames(video: Path, input_dir: Path) -> List[Path]:
    input_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(input_dir / "%05d.jpg")
    vf = f"fps=8,scale='min({MAX_SIDE},iw)':-2"
    _sh([_ffmpeg(), "-y", "-i", str(video), "-vf", vf, "-q:v", "2", pattern], check=True)
    frames = sorted(input_dir.glob("*.jpg"))
    if len(frames) < 8:
        raise RuntimeError(f"Too few frames ({len(frames)}). Use a longer, smoother orbit video.")
    if len(frames) > MAX_FRAMES:
        step = len(frames) / MAX_FRAMES
        keep = {frames[int(i * step)] for i in range(MAX_FRAMES)}
        for f in frames:
            if f not in keep:
                f.unlink(missing_ok=True)
        frames = sorted(keep)
    log(f"using {len(frames)} frames @ max_side={MAX_SIDE}")
    return frames


def _thumbnail(video: Path, dest: Path) -> Optional[Path]:
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        _sh([_ffmpeg(), "-y", "-ss", "1", "-i", str(video), "-vframes", "1", "-q:v", "4", str(dest)], check=False)
        return dest if dest.exists() else None
    except Exception:
        return None


# ── COLMAP ──────────────────────────────────────────────────────────
def _colmap_available() -> bool:
    return shutil.which(COLMAP_BIN) is not None or Path(COLMAP_BIN).exists()


def _run_colmap(scene_dir: Path) -> Path:
    """
    Build undistorted COLMAP scene for gaussian-splatting.
    Returns scene root with images/ + sparse/0/
    """
    input_dir = scene_dir / "input"
    distorted = scene_dir / "distorted"
    sparse_dir = distorted / "sparse"
    undistorted = scene_dir / "undistorted"
    db_path = distorted / "database.db"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    undistorted.mkdir(parents=True, exist_ok=True)

    # Kaggle is headless: COLMAP GPU SIFT needs OpenGL and crashes with
    # "Check failed: context_.create()". Force CPU SIFT unless user overrides.
    use_gpu = os.getenv("FUMOCA_COLMAP_GPU", "0").strip()
    if use_gpu not in ("0", "1"):
        use_gpu = "0"

    log(f"COLMAP start use_gpu={use_gpu} (CPU SIFT default on Kaggle headless)")
    env = os.environ.copy()
    env["QT_QPA_PLATFORM"] = "offscreen"
    env.setdefault("DISPLAY", "")
    # Avoid GL driver init noise
    env.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")

    def _feature_extractor(gpu_flag: str):
        _sh(
            [
                COLMAP_BIN, "feature_extractor",
                "--database_path", str(db_path),
                "--image_path", str(input_dir),
                "--ImageReader.single_camera", "1",
                "--SiftExtraction.use_gpu", gpu_flag,
                "--SiftExtraction.max_image_size", str(max(MAX_SIDE, 1280)),
                "--SiftExtraction.max_num_features", "6144",
            ],
            env=env,
        )

    def _matcher(gpu_flag: str):
        try:
            _sh(
                [
                    COLMAP_BIN, "sequential_matcher",
                    "--database_path", str(db_path),
                    "--SiftMatching.use_gpu", gpu_flag,
                ],
                env=env,
            )
        except Exception:
            log("sequential_matcher failed — trying exhaustive_matcher")
            _sh(
                [
                    COLMAP_BIN, "exhaustive_matcher",
                    "--database_path", str(db_path),
                    "--SiftMatching.use_gpu", gpu_flag,
                ],
                env=env,
            )

    try:
        _feature_extractor(use_gpu)
        _matcher(use_gpu)
    except Exception as e:
        if use_gpu == "1":
            log(f"COLMAP GPU path failed ({e}); retrying CPU SIFT")
            if db_path.exists():
                db_path.unlink()
            use_gpu = "0"
            _feature_extractor("0")
            _matcher("0")
        else:
            raise

    _sh(
        [
            COLMAP_BIN, "mapper",
            "--database_path", str(db_path),
            "--image_path", str(input_dir),
            "--output_path", str(sparse_dir),
            "--Mapper.ba_global_max_num_iterations", "30",
        ],
        env=env,
    )

    sparse_zero = sparse_dir / "0"
    if not sparse_zero.exists():
        # mapper sometimes writes directly into sparse/
        bins = list(sparse_dir.glob("**/cameras.bin"))
        if bins:
            sparse_zero = bins[0].parent
        else:
            raise RuntimeError("COLMAP mapper produced no sparse model")

    for name in ("cameras.bin", "images.bin", "points3D.bin"):
        if not (sparse_zero / name).exists():
            raise RuntimeError(f"Missing COLMAP {name}")

    _sh(
        [
            COLMAP_BIN, "image_undistorter",
            "--image_path", str(input_dir),
            "--input_path", str(sparse_zero),
            "--output_path", str(undistorted),
            "--output_type", "COLMAP",
        ],
        env=env,
    )

    # Ensure sparse/0 layout for train.py
    u_sparse = undistorted / "sparse"
    u_zero = u_sparse / "0"
    if not (u_zero / "cameras.bin").exists():
        u_zero.mkdir(parents=True, exist_ok=True)
        for name in ("cameras.bin", "images.bin", "points3D.bin"):
            src = u_sparse / name
            if src.exists() and not (u_zero / name).exists():
                shutil.copy2(src, u_zero / name)
    if not (undistorted / "images").exists():
        raise RuntimeError("COLMAP undistorter produced no images/")
    log(f"pose_source=colmap sparse={u_zero}")
    return undistorted


# ── Gaussian train ──────────────────────────────────────────────────
def _ensure_gs_repo() -> Path:
    if not (GS_REPO_DIR / "train.py").exists():
        log(f"cloning gaussian-splatting → {GS_REPO_DIR}")
        GS_REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
        if GS_REPO_DIR.exists():
            shutil.rmtree(GS_REPO_DIR, ignore_errors=True)
        _sh(
            [
                "git", "clone",
                "https://github.com/graphdeco-inria/gaussian-splatting.git",
                "--recursive",
                str(GS_REPO_DIR),
            ]
        )
    # Python deps + CUDA extensions (required for train.py)
    _sh(["pip", "install", "-q", "plyfile", "tqdm", "opencv-python-headless"], check=False)
    # Build/install rasterizer + knn (must match current torch/CUDA)
    for sub in (
        "submodules/diff-gaussian-rasterization",
        "submodules/simple-knn",
        "submodules/fused-ssim",
    ):
        sub_path = GS_REPO_DIR / sub
        if not sub_path.exists():
            log(f"skip missing submodule {sub}")
            continue
        marker = sub_path / ".fumoca_installed"
        if marker.exists():
            continue
        log(f"pip install -e {sub}")
        r = _sh(
            ["pip", "install", "-q", "-e", str(sub_path)],
            check=False,
        )
        if r.returncode == 0:
            try:
                marker.write_text("ok", encoding="utf-8")
            except Exception:
                pass
        else:
            log(f"WARN: install failed for {sub} — train may fail")
    # Verify rasterizer import
    r = _sh(
        ["python", "-c", "from diff_gaussian_rasterization import GaussianRasterizer; print('rasterizer OK')"],
        check=False,
    )
    if r.returncode != 0:
        log(
            "diff_gaussian_rasterization not importable — will use COLMAP sparse PLY. "
            "Full Gaussian train needs nvcc + CUDA torch on this machine."
        )
        return GS_REPO_DIR
    return GS_REPO_DIR


def _gsplat_available() -> bool:
    r = _sh(["python", "-c", "import gsplat; print(gsplat.__file__)"], check=False)
    return r.returncode == 0


def _run_training_gsplat(scene_dir: Path, model_dir: Path) -> Path:
    """
    Train with nerfstudio gsplat simple_trainer (works on py3.13 + modern CUDA).
    Expects COLMAP layout: scene_dir/images + scene_dir/sparse/0
    """
    model_dir.mkdir(parents=True, exist_ok=True)
    examples = Path(os.getenv("GSPLAT_EXAMPLES", "/kaggle/working/gsplat_examples"))
    trainer = examples / "simple_trainer.py"
    tmp = Path("/kaggle/working/gsplat_src")
    if not (tmp / "examples" / "simple_trainer.py").exists():
        log("cloning gsplat repo (library + examples must match)")
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
        _sh(
            [
                "git", "clone", "--depth", "1",
                "https://github.com/nerfstudio-project/gsplat.git",
                str(tmp),
            ]
        )
    # Install *this* gsplat so examples match (fixes color_correct import)
    log("pip install -e gsplat from git source (match simple_trainer)")
    _sh(["pip", "install", "-q", "-e", str(tmp)], check=False)
    # Verify color_correct exists
    r = _sh(
        ["python", "-c", "from gsplat.color_correct import color_correct_affine; print('gsplat src OK')"],
        check=False,
    )
    if r.returncode != 0:
        # try without editable
        _sh(["pip", "install", "-q", "--force-reinstall", str(tmp)], check=False)

    examples.parent.mkdir(parents=True, exist_ok=True)
    if examples.exists():
        shutil.rmtree(examples, ignore_errors=True)
    shutil.copytree(tmp / "examples", examples)

    # Extra deps often needed by simple_trainer
    _sh(
        [
            "pip", "install", "-q",
            "pycolmap", "viser", "nerfview", "splines", "torchmetrics",
            "imageio[ffmpeg]", "tyro", "jaxtyping", "rich",
        ],
        check=False,
    )

    result_dir = model_dir / "gsplat_out"
    result_dir.mkdir(parents=True, exist_ok=True)
    log(f"gsplat train steps={GS_ITERS} data={scene_dir}")

    # simple_trainer CLI (tyro): default config + overrides
    cmd = [
        "python", str(trainer),
        "default",
        "--data_dir", str(scene_dir),
        "--result_dir", str(result_dir),
        "--max_steps", str(GS_ITERS),
        "--save_steps", str(GS_ITERS),
        "--eval_steps", str(GS_ITERS + 1),  # effectively skip mid eval
        "--data_factor", "1",
        "--disable_viewer",
    ]
    # Some versions use different flag names — try primary first
    r = _sh(cmd, cwd=str(examples), check=False)
    if r.returncode != 0:
        # Fallback smaller flag set
        cmd2 = [
            "python", str(trainer),
            "default",
            f"--data_dir={scene_dir}",
            f"--result_dir={result_dir}",
            f"--max_steps={GS_ITERS}",
            "--data_factor=1",
        ]
        _sh(cmd2, cwd=str(examples), check=True)

    # Find exported ply
    ply_candidates = sorted(result_dir.rglob("*.ply"))
    if not ply_candidates:
        # Some builds write ckpt only — try common path
        ply_candidates = sorted(model_dir.rglob("*.ply"))
    if not ply_candidates:
        raise RuntimeError("gsplat finished but no .ply found under result_dir")
    # Prefer point_cloud / splat named files
    preferred = [c for c in ply_candidates if "point_cloud" in c.name.lower() or "splat" in c.name.lower()]
    out = preferred[-1] if preferred else ply_candidates[-1]
    log(f"gsplat PLY → {out} ({out.stat().st_size/1e6:.2f} MB)")
    return out


def _run_training_graphdeco(scene_dir: Path, model_dir: Path) -> Path:
    repo = _ensure_gs_repo()
    r = _sh(
        ["python", "-c", "from diff_gaussian_rasterization import GaussianRasterizer"],
        check=False,
    )
    if r.returncode != 0:
        raise RuntimeError("graphdeco CUDA rasterizer unavailable")
    model_dir.mkdir(parents=True, exist_ok=True)
    log(f"graphdeco train iterations={GS_ITERS} scene={scene_dir}")
    _sh(
        [
            "python", "train.py",
            "-s", str(scene_dir),
            "-m", str(model_dir),
            "--iterations", str(GS_ITERS),
            "--test_iterations", "-1",
            "--save_iterations", str(GS_ITERS),
        ],
        cwd=repo,
    )
    candidates = [
        model_dir / "point_cloud" / f"iteration_{GS_ITERS}" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_3000" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_1500" / "point_cloud.ply",
        model_dir / "point_cloud" / "iteration_1000" / "point_cloud.ply",
    ]
    for c in candidates:
        if c.exists():
            return c
    found = sorted(model_dir.rglob("point_cloud.ply"))
    if found:
        return found[-1]
    raise RuntimeError("graphdeco training finished without point_cloud.ply")


def _run_training(scene_dir: Path, model_dir: Path) -> Path:
    """Prefer gsplat (works on this Kaggle image); fall back to graphdeco."""
    if _gsplat_available():
        try:
            return _run_training_gsplat(scene_dir, model_dir)
        except Exception as e:
            log(f"gsplat train failed: {e}")
            traceback.print_exc()
    try:
        return _run_training_graphdeco(scene_dir, model_dir)
    except Exception as e:
        raise RuntimeError(f"All train backends failed: {e}") from e


# ── COLMAP sparse cloud export (real geometry, no CUDA train) ─────
def _colmap_sparse_to_ply(sparse_dir: Path, out: Path) -> Path:
    """
    Export SfM points as ASCII XYZRGB PLY.
    Always goes via points3D.txt (reliable). model_converter PLY path is flaky
    across COLMAP builds and produced 0-byte files on Kaggle.
    """
    sparse_dir = Path(sparse_dir)
    txt = sparse_dir / "points3D.txt"
    if not txt.exists():
        log("converting sparse model to TXT")
        _sh(
            [
                COLMAP_BIN, "model_converter",
                "--input_path", str(sparse_dir),
                "--output_path", str(sparse_dir),
                "--output_type", "TXT",
            ],
            check=True,
        )
        txt = sparse_dir / "points3D.txt"
    if not txt.exists():
        raise RuntimeError(f"points3D.txt missing under {sparse_dir}")

    points = []
    for line in txt.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        # POINT3D_ID X Y Z R G B ERROR TRACK...
        if len(parts) < 7:
            continue
        try:
            x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
            r, g, b = int(float(parts[4])), int(float(parts[5])), int(float(parts[6]))
            r = max(0, min(255, r))
            g = max(0, min(255, g))
            b = max(0, min(255, b))
            points.append((x, y, z, r, g, b))
        except ValueError:
            continue

    if len(points) < 30:
        raise RuntimeError(f"Too few COLMAP 3D points ({len(points)}) — capture may lack overlap")

    out = Path(out)
    with out.open("w", encoding="ascii") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        f.write("end_header\n")
        for x, y, z, r, g, b in points:
            f.write(f"{x:.6f} {y:.6f} {z:.6f} {r} {g} {b}\n")

    size = out.stat().st_size
    if size < 500:
        raise RuntimeError(f"PLY too small ({size} bytes)")
    log(f"COLMAP sparse PLY points={len(points)} size={size/1e6:.3f} MB → {out}")
    return out


# ── RGB fallback (last resort) ──────────────────────────────────────
def _rgb_fallback_ply(frames: List[Path], out: Path) -> Path:
    from PIL import Image
    import numpy as np

    log("FALLBACK rgb-lift (COLMAP/train failed) — shape will be weak")
    points = []
    n = len(frames)
    radius = 2.5
    stride = 6
    for i, fp in enumerate(frames):
        ang = 2 * math.pi * i / max(n, 1)
        cx, cy, cz = radius * math.sin(ang), 0.3, radius * math.cos(ang)
        img = Image.open(fp).convert("RGB")
        w, h = img.size
        arr = np.asarray(img)
        fx = 0.9 * max(w, h)
        for v in range(0, h, stride):
            for u in range(0, w, stride):
                r, g, b = map(int, arr[v, u])
                if r + g + b < 40:
                    continue
                x_n = (u - w * 0.5) / fx
                y_n = -(v - h * 0.5) / fx
                depth = 1.5
                forward = np.array([-cx, -cy, -cz], dtype=np.float64)
                forward /= np.linalg.norm(forward) + 1e-8
                up = np.array([0.0, 1.0, 0.0])
                right = np.cross(forward, up)
                right /= np.linalg.norm(right) + 1e-8
                upv = np.cross(right, forward)
                cam = np.array([cx, cy, cz])
                world = cam + forward * depth + right * (x_n * depth) + upv * (y_n * depth)
                points.append((float(world[0]), float(world[1]), float(world[2]), r, g, b))
    if len(points) > 350_000:
        points = points[:: max(1, len(points) // 350_000)]
    with out.open("w", encoding="ascii") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        f.write("end_header\n")
        for x, y, z, r, g, b in points:
            f.write(f"{x:.5f} {y:.5f} {z:.5f} {r} {g} {b}\n")
    return out


# ── main job ────────────────────────────────────────────────────────
def run_quick_splat(job_id: str, user_id: str, raw_r2_key: str, meta: Optional[dict] = None) -> dict:
    meta = dict(meta or {})
    work = Path(tempfile.mkdtemp(prefix=f"quickB_{job_id[:8]}_"))
    log("mode=ON path=B (COLMAP + short Gaussian train — no full NIF)")
    log(f"work={work} iters={GS_ITERS} frames≤{MAX_FRAMES}")

    pose_source = "unknown"
    train_ok = False
    try:
        _patch_job(job_id, {"status": "processing", "progress": 3, "error_message": None})
        video = work / "input.mp4"
        _download_r2(raw_r2_key, video)
        _patch_job(job_id, {"progress": 10})

        scene = work / "scene"
        input_dir = scene / "input"
        frames = _extract_frames(video, input_dir)
        _patch_job(job_id, {"progress": 20})

        ply: Optional[Path] = None
        # 1) COLMAP
        if _colmap_available():
            try:
                undistorted = _run_colmap(scene)
                pose_source = "colmap"
                _patch_job(job_id, {"progress": 45})
                # 2) Train
                try:
                    import torch
                    if not torch.cuda.is_available():
                        log("WARNING: no CUDA — train may be very slow or fail")
                except Exception:
                    pass
                model_dir = work / "model"
                ply = _run_training(undistorted, model_dir)
                train_ok = True
                _patch_job(job_id, {"progress": 85})
            except Exception as e:
                log(f"COLMAP/train failed: {e}")
                traceback.print_exc()
                ply = None
        else:
            log("COLMAP binary not found on PATH")

        if ply is None or not ply.exists():
            # Prefer real SfM points over RGB billboards when COLMAP worked
            sparse0 = scene / "undistorted" / "sparse" / "0"
            if not (sparse0 / "points3D.bin").exists():
                sparse0 = scene / "distorted" / "sparse" / "0"
            if (sparse0 / "points3D.bin").exists() or (sparse0 / "points3D.txt").exists():
                try:
                    ply = _colmap_sparse_to_ply(sparse0, work / "colmap_sparse.ply")
                    pose_source = "colmap_sparse"
                    log("using COLMAP sparse cloud (train skipped — no CUDA rasterizer)")
                except Exception as e:
                    log(f"sparse export failed: {e}")
                    ply = None
            if ply is None or not ply.exists():
                if pose_source == "colmap":
                    pose_source = "colmap_then_rgb_fallback"
                else:
                    pose_source = "synthetic_no_colmap"
                ply = _rgb_fallback_ply(frames, work / "fallback_point_cloud.ply")

        thumb = work / "thumb.jpg"
        _thumbnail(video, thumb)

        ply_key = f"{user_id}/{job_id}/point_cloud.ply"
        ply_url = _upload_r2(ply, ply_key)
        thumb_url = None
        if thumb and thumb.exists():
            try:
                thumb_url = _upload_r2(thumb, f"{user_id}/{job_id}/thumb.jpg", content_type="image/jpeg")
            except Exception as e:
                log(f"thumb skip: {e}")

        result_meta = {
            **meta,
            "quick_splat": True,
            "quick_splat_path": "B",
            "ply_r2_key": ply_key,
            "ply_url": ply_url,
            "thumbnail_url": thumb_url,
            "frame_count": len(frames),
            "pose_source": pose_source,
            "train_ok": train_ok,
            "gs_iters": GS_ITERS if train_ok else 0,
            "max_side": MAX_SIDE,
            "pipeline": "fumoca_quick_splat_B",
            "completed_at": _now(),
        }
        _patch_job(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "nif_r2_key": ply_key,
                "file_size": ply.stat().st_size,
                "meta": result_meta,
                "completed_at": _now(),
                "error_message": None,
            },
        )
        log(f"PLY {ply.stat().st_size/1e6:.2f} MB pose={pose_source} train={train_ok}")
        log("DONE")
        return result_meta
    except Exception as e:
        log(f"FAILED: {e}")
        traceback.print_exc()
        try:
            _patch_job(job_id, {"status": "failed", "error_message": f"Quick Splat B: {str(e)[:1800]}", "progress": 0})
        except Exception:
            pass
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def process_job_id(job_id: str) -> dict:
    sb = _supabase()
    res = sb.table("reconstruction_jobs").select("*").eq("id", job_id).single().execute()
    job = res.data
    if not job:
        raise RuntimeError(f"Job not found: {job_id}")
    return run_quick_splat(job["id"], job["user_id"], job["raw_r2_key"], job.get("meta") or {})


def install_quick_splat_route() -> None:
    global _INSTALLED
    if _INSTALLED:
        log("route already installed")
        return
    log(f"mode={'ON' if QUICK_ON else 'OFF (use capture_mode=splat_only)'} path=B COLMAP+train")
    log(f"limits frames≤{MAX_FRAMES} side≤{MAX_SIDE} iters={GS_ITERS}")

    import fumoca_nif_worker as nw

    def main_quick():
        log("nif_worker.main wrapped by Quick Splat B")
        import traceback as tb
        import time as _time
        import sys as _sys

        SB = _supabase()
        POLL_SECONDS = int(os.environ.get("POLL_SECONDS", getattr(nw, "POLL_SECONDS", 15)))
        pipeline = None
        recon_dir = os.path.abspath(
            os.path.join(os.path.dirname(os.path.abspath(nw.__file__)), "..", "engine-next", "reconstruction")
        )
        if recon_dir not in _sys.path:
            _sys.path.insert(0, recon_dir)
        kaggle_dir = os.path.dirname(os.path.abspath(nw.__file__))
        if kaggle_dir not in _sys.path:
            _sys.path.insert(0, kaggle_dir)

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
            log(f"Claimed {job_id[:8]} mode={capture_mode} quick={_is_quick_job(capture_mode)}")
            if not raw_r2_key:
                SB.table("reconstruction_jobs").update(
                    {"status": "failed", "error_message": "Job has no raw_r2_key"}
                ).eq("id", job_id).execute()
                continue
            try:
                if _is_quick_job(capture_mode):
                    run_quick_splat(job_id, user_id, raw_r2_key, meta)
                else:
                    if pipeline is None:
                        import pipeline as _pipeline
                        pipeline = _pipeline
                    worker = pipeline.ReconstructionWorker(job_id, user_id)
                    if capture_mode == "mesh_only":
                        worker.run_mesh_only(raw_r2_key, meta)
                    else:
                        worker.run(raw_r2_key, vertical, capture_mode, meta)
                    log(f"{job_id[:8]}: complete (full pipeline)")
            except Exception as e:
                log(f"{job_id[:8]} FAILED: {e}")
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
    log("install_quick_splat_route OK")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        print(process_job_id(sys.argv[1]))
    else:
        print("Usage: python fumoca_quick_splat.py <job_id>")
