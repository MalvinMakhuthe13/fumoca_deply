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
# Do not upgrade numpy or Pillow. Kaggle ships them as a pair. A newer numpy
# breaks Pillow (`_center`, `_Ink`) and then every mask and frame read dies.
PACKAGES = [
    "gsplat>=1.0.0",
    "huggingface-hub>=0.23.0",
    "rembg>=2.0.57",
    "boto3>=1.34.0",
    "botocore>=1.34.0",
    "requests>=2.31.0",
    "imageio[ffmpeg]>=2.33.0",
    "supabase>=2.4.0",
    "httpx==0.28.1",
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
    print("[BOOT] colmap not on PATH — trying apt-get install colmap", flush=True)
    apt = subprocess.run(["apt-get", "update"], capture_output=True, text=True)
    inst = subprocess.run(["apt-get", "install", "-y", "colmap"], capture_output=True, text=True)
    if inst.returncode != 0 or shutil.which("colmap") is None:
        print("[BOOT] COLMAP still missing. The job will not die: poses fall back to an orbit")
        print("[BOOT] and the NIF is marked as that. Quality will be lower until colmap exists.")
        if apt.returncode != 0:
            print(apt.stderr[-400:])
    else:
        print("[BOOT] colmap installed", flush=True)

if shutil.which("ffmpeg") is None:
    print("[BOOT] WARNING: ffmpeg not found on PATH. Proxy video encoding will fail.")

print("[BOOT] Bootstrap complete. Next: python fumoca_nif_worker.py", flush=True)
