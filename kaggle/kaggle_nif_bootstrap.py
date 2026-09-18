"""
FUMOCA NIF Worker bootstrap.

Fresh-session bootstrap for Kaggle.

Responsibilities:
  - Load persistent Kaggle Secrets.
  - Restore pinned source dependencies from dependency-manifest/sources.json.
  - Install required Python packages.
  - Preserve the existing PyTorch/CUDA environment.
  - Reuse an already-working gsplat installation.
  - Install/use pinned local gsplat and SAM2 when necessary.
  - Verify CUDA, gsplat and the FUMOCA reconstruction pipeline.

REAL SECRETS ARE NEVER STORED IN THIS FILE OR IN GIT.
They are retrieved from Kaggle's Secrets store at runtime.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
THIRD_PARTY = REPO_ROOT / "third_party"
MANIFEST = REPO_ROOT / "dependency-manifest" / "sources.json"


def log(message):
    print(f"[BOOT] {message}", flush=True)


def run(cmd, check=True):
    log("$ " + " ".join(str(x) for x in cmd))
    return subprocess.run(cmd, check=check)


# ================================================================
# 1. Load persistent Kaggle Secrets
# ================================================================

FUMOCA_SECRETS = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "CF_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
]


def load_kaggle_secrets():
    try:
        from kaggle_secrets import UserSecretsClient
    except ImportError as exc:
        raise RuntimeError(
            "Kaggle Secrets API is unavailable. "
            "This bootstrap must run inside Kaggle."
        ) from exc

    client = UserSecretsClient()

    missing = []

    for name in FUMOCA_SECRETS:
        try:
            value = client.get_secret(name)
        except Exception as exc:
            log(f"{name}: unavailable")
            missing.append(name)
            continue

        if value:
            os.environ[name] = value
            log(f"{name}: loaded")
        else:
            missing.append(name)
            log(f"{name}: EMPTY")

    if missing:
        raise RuntimeError(
            "Missing FUMOCA Kaggle Secrets: " + ", ".join(missing)
        )

    log("All required FUMOCA secrets loaded.")


load_kaggle_secrets()


# ================================================================
# 2. Restore pinned repositories
# ================================================================

if not MANIFEST.exists():
    raise RuntimeError(f"Missing dependency manifest: {MANIFEST}")

with MANIFEST.open("r", encoding="utf-8-sig") as f:
    manifest = json.load(f)

dependencies = manifest.get("dependencies", {})

log(
    f"Dependency manifest loaded: "
    f"{manifest.get('project')} v{manifest.get('manifest_version')}"
)


# Core reconstruction dependencies required by the NIF pipeline.
CORE_REPOS = {
    "gsplat",
    "sam2",
    "colmap",
    "depth-anything-v2",
}


def restore_repo(name, spec):
    destination = THIRD_PARTY / name
    repository = spec["repository"]
    commit = spec["commit"]

    THIRD_PARTY.mkdir(parents=True, exist_ok=True)

    if destination.exists() and (destination / ".git").exists():
        try:
            current = subprocess.check_output(
                ["git", "-C", str(destination), "rev-parse", "HEAD"],
                text=True,
            ).strip()

            if current == commit:
                log(f"{name}: pinned commit already present ({commit[:12]})")
                return

            log(
                f"{name}: existing checkout is {current[:12]}, "
                f"switching to {commit[:12]}"
            )

            run(["git", "-C", str(destination), "fetch", "--all", "--tags"])

            run([
                "git", "-C", str(destination),
                "checkout", "--detach", commit
            ])

            return

        except Exception as exc:
            log(f"{name}: existing checkout unusable ({exc}); recreating")

            shutil.rmtree(destination, ignore_errors=True)

    log(f"{name}: cloning pinned commit {commit[:12]}")

    run([
        "git", "clone",
        repository,
        str(destination),
    ])

    run([
        "git", "-C", str(destination),
        "checkout", "--detach", commit,
    ])

    log(f"{name}: restored")


for name in sorted(CORE_REPOS):
    spec = dependencies.get(name)

    if not spec:
        raise RuntimeError(
            f"Required dependency '{name}' is missing from sources.json"
        )

    restore_repo(name, spec)


# Optional repositories are not cloned during normal reconstruction startup.
#
# Set:
#
#   FUMOCA_RESTORE_OPTIONAL_REPOS=1
#
# if/when the complete authoring/tooling stack is required.

if os.environ.get("FUMOCA_RESTORE_OPTIONAL_REPOS", "0") == "1":
    optional = set(dependencies) - CORE_REPOS

    for name in sorted(optional):
        restore_repo(name, dependencies[name])

    log("Optional dependency repositories restored.")
else:
    log(
        "Optional authoring repositories skipped. "
        "Set FUMOCA_RESTORE_OPTIONAL_REPOS=1 to restore them."
    )


# ================================================================
# 3. Python dependencies
#
# IMPORTANT:
# PyTorch/CUDA are deliberately NOT installed or upgraded here.
# ================================================================

PACKAGES = [
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


for package in PACKAGES:
    try:
        run([
            sys.executable,
            "-m",
            "pip",
            "install",
            package,
        ])
    except subprocess.CalledProcessError:
        log(
            f"WARNING: failed to install {package}; "
            "continuing."
        )


# ================================================================
# 4. gsplat
#
# Reuse a working installation whenever possible.
# ================================================================

GSPLAT_DIR = THIRD_PARTY / "gsplat"


def gsplat_is_importable():
    try:
        import gsplat
        from gsplat import rasterization
        return True
    except Exception:
        return False


if gsplat_is_importable():
    log("gsplat already importable — skipping rebuild.")
else:
    log("gsplat not importable — installing pinned local source.")

    run([
        sys.executable,
        "-m",
        "pip",
        "install",
        "-e",
        str(GSPLAT_DIR),
        "--no-build-isolation",
    ])

    if not gsplat_is_importable():
        raise RuntimeError("Pinned gsplat installation did not become importable.")

    log("Pinned gsplat installation: PASS")


# ================================================================
# 5. SAM2
# ================================================================

SAM2_DIR = THIRD_PARTY / "sam2"


def sam2_is_importable():
    try:
        import sam2
        return True
    except Exception:
        return False


if sam2_is_importable():
    log("SAM2 already importable — skipping reinstall.")
else:
    log("SAM2 not importable — installing pinned local source.")

    try:
        run([
            sys.executable,
            "-m",
            "pip",
            "install",
            "-e",
            str(SAM2_DIR),
            "--no-build-isolation",
        ])
    except subprocess.CalledProcessError:
        log(
            "WARNING: SAM2 installation failed. "
            "Pipeline may use its fallback segmentation path."
        )


# ================================================================
# 6. Executables
# ================================================================

if shutil.which("colmap") is None:
    log(
        "WARNING: COLMAP executable not found on PATH. "
        "Real COLMAP pose estimation will not be available until "
        "the binary is installed/configured."
    )
else:
    log("COLMAP: found")


if shutil.which("ffmpeg") is None:
    log(
        "WARNING: FFmpeg executable not found on PATH."
    )
else:
    log("FFmpeg: found")


# ================================================================
# 7. GPU verification
# ================================================================

import torch

log(
    f"PyTorch={torch.__version__}; "
    f"CUDA build={torch.version.cuda}; "
    f"CUDA available={torch.cuda.is_available()}"
)

if not torch.cuda.is_available():
    raise RuntimeError(
        "CUDA is unavailable. Enable a Kaggle GPU accelerator."
    )

log(f"GPU 0: {torch.cuda.get_device_name(0)}")

import gsplat
from gsplat import rasterization

log(
    f"gsplat={getattr(gsplat, '__version__', 'unknown')}; "
    "rasterization import: PASS"
)


# ================================================================
# 8. FUMOCA pipeline verification
# ================================================================

reconstruction_dir = REPO_ROOT / "engine-next" / "reconstruction"

if not reconstruction_dir.exists():
    raise RuntimeError(
        f"Missing reconstruction directory: {reconstruction_dir}"
    )

sys.path.insert(0, str(reconstruction_dir))

import pipeline

log("FUMOCA pipeline import: PASS")
log(f"RAW_BUCKET={pipeline.RAW_BUCKET}")
log(f"OUTPUT_BUCKET={pipeline.OUTPUT_BUCKET}")
log(f"DEVICE={pipeline.DEVICE}")


# ================================================================
# COMPLETE
# ================================================================

log("==================================================")
log("FUMOCA NIF BOOTSTRAP COMPLETE")
log("Environment is ready for fumoca_nif_worker.py")
log("==================================================")
