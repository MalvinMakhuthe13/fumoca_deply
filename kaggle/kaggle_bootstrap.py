import os
import subprocess
from pathlib import Path

GS_REPO_DIR = Path(os.getenv("GS_REPO_DIR", "/kaggle/working/gaussian-splatting"))


def run(cmd):
    print("[BOOT]", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


run(["python", "-m", "pip", "install", "-U", "pip", "setuptools", "wheel"])
run(["python", "-m", "pip", "install", "supabase>=2,<3", "httpx==0.28.1", "requests"])

if not GS_REPO_DIR.exists():
    run(["git", "clone", "https://github.com/graphdeco-inria/gaussian-splatting.git", "--recursive", str(GS_REPO_DIR)])

print("Bootstrap complete. Next: install COLMAP/ffmpeg if needed, build gaussian-splatting extensions, then run fumoca_kaggle_worker.py", flush=True)
