"""
FUMOCA NIF Worker bootstrap — installs deps for engine-next/reconstruction/pipeline.py

This is NOT the same as kaggle_bootstrap.py (which sets up the OLD worker's
raw gaussian-splatting repo clone). The new pipeline uses `gsplat` as a
library instead of cloning/building the graphdeco-inria repo, and needs
extra packages for depth estimation, background removal, segmentation, and
real mesh extraction (marching cubes) that the old worker never used.

Run this, then `python fumoca_nif_worker.py`.
"""

import subprocess
import shutil


def run(cmd):
    print("[BOOT]", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


run(["python", "-m", "pip", "install", "-U", "pip", "setuptools", "wheel"])

# Mirrors engine-next/reconstruction/requirements.txt — installed explicitly
# (rather than `pip install -r requirements.txt`) so a single bad line
# doesn't abort every other install on a fresh Kaggle container.
PACKAGES = [
    "gsplat>=1.0.0",
    "huggingface-hub>=0.23.0",
    "rembg[gpu]>=2.0.57",
    "boto3>=1.34.0",
    "botocore>=1.34.0",
    "requests>=2.31.0",
    "Pillow>=10.0.0",
    "imageio[ffmpeg]>=2.33.0",
    "supabase>=2.4.0",
    "httpx==0.28.1",
    "numpy>=1.24.0",
    "scipy>=1.11.0",
    "trimesh>=4.0.0",
    "scikit-image>=0.21.0",
    "manifold3d>=2.4.0",
]
for pkg in PACKAGES:
    try:
        run(["python", "-m", "pip", "install", pkg])
    except subprocess.CalledProcessError:
        print(f"[BOOT] WARNING: failed to install {pkg} — continuing, "
              f"pipeline.py will error clearly at runtime if it's actually needed.")

# SAM2 (Segment Anything 2) — optional, pipeline.py falls back to a
# single-segment mode if this import fails, so don't hard-fail bootstrap on it.
try:
    run(["python", "-m", "pip", "install",
         "git+https://github.com/facebookresearch/sam2.git"])
except subprocess.CalledProcessError:
    print("[BOOT] SAM2 install failed — pipeline will fall back to single-segment mode.")

if shutil.which("colmap") is None:
    print("[BOOT] WARNING: colmap binary not found on PATH. Camera pose estimation "
          "will fall back to synthetic poses (lower quality). Install COLMAP or set "
          "COLMAP_BIN to a working binary if you need real multi-view reconstruction.")

if shutil.which("ffmpeg") is None:
    print("[BOOT] WARNING: ffmpeg not found on PATH. Proxy video encoding will fail.")

print("[BOOT] Bootstrap complete. Next: python fumoca_nif_worker.py", flush=True)
