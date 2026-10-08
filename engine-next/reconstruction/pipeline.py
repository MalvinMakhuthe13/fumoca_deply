"""

# FUMOCA quality pass: depth-supervised Gaussian training + detail-preserving Poisson solid reconstruction.
NIF Reconstruction Pipeline — Complete
fumoca.co.za · © Fumoca Technologies

What this produces per .nif file:
  CHUNK 0x0002  PROXY_VIDEO    — H.264 proxy video (from input or rendered)
  CHUNK 0x0003  KEYFRAME_GEO   — full 3D depth field (all points, 14 floats each)
  CHUNK 0x0004  KEYFRAME_MESH  — real triangulated watertight mesh, extracted from
                                 the trained Gaussians (see stage 9 below)
  CHUNK 0x0007  DEPTH_MAP      — per-pixel depth (float16 HxW, reference frame). Metric
                                 (metres) only when CALIBRATION.method used the DepthAnything
                                 Metric checkpoint or an ArUco/manual reference — check
                                 CALIBRATION before assuming units.
  CHUNK 0x0008  ALPHA_MASK     — per-pixel foreground alpha (uint8 HxW, 0=bg, 255=fg)
  CHUNK 0x0009  LAYER_GEO      — layered depth field: foreground + background split
  CHUNK 0x0016  SEMANTIC_MAP   — per-Gaussian observed semantic region evidence (SAM/SAM2)
  CHUNK 0x001B  PART_GRAPH      — product-part graph linking observed regions to geometry evidence
  CHUNK 0x0017  CALIBRATION    — real-world scale record: method/scale_factor/confidence.
                                 See estimate_scale(). Always written (even when uncalibrated,
                                 so absence never has to be guessed at).
  CHUNK 0x0018  VERIFICATION   — product-verification report vs. a reference mesh. Only
                                 written when meta['verify_reference_r2_key'] is supplied.
                                 See verify.py.

Pipeline stages:
  1. Download raw capture from R2
  2. Extract frames (video → jpg sequence at 5fps)
  3. Neural deblurring (U-Net)
  4. Depth estimation — DepthAnything v2 (metric monocular depth from single frame)
  5. Background removal — rembg (U2-Net / BiRefNet) for clean alpha mask
  6. Segment Anything (SAM 2) — per-object segmentation for interactive layers
  7. Camera pose estimation — COLMAP sparse SfM
  8. 3D depth field training — gsplat v1.x
  9. Mesh extraction — production screened-Poisson reconstruction from the
     trained Gaussians. The learned Gaussian orientation and shortest axis are
     preserved as surface normals, then Poisson reconstructs a detailed solid
     surface. The previous oriented-TSDF/Marching-Cubes implementation remains
     as a dependency-light fallback. Neither path is a renamed point cloud.
  10. Layer splitting — divide points into foreground/background by depth + mask
  11. Proxy video encoding — ffmpeg H.264
  12. Pack all chunks → .nif binary
  13. Upload to R2
  14. Register in Supabase

Requirements:
  pip install gsplat torch torchvision rembg segment-anything-2 depth-anything boto3 \
              supabase trimesh scikit-image scipy open3d manifold3d fast_simplification \
              imageio[ffmpeg] Pillow requests
"""

import os
import sys
import math
import struct
import zlib
import time
import json
import shutil
import tempfile
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image, ImageFilter

# ─── Environment ─────────────────────────────────────────────────────────────
REQUIRED = ['CF_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY',
            'SUPABASE_URL','SUPABASE_SECRET_KEY']
_missing = [k for k in REQUIRED if not os.environ.get(k)]
if _missing:
    raise EnvironmentError(f"Missing env vars: {', '.join(_missing)}")

DEVICE     = 'cuda' if torch.cuda.is_available() else 'cpu'
# fumoca-production's real R2 layout is 5 separate buckets (see wrangler.jsonc),
# not one. Raw captures land in nif-videos (uploaded by js/modules/upload-page.js);
# everything this pipeline produces (.nif, proxy video, thumbnail, STL) goes to
# nif-files. A single R2_BUCKET var here would silently 404 on every download.
RAW_BUCKET    = os.environ.get('R2_RAW_BUCKET', 'nif-videos')
OUTPUT_BUCKET = os.environ.get('R2_OUTPUT_BUCKET', 'nif-files')
WORKER_KEY = os.environ.get('GPU_WORKER_SECRET', '')

import boto3
from botocore.config import Config
import requests

R2 = boto3.client('s3',
    endpoint_url=f"https://{os.environ['CF_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
    config=Config(signature_version='s3v4'),
)

from supabase import create_client as _sb_create
SB = _sb_create(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])

# ─── Dependency check ─────────────────────────────────────────────────────────
try:
    import gsplat
    print(f'[NIF] gsplat {getattr(gsplat,"__version__","?")} ready')
except ImportError:
    raise ImportError("gsplat required: pip install gsplat")

# ─── NIF binary constants ─────────────────────────────────────────────────────
NIF_MAGIC    = 0x4E494600
CHUNK_GEO    = 0x0003
CHUNK_MESH   = 0x0004  # Watertight triangle mesh — real triangulation, see _extract_mesh()
CHUNK_CAMERAS = 0x000B  # Per-frame 4×4 view matrices + pose_source — see _pack_cameras().
                         # Previously computed for Gaussian training and then discarded;
                         # nothing in the .nif persisted them, so a NIF-native viewer had
                         # no way to fly the original capture path or know how the scene
                         # was actually observed. This is now independent of CHUNK_GEO —
                         # deleting the Gaussian chunk no longer takes the cameras with it.
CHUNK_PRINT  = 0x0014  # Binary STL for 3D printing — verified real trimesh export, not a stub
CHUNK_PROXY  = 0x0002
CHUNK_DEPTH  = 0x0007
CHUNK_ALPHA  = 0x0008
CHUNK_LAYER  = 0x0009
CHUNK_CERT   = 0x0020  # Encoder certificate — fumoca INTERNAL tier
CHUNK_META   = 0x0001  # UTF-8 JSON: title/description/vertical/hotspots — same wire format
                        # NIFSpec.js's encodeMetaChunk()/decodeMetaChunk() use. Until this was
                        # added, pipeline.py never wrote it: title/vertical only ever lived in
                        # the Supabase `meta` column, so a .nif produced by this worker (as
                        # opposed to the JS editor's save path, which already writes this
                        # chunk) had no title and no hotspots if opened on its own — not
                        # actually "self-describing" per the spec's own stated design goal.
CHUNK_THUMB  = 0x0015  # Raw JPEG poster image, embedded — same reason as CHUNK_META above.
                        # Previously the thumbnail only existed as a separate thumb.jpg R2
                        # object; the .nif itself shipped with no poster image at all.
CHUNK_PHYSICS = 0x000C  # JSON, same schema encodePhysicsChunk()/decodePhysicsChunk() in
                        # NIFSpec.js use. _build_physics_chunk() (below) fills in one real
                        # whole-object rigid body — mass from actual mesh volume × a per-
                        # vertical density heuristic when possible, honestly flagged
                        # otherwise. This pipeline still has no way to know where a
                        # capture's hinges/joints are (that's authored, not reconstructed —
                        # per-part physics stays manual via NIFHingeAuthor.js). Writing it
                        # always (even with an empty bodies list, when mesh extraction
                        # failed) means every .nif has a well-formed PHYSICS chunk to
                        # append to later, rather than every downstream tool needing to
                        # handle "chunk may not exist at all" as a separate case.

# Encoder tier constants (must match NIFSpec.js ENCODER_TIER)
ENCODER_TIER_UNCERTIFIED = 0x00
ENCODER_TIER_DEVELOPER   = 0x01
ENCODER_TIER_COMMERCIAL  = 0x02
ENCODER_TIER_OEM         = 0x03
ENCODER_TIER_ENTERPRISE  = 0x04
ENCODER_TIER_INTERNAL    = 0xFF  # Fumoca pipeline — highest trust


def _build_cert_chunk(encoder_id: str, licensee_id: str, tier: int) -> bytes:
    """
    Build a CERT chunk for embedding in every NIF file.

    The certificate identifies the encoder that produced the file.
    Fumoca pipeline always uses INTERNAL tier — the highest trust level.
    Third-party licensed encoders use DEVELOPER/COMMERCIAL/OEM/ENTERPRISE.

    `tier` has no default on purpose. INTERNAL is Fumoca's own highest-trust
    tier — if a future external/licensed-encoder code path called this
    function and silently inherited a default, it would mint INTERNAL-trust
    certificates for files Fumoca didn't actually produce. Every caller must
    state the tier explicitly.

    Layout (128 bytes):
      [0]     tier:1         encoder tier byte
      [1..32] encoderId:32   ASCII encoder identifier
      [33..64] licenseeId:32 ASCII licensee name
      [65..68] issuedAt:4    Unix timestamp issued (uint32 BE)
      [69..72] expiresAt:4   0 = never expires (uint32 BE)
      [73..104] sig:32       HMAC-SHA256 (computed by sign_cert, zeros here for pipeline)
      [105..127] reserved:23 zero-padded

    The signature is zeros in the pipeline build — the API validates via
    the encoder registry in Supabase (encoder_id lookup), not the HMAC.
    Full HMAC signing is used when issuing encoder SDKs to licensees.
    """
    import time
    cert = bytearray(128)
    cert[0] = tier & 0xFF
    # encoderId — max 32 ASCII chars
    enc = encoder_id.encode('ascii')[:32]
    cert[1:1+len(enc)] = enc
    # licenseeId — max 32 ASCII chars
    lic = licensee_id.encode('ascii')[:32]
    cert[33:33+len(lic)] = lic
    # issuedAt — current time
    issued = int(time.time())
    cert[65] = (issued >> 24) & 0xFF
    cert[66] = (issued >> 16) & 0xFF
    cert[67] = (issued >>  8) & 0xFF
    cert[68] =  issued        & 0xFF
    # expiresAt = 0 (never for fumoca internal)
    cert[69] = cert[70] = cert[71] = cert[72] = 0
    # sig bytes [73..104] remain zero — validated by encoder registry
    return bytes(cert)
CHUNK_SEM    = 0x0016
CHUNK_CALIB  = 0x0017  # Real-world scale calibration record — see estimate_scale().
                        # Without this, mesh/STL/captured_dims are "correctly shaped,
                        # unknown size" (COLMAP/monocular-depth scale is arbitrary or
                        # per-model-relative, not metric on its own). Every consumer
                        # that cares about real units (print pipeline, product
                        # verification) reads scale_factor + confidence from here
                        # instead of assuming raw positions are already in metres.
CHUNK_VERIFY = 0x0018
CHUNK_ENCAPSULATION = 0x0019  # Evidence/policy record for whole-product encapsulation
CHUNK_APPEARANCE = 0x001A  # Full view-dependent Gaussian SH appearance master
CHUNK_PART_GRAPH = 0x001B  # Evidence-backed product part graph; names/animation are not guessed
                        # Legacy GEO keeps an RGB fallback; this chunk is the
                        # authoritative photorealistic appearance representation. — see verify.py. Only present
                        # when a reference mesh was supplied for this job; absence of
                        # this chunk means "not verified", not "passed verification".

CODEC_RAW  = 0x00
CODEC_GZIP = 0x02
MIN_COMPRESS = 1024  # don't compress tiny chunks

# See the Draco block in _extract_mesh() for why this used to default False:
# the JS read path didn't decode Draco. nif-format.js now has a real
# DRACOLoader-based decoder (see decodeMeshChunk/_decodeDracoMesh there), so
# it's a real path — but the encode/decode round trip has still NOT been run
# end-to-end against a real browser (no browser/wasm available from here to
# verify it, and test_draco_roundtrip.py only proves the Python side).
#
# DEFAULTING TO FALSE for the pilot: the goal of the first real capture is
# to prove the reconstruction pipeline itself (COLMAP → Gaussians → mesh →
# NIF) with as few unverified variables as possible. Draco introduces two
# unknowns at once (DracoPy's encode correctness, and THREE.DRACOLoader's
# decode of it) on top of everything else that's never been executed. The
# raw struct mesh format (flag 0x00) is the proven, always-works path —
# use it for pilot capture #1. Once that succeeds end-to-end in the viewer,
# flip this back to True and re-run specifically to check Draco's round
# trip (compare vertex/color count and values against the raw-format run
# of the same capture) — a targeted, isolated test instead of a variable
# riding along inside the very first real run.
ENABLE_DRACO_MESH = False

# ── Rough material-density heuristic, by vertical ───────────────────────────
# NOT measured per-object material — a single average kg/m³ per broad
# category, used only to turn a real (calibrated, watertight) mesh volume
# into a physically-plausible mass instead of an arbitrary placeholder.
# Genuinely wrong for any specific object (a "product" could be a phone or
# a couch) — this is a starting estimate for physics simulation to feel
# roughly right, not a materials-science claim. Always paired with a
# mass_estimation_method field in the PHYSICS chunk so nothing downstream
# mistakes this for a measured property.
VERTICAL_DENSITY_KG_M3 = {
    'fashion':      300.0,   # textile/leather, mostly-hollow garment shapes
    'product':      950.0,   # generic plastic/consumer-electronics average
    'travel':       950.0,   # luggage — plastic/fabric shells, mostly hollow
    'art':         1600.0,   # ceramic/resin/stone sculpture average — highly variable
    'architecture': 1900.0,  # masonry/model average — see note below, often not applicable
    'music':        500.0,   # instruments — wood, hollow resonant bodies
    'food':         800.0,   # varies enormously; below water density on average (hollow/porous)
    'other':       1000.0,   # neutral default — water-like density
}
DEFAULT_DENSITY_KG_M3 = 1000.0
# Verticals where a single-object rigid-body mass estimate is usually
# meaningless (a building, a landscape, a whole street) — physics still gets
# a valid chunk, but mass_estimation_method is set to 'not_applicable'
# rather than producing a nonsense multi-tonne "object."
PHYSICS_NOT_APPLICABLE_VERTICALS = {'architecture', 'travel'}


def _build_physics_chunk(mesh_info: dict | None, vertical: str, calibration: dict, meta: dict) -> dict:
    """
    Builds a real PHYSICS chunk instead of the permanently-empty
    {'bodies': [], 'constraints': []} skeleton this used to hardcode.

    Scope, deliberately: ONE rigid body representing the whole reconstructed
    object. Per-part / multi-body physics (e.g. a hinge on a laptop lid)
    needs object-part segmentation, which this pipeline doesn't do yet — that
    stays a separate, future feature (and is exactly what the in-browser
    NIFHingeAuthorPanel + window._fumocaAuthoredPhysicsChunk passthrough
    already covers for manually-authored cases; see publish-to-fumoca.js).

    Mass is only computed from real geometry when it can be trusted:
      - mesh_info is None (mesh extraction failed) → no bodies at all,
        same honest empty chunk as before.
      - mesh not watertight → trimesh volume is not reliable (can be
        wildly wrong or negative on an open surface), so mass falls back
        to a flagged placeholder rather than a fake-precise number.
      - not calibrated (confidence == 'none') → volume is in an arbitrary
        reconstruction-space unit, not real m³, so a "kg" mass would be
        fiction. Falls back to the same flagged placeholder.
      - watertight AND calibrated → mass = real_volume_m3 × density
        heuristic for this vertical. Real geometry, heuristic material —
        method is labeled exactly that, never claimed as "measured."
    """
    OBJECT_ID = 'root'  # single whole-object body; see docstring on scope
    FALLBACK_MASS_KG = 1.0  # generic placeholder when volume can't be trusted

    if mesh_info is None:
        return {'bodies': [], 'constraints': []}

    density = VERTICAL_DENSITY_KG_M3.get(vertical, DEFAULT_DENSITY_KG_M3)
    trustworthy_volume = bool(mesh_info.get('is_watertight')) and calibration.get('confidence') not in (None, 'none')

    if vertical in PHYSICS_NOT_APPLICABLE_VERTICALS:
        mass_kg = None
        mass_estimation_method = 'not_applicable'
        note = (f"vertical='{vertical}' is usually a scene/structure, not a single graspable "
                f"object — mass estimation skipped rather than producing a nonsense value.")
    elif trustworthy_volume:
        mass_kg = round(mesh_info['volume_m3'] * density, 4)
        mass_estimation_method = 'geometry_volume_x_density_heuristic'
        note = (f"mass = real mesh volume ({mesh_info['volume_m3']:.6f} m³, watertight, "
                f"calibration confidence={calibration.get('confidence')}) × {density} kg/m³ "
                f"heuristic density for vertical='{vertical}'. Volume is real; density is a "
                f"category average, not a measured material property.")
    else:
        mass_kg = FALLBACK_MASS_KG
        mass_estimation_method = 'placeholder_uncalibrated'
        reasons = []
        if not mesh_info.get('is_watertight'):
            reasons.append('mesh is not watertight (volume would be unreliable)')
        if calibration.get('confidence') in (None, 'none'):
            reasons.append('capture is not calibrated (no real-world scale)')
        note = (f"mass is a generic {FALLBACK_MASS_KG}kg placeholder, NOT derived from geometry — "
                f"{'; '.join(reasons)}.")

    body = {
        'objectId': OBJECT_ID,
        'type': 'rigid',
        'mass': mass_kg,
        'mass_estimation_method': mass_estimation_method,
        'note': note,
        'friction': 0.5,       # generic mid-range default, not per-object measured
        'restitution': 0.2,    # generic low-bounce default
        'collisionShape': 'mesh',  # references this file's own KEYFRAME_MESH chunk
    }
    return {'bodies': [body], 'constraints': []}



def _compress(data: bytes) -> tuple[bytes, int]:
    """Compress with gzip. Return (data, codec).
    Only uses compressed version if it's at least 5% smaller."""
    if len(data) < MIN_COMPRESS:
        return data, CODEC_RAW
    compressed = zlib.compress(data, level=6, wbits=31)  # wbits=31 = gzip format
    if len(compressed) < len(data) * 0.95:
        return compressed, CODEC_GZIP
    return data, CODEC_RAW


def _chunk(ctype: int, data: bytes, codec: int = None) -> bytes:
    """Pack a single chunk. If codec is None, auto-compress."""
    if codec is None:
        # Auto-compress: skip already-compressed formats
        no_compress = {CHUNK_PROXY}  # H.264 is already compressed
        if ctype in no_compress:
            codec = CODEC_RAW
        else:
            data, codec = _compress(data)
    crc = zlib.crc32(data) & 0xFFFFFFFF
    hdr = struct.pack('>HBxIIxxxx', ctype, codec, len(data), crc)
    return hdr + data

def _write_ascii(buf: bytearray, offset: int, s: str, maxlen: int):
    b = s.encode('ascii', errors='replace')[:maxlen].ljust(maxlen, b'\x00')
    buf[offset:offset+maxlen] = b

def pack_nif(chunks: list, vertical: str, fps: int = 30) -> bytes:
    """Pack a list of (chunk_type, data_bytes) into a complete .nif binary."""
    hdr = bytearray(256)
    struct.pack_into('>I', hdr, 0,  NIF_MAGIC)
    hdr[4], hdr[5] = 1, 2          # NIF 1.2 — calibration, verification, SH appearance and semantic evidence
    struct.pack_into('>q', hdr, 8,  int(time.time() * 1000))
    hdr[16] = 0                     # CRS: LOCAL
    struct.pack_into('>H', hdr, 18, 1)   # frameCount
    struct.pack_into('>f', hdr, 20, 0.0) # duration
    hdr[24] = fps
    _write_ascii(hdr, 56, 'video', 16)
    _write_ascii(hdr, 72, vertical, 24)
    _write_ascii(hdr, 96, 'FUMOCA_NIF_1.0', 32)

    # ── Encoder certificate ────────────────────────────────────────────────────
    # Every NIF file produced by the fumoca pipeline carries a CERT chunk.
    # INTERNAL tier — highest trust. Viewer shows no watermark.
    # Third-party licensed encoders embed their own CERT via the encoder SDK.
    cert_data = _build_cert_chunk(
        encoder_id   = 'FUMOCA_INTERNAL_PIPELINE_V1',
        licensee_id  = 'Fumoca Technologies',
        tier         = ENCODER_TIER_INTERNAL,
    )
    cert_chunk  = _chunk(CHUNK_CERT, cert_data, codec=CODEC_RAW)
    chunk_data  = cert_chunk + b''.join(_chunk(ct, d) for ct, d in chunks)
    return bytes(hdr) + chunk_data


# ─── Stage 1: Neural Deblurring ───────────────────────────────────────────────
class _ResBlock(nn.Module):
    def __init__(self, ci, co):
        super().__init__()
        self.body = nn.Sequential(nn.Conv2d(ci,co,3,1,1), nn.GELU(), nn.Conv2d(co,co,3,1,1))
        self.skip = nn.Conv2d(ci,co,1) if ci!=co else nn.Identity()
        self.act  = nn.GELU()
    def forward(self, x): return self.act(self.body(x) + self.skip(x))

class DeblurNet(nn.Module):
    def __init__(self, c=48):
        super().__init__()
        self.enc = nn.Sequential(_ResBlock(3,c), _ResBlock(c,c*2))
        self.mid = _ResBlock(c*2, c*2)
        self.dec = nn.Sequential(_ResBlock(c*2,c), nn.Conv2d(c,3,1))
    def forward(self, x):
        e = self.enc(x)
        return torch.tanh(self.dec(self.mid(e)) + x)


# ─── Stage 2: Depth estimation (DepthAnything v2) ─────────────────────────────
def estimate_depth(frames: list[np.ndarray], vertical: str = '') -> tuple[list[np.ndarray], bool]:
    """
    Estimate depth for each frame using DepthAnything v2.
    Returns (depth_maps, is_metric) — depth_maps is a list of float32 (H, W)
    arrays; is_metric tells the caller whether those values are real metres
    or an arbitrary relative scale.

    IMPORTANT — this used to claim "metric depth in metres" unconditionally
    while actually loading 'depth-anything/Depth-Anything-V2-Large', which is
    the *relative*-depth checkpoint. DepthAnything only produces true metric
    output from its separately fine-tuned Metric-Indoor/Metric-Outdoor
    checkpoints. That mismatch meant every downstream "_m" field
    (captured_dims, STL) was silently trusting units that were never actually
    metric. Fixed here: try the real metric checkpoint first, and — critically
    — tell the caller which one we actually got so it can decide whether to
    trust these values directly or lean on estimate_scale() instead.
    """
    indoor_verticals = {'furniture', 'realestate', 'interior', 'retail'}
    metric_variant = 'Metric-Indoor-Large' if vertical in indoor_verticals else 'Metric-Outdoor-Large'
    try:
        from depth_anything_v2.dpt import DepthAnythingV2
        from huggingface_hub import hf_hub_download
        model = DepthAnythingV2(encoder='vitl', features=256, out_channels=[256,512,1024,1024],
                                 max_depth=20 if 'Indoor' in metric_variant else 80)
        ckpt = hf_hub_download(f'depth-anything/Depth-Anything-V2-{metric_variant}',
                                f'depth_anything_v2_metric_{"indoor" if "Indoor" in metric_variant else "outdoor"}_vitl.pth')
        model.load_state_dict(torch.load(ckpt, map_location='cpu'))
        model = model.to(DEVICE).eval()
        print(f'[NIF] DepthAnything v2 {metric_variant} loaded (real metric depth, metres)')

        depths = []
        with torch.no_grad():
            for frame in frames:
                depth = model.infer_image(frame)  # returns numpy H×W float32, metres
                depths.append(depth)
        return depths, True

    except Exception as e:
        print(f'[NIF] Metric DepthAnything v2 unavailable ({e}) — trying relative checkpoint')

    try:
        from depth_anything_v2.dpt import DepthAnythingV2
        from huggingface_hub import hf_hub_download
        model = DepthAnythingV2(encoder='vitl', features=256, out_channels=[256,512,1024,1024])
        ckpt = hf_hub_download('depth-anything/Depth-Anything-V2-Large', 'depth_anything_v2_vitl.pth')
        model.load_state_dict(torch.load(ckpt, map_location='cpu'))
        model = model.to(DEVICE).eval()
        print('[NIF] DepthAnything v2 ViT-L loaded (RELATIVE depth — not metres, needs calibration)')

        depths = []
        with torch.no_grad():
            for frame in frames:
                depth = model.infer_image(frame)
                depths.append(depth)
        return depths, False

    except ImportError:
        print('[NIF] DepthAnything v2 not available — using MiDaS fallback')
        return _midas_depth(frames), False

def _midas_depth(frames):
    """MiDaS relative depth fallback (relative, not metric but still useful for separation)."""
    try:
        midas = torch.hub.load('intel-isl/MiDaS', 'MiDaS_small', trust_repo=True).to(DEVICE).eval()
        transforms = torch.hub.load('intel-isl/MiDaS', 'transforms', trust_repo=True)
        transform  = transforms.small_transform
        depths = []
        with torch.no_grad():
            for frame in frames:
                inp = transform(frame).to(DEVICE)
                d   = midas(inp).squeeze().cpu().numpy()
                d   = (d - d.min()) / (d.max() - d.min() + 1e-8)  # normalise to [0,1]
                depths.append(d.astype(np.float32))
        return depths
    except Exception as e:
        print(f'[NIF] Depth estimation failed: {e} — using linear fallback')
        return [np.ones((f.shape[0], f.shape[1]), dtype=np.float32) for f in frames]


# ─── Stage 2b: Real-world scale calibration ───────────────────────────────────
def estimate_scale(ref_frame: np.ndarray, depth_map: np.ndarray, is_metric_depth: bool,
                    meta: dict) -> dict:
    """
    Determine the scale factor that turns reconstruction-space units into real
    metres, and how much to trust it. Tries, in order of preference:

      1. ArUco marker in frame with a known physical size (meta['calibration_
         marker_size_m']) — solvePnP gives the marker's real depth from the
         camera; comparing that to the (relative or metric) depth map's value
         at the marker's pixel gives an exact scale factor, independent of
         whatever the depth model itself produces. This is the only method
         that also corrects a *metric* model's residual scale drift, not just
         a relative model's missing scale.
      2. A manually supplied reference measurement (meta['reference_size_m'] +
         meta['reference_pixel_span'], e.g. a user-entered "this edge is
         30cm" from the capture UI).
      3. The metric depth model's own output, taken as-is (medium confidence —
         single-image metric depth models are known to drift, typically
         5-15% error on real objects, but that's still far better than an
         arbitrary SfM/relative-depth scale).
      4. Nothing — explicitly reported as uncalibrated rather than silently
         assumed to be metres.

    Returns {method, scale_factor, confidence, units, note}. scale_factor is
    the multiplier to apply to reconstruction-space positions to get metres;
    None if nothing could be determined.
    """
    marker_size_m = meta.get('calibration_marker_size_m')
    if marker_size_m:
        try:
            import cv2
            gray = cv2.cvtColor(ref_frame, cv2.COLOR_RGB2GRAY)
            aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
            detector = cv2.aruco.ArucoDetector(aruco_dict, cv2.aruco.DetectorParameters())
            corners, ids, _ = detector.detectMarkers(gray)
            if ids is not None and len(corners) > 0:
                h, w = gray.shape
                # Approximate intrinsics from image size — no calibration file
                # available at this stage of the pipeline, so this uses the
                # common "focal length ≈ image width" heuristic (roughly right
                # for typical phone camera FOVs, logged so it's not mistaken
                # for a real calibrated intrinsics matrix).
                focal = w
                K = np.array([[focal, 0, w/2], [0, focal, h/2], [0, 0, 1]], dtype=np.float64)
                dist = np.zeros(5)
                obj_pts = np.array([
                    [-marker_size_m/2,  marker_size_m/2, 0],
                    [ marker_size_m/2,  marker_size_m/2, 0],
                    [ marker_size_m/2, -marker_size_m/2, 0],
                    [-marker_size_m/2, -marker_size_m/2, 0],
                ], dtype=np.float64)
                ok, rvec, tvec = cv2.solvePnP(obj_pts, corners[0][0], K, dist)
                if ok:
                    real_depth_m = float(tvec[2][0])
                    cx, cy = corners[0][0].mean(axis=0)
                    px, py = int(np.clip(cx, 0, w-1)), int(np.clip(cy, 0, h-1))
                    depth_at_marker = float(depth_map[py, px])
                    if depth_at_marker > 1e-6:
                        scale_factor = real_depth_m / depth_at_marker
                        return {
                            'method': 'aruco_marker', 'scale_factor': scale_factor,
                            'confidence': 'high', 'units': 'meters',
                            'note': f'ArUco marker {marker_size_m}m, approx intrinsics '
                                    f'(focal≈image width) — real distance {real_depth_m:.3f}m',
                        }
        except Exception as e:
            print(f'[NIF] ArUco calibration failed ({e}) — falling back')

    ref_size_m = meta.get('reference_size_m')
    ref_pixel_span = meta.get('reference_pixel_span')
    if ref_size_m and ref_pixel_span:
        try:
            h, w = depth_map.shape
            cy, cx = h // 2, w // 2
            depth_at_center = float(depth_map[cy, cx])
            angular_span = ref_pixel_span / w
            if depth_at_center > 1e-6 and angular_span > 1e-6:
                approx_real_span = 2 * depth_at_center * np.tan(angular_span / 2)
                scale_factor = float(ref_size_m) / max(approx_real_span, 1e-6)
                return {
                    'method': 'manual_reference', 'scale_factor': scale_factor,
                    'confidence': 'medium', 'units': 'meters',
                    'note': f'User-supplied reference: {ref_size_m}m spanning '
                            f'{ref_pixel_span}px',
                }
        except Exception as e:
            print(f'[NIF] Manual reference calibration failed ({e}) — falling back')

    if is_metric_depth:
        return {
            'method': 'metric_depth_model', 'scale_factor': 1.0,
            'confidence': 'medium', 'units': 'meters',
            'note': 'DepthAnything v2 metric checkpoint output taken as-is — '
                    'no independent reference to correct residual model drift '
                    '(typically 5-15% on real objects).',
        }

    return {
        'method': 'none', 'scale_factor': None,
        'confidence': 'none', 'units': 'unknown',
        'note': 'No calibration marker, no manual reference, and depth model '
                'output is relative — mesh/dims are shape-correct only, NOT '
                'dimensionally trustworthy. Do not use for measurement, '
                'printing, or verification without adding a calibration input.',
    }


# ─── Stage 3: Background removal (rembg / BiRefNet) ──────────────────────────
def remove_background(frames: list[np.ndarray]) -> list[np.ndarray]:
    """
    Remove background from each frame using rembg (U2-Net/BiRefNet).
    Returns list of uint8 alpha masks (H, W), 0=background, 255=foreground.
    Also handles the 'extract subject from background' use case (Coca-Cola can etc).
    """
    try:
        from rembg import remove as rembg_remove, new_session
        # BiRefNet is the highest quality model for product shots
        # Falls back to u2net if not downloaded
        try:
            session = new_session('birefnet-general')
            print('[NIF] Using BiRefNet for background removal')
        except Exception:
            session = new_session('u2net')
            print('[NIF] Using U2Net for background removal')

        masks = []
        for frame in frames:
            pil = Image.fromarray(frame)
            result = rembg_remove(pil, session=session, only_mask=True)
            mask = np.array(result.convert('L'))  # grayscale alpha
            masks.append(mask)
        return masks

    except ImportError:
        print('[NIF] rembg not available — using depth-based threshold fallback')
        return _depth_threshold_masks(frames)

def _depth_threshold_masks(frames):
    """
    Dependency-free foreground fallback using border-colour separation.

    The previous fallback classified pixels using global brightness. That is
    unreliable for coloured objects on coloured backgrounds because both the
    object and background can have similar brightness.

    Instead, estimate the background colour from the image borders, measure
    colour distance from that background, then clean the resulting mask with
    lightweight PIL morphology. This keeps the fallback usable when rembg,
    SAM2 and OpenCV are unavailable.
    """
    masks = []

    for frame in frames:
        h, w = frame.shape[:2]

        # Work at reduced resolution so the fallback stays cheap even for
        # 4K/12MP source frames.
        max_side = 768
        scale = min(1.0, max_side / float(max(h, w)))
        sh = max(32, int(round(h * scale)))
        sw = max(32, int(round(w * scale)))

        small = Image.fromarray(
            frame.astype(np.uint8),
            mode='RGB'
        ).resize(
            (sw, sh),
            Image.Resampling.BILINEAR
        )

        arr = np.asarray(small).astype(np.float32)

        # Estimate background colour from a border band. Using multiple
        # borders makes this much more robust than a single corner sample.
        band = max(2, min(sh, sw) // 32)

        border_pixels = np.concatenate([
            arr[:band].reshape(-1, 3),
            arr[-band:].reshape(-1, 3),
            arr[:, :band].reshape(-1, 3),
            arr[:, -band:].reshape(-1, 3),
        ], axis=0)

        bg_colour = np.median(
            border_pixels,
            axis=0
        )

        # Euclidean colour distance from the estimated background.
        dist = np.sqrt(
            np.sum(
                (arr - bg_colour[None, None, :]) ** 2,
                axis=2
            )
        )

        border_dist = np.concatenate([
            dist[:band].reshape(-1),
            dist[-band:].reshape(-1),
            dist[:, :band].reshape(-1),
            dist[:, -band:].reshape(-1),
        ])

        # Adaptive threshold. The floor prevents nearly uniform backgrounds
        # from producing an all-foreground mask, while the percentile keeps
        # the threshold tied to the actual capture.
        p90 = float(np.percentile(border_dist, 90))
        p99 = float(np.percentile(border_dist, 99))

        threshold = max(
            18.0,
            min(70.0, p90 * 2.5 + (p99 - p90) * 0.5)
        )

        mask_small = (
            dist > threshold
        ).astype(np.uint8) * 255

        # Morphological cleanup using PIL only:
        # MaxFilter closes tiny holes/gaps; MinFilter removes isolated noise.
        mask_img = Image.fromarray(mask_small, mode='L')

        kernel = 5 if min(sh, sw) >= 256 else 3

        mask_img = mask_img.filter(
            ImageFilter.MaxFilter(kernel)
        )
        mask_img = mask_img.filter(
            ImageFilter.MinFilter(kernel)
        )

        # A second, slightly stronger cleanup helps remove thin background
        # fragments without requiring OpenCV/scipy.
        if min(sh, sw) >= 256:
            mask_img = mask_img.filter(
                ImageFilter.MinFilter(5)
            )
            mask_img = mask_img.filter(
                ImageFilter.MaxFilter(5)
            )

        # Return to the original frame resolution.
        mask_full = mask_img.resize(
            (w, h),
            Image.Resampling.BILINEAR
        )

        mask = np.asarray(mask_full).astype(np.uint8)

        # Keep the mask binary-ish while retaining antialiased boundaries.
        mask = np.where(
            mask >= 96,
            255,
            0
        ).astype(np.uint8)

        masks.append(mask)

    return masks


# ─── Stage 4: Segment Anything (SAM 2) ────────────────────────────────────────
def segment_objects(frame: np.ndarray, alpha_mask: np.ndarray) -> dict:
    """
    Run SAM 2 on the foreground region to get per-object segments.
    Returns {segment_id: {'mask': np.ndarray, 'bbox': [x,y,w,h], 'label': int}}
    Falls back to single foreground segment if SAM not available.
    """
    try:
        from sam2.build_sam import build_sam2
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

        # Use the small model for Kaggle T4 memory constraints
        sam2 = build_sam2('sam2_hiera_small.yaml', device=DEVICE)
        gen  = SAM2AutomaticMaskGenerator(
            model=sam2,
            points_per_side=16,        # fewer points = faster, still good for products
            pred_iou_thresh=0.85,
            stability_score_thresh=0.90,
            min_mask_region_area=500,  # filter tiny segments
        )

        # Only segment the foreground pixels
        fg_frame = frame.copy()
        fg_frame[alpha_mask < 128] = 0  # zero out background

        masks_data = gen.generate(fg_frame)
        segments = {}
        for i, m in enumerate(masks_data[:20]):  # cap at 20 segments
            segments[i] = {
                'mask':  m['segmentation'].astype(np.uint8) * 255,
                'bbox':  m['bbox'],
                'label': i,
                'area':  m['area'],
                'score': m['predicted_iou'],
            }
        print(f'[NIF] SAM 2: {len(segments)} segments')
        return segments

    except (ImportError, Exception) as e:
        print(f'[NIF] SAM 2 not available ({e}) — single foreground segment')
        return {0: {'mask': alpha_mask, 'bbox': [0,0,frame.shape[1],frame.shape[0]], 'label':0, 'area':int(alpha_mask.sum()/255), 'score':1.0}}


def track_primary_object(frames: list, alpha_masks: list) -> list:
    """
    Track the primary foreground object across every frame using SAM 2's
    *video* predictor — a genuinely different API from segment_objects()
    above, which only ever sees one frame at a time and has no concept of
    "the same object in frame 40 as frame 1". This is real identity
    tracking: one object ID, propagated through the whole sequence, using
    SAM 2's internal memory mechanism rather than independent per-frame
    detection.

    Seeding: rather than requiring a manual click/box, the seed box is
    derived automatically from alpha_masks[0]'s largest connected
    foreground component — reusing background removal's own reference-
    frame mask as "here's roughly where the object is" for frame 0, then
    letting the video predictor's tracking do the rest across all frames.

    Returns a list of per-frame masks (same length/shape convention as
    alpha_masks). Falls back to returning alpha_masks UNCHANGED if sam2's
    video predictor isn't installed, or if tracking fails for any reason
    (e.g. wrong config/checkpoint filenames for a given install) — same
    fallback philosophy as segment_objects() above: this is degraded
    (independent per-frame masks instead of a tracked object identity),
    not broken, so the pipeline keeps running rather than failing the job.

    CAVEAT: written against SAM 2's documented video predictor API
    (init_state / add_new_points_or_box / propagate_in_video) but not
    executed here — no GPU or SAM 2 install in this environment. The
    config/checkpoint filenames below are guesses at common defaults, not
    verified paths — check they match what's actually on disk wherever
    this runs, and expect to correct them.
    """
    if len(frames) < 2:
        return alpha_masks

    try:
        from sam2.build_sam import build_sam2_video_predictor
        import cv2

        config_file = os.environ.get('FUMOCA_SAM2_VIDEO_CONFIG', 'sam2_hiera_s.yaml')
        checkpoint  = os.environ.get('FUMOCA_SAM2_VIDEO_CHECKPOINT', 'sam2_hiera_small.pt')
        predictor = build_sam2_video_predictor(config_file, checkpoint, device=DEVICE)

        # SAM 2's video predictor expects a directory of frame images on
        # disk, not in-memory arrays — write them out to a scratch dir.
        frame_dir = Path(tempfile.mkdtemp(prefix='sam2_track_'))
        try:
            for i, f in enumerate(frames):
                cv2.imwrite(str(frame_dir / f'{i:05d}.jpg'), cv2.cvtColor(f, cv2.COLOR_RGB2BGR))

            inference_state = predictor.init_state(video_path=str(frame_dir))

            # Seed box from alpha_masks[0]'s largest connected foreground
            # component — this is what "identify primary object" resolves
            # to automatically, no manual prompt needed.
            fg = (alpha_masks[0] > 127).astype(np.uint8)
            n_labels, labels = cv2.connectedComponents(fg)
            if n_labels <= 1:
                print('[NIF] No foreground component in alpha_masks[0] — skipping video tracking')
                return alpha_masks
            sizes = [(labels == i).sum() for i in range(1, n_labels)]
            largest_label = 1 + int(np.argmax(sizes))
            ys, xs = np.where(labels == largest_label)
            box = np.array([xs.min(), ys.min(), xs.max(), ys.max()], dtype=np.float32)

            predictor.add_new_points_or_box(inference_state, frame_idx=0, obj_id=1, box=box)

            tracked_masks = [None] * len(frames)
            for out_frame_idx, out_obj_ids, out_mask_logits in predictor.propagate_in_video(inference_state):
                m = (out_mask_logits[0] > 0.0).cpu().numpy().astype(np.uint8) * 255
                if m.ndim == 3:
                    m = m[0]
                tracked_masks[out_frame_idx] = m

            # Any frame the predictor didn't cover (shouldn't normally
            # happen) falls back to that frame's own bg-removal mask rather
            # than leaving None in the list.
            for i in range(len(frames)):
                if tracked_masks[i] is None:
                    tracked_masks[i] = alpha_masks[i]

            print(f'[NIF] SAM 2 video tracking: object propagated across {len(frames)} frames '
                  f'(seed box from alpha_masks[0], one tracked identity throughout)')
            return tracked_masks
        finally:
            shutil.rmtree(frame_dir, ignore_errors=True)

    except (ImportError, Exception) as e:
        print(f'[NIF] SAM 2 video tracking not available ({e}) — using per-frame '
              f'background-removal masks instead (no cross-frame object identity)')
        return alpha_masks


def _encapsulation_report(mesh_info: dict | None, poses: list | None,
                          surface_geo: np.ndarray | None,
                          object_masks: list | None, alpha_masks: list | None) -> dict:
    """Build a compact evidence map showing which reconstructed surface regions
    are supported by actual capture viewpoints.

    This is intentionally an evidence map, not a visibility solver. A camera
    being on the "front" side of a product does not prove every front-facing
    polygon was visible. Later FUMOCA layers can add depth/ray visibility,
    confidence and semantic-part evidence.

    Most importantly, this function never converts a closed mesh into a claim
    that hidden/interior/underside geometry was recovered.
    """
    mesh_ok = bool(mesh_info and mesh_info.get('is_watertight')
                   and mesh_info.get('is_winding_consistent')
                   and mesh_info.get('is_volume'))

    foreground_frames = 0
    if alpha_masks:
        for m in alpha_masks:
            try:
                if float(np.mean(np.asarray(m) > 0.15)) > 0.005:
                    foreground_frames += 1
            except Exception:
                pass

    pose_count = len(poses or [])
    declared_complete = bool(
        os.environ.get('FUMOCA_CAPTURE_COMPLETE', '').lower() in ('1', 'true', 'yes')
    )

    # Recover camera centres from COLMAP/synthetic world->camera matrices:
    # C = -R^T t. Keep this tolerant because older pose records may be tuples
    # carrying a frame name alongside the matrix.
    camera_centres = []
    for pose in (poses or []):
        try:
            vm = pose[1] if isinstance(pose, tuple) else pose
            vm = vm.detach().cpu().numpy() if hasattr(vm, 'detach') else np.asarray(vm)
            R = np.asarray(vm[:3, :3], dtype=np.float64)
            t = np.asarray(vm[:3, 3], dtype=np.float64)
            C = -R.T @ t
            if np.all(np.isfinite(C)):
                camera_centres.append(C)
        except Exception:
            continue

    # Use the reconstructed product centre as the directional origin.
    # COLMAP's world origin is arbitrary, so using the raw camera coordinates
    # directly would make "front/rear/left/right" depend on SfM translation.
    surface_center = None
    if surface_geo is not None:
        try:
            p = np.asarray(surface_geo[:, :3], dtype=np.float64)
            p = p[np.all(np.isfinite(p), axis=1)]
            if len(p):
                surface_center = np.median(p, axis=0)
        except Exception:
            surface_center = None
    if surface_center is None:
        surface_center = np.zeros(3, dtype=np.float64)

    # Coarse directional cells are the first practical layer of the
    # Encapsulation Map. They are deliberately semantic-neutral: later stages
    # can replace/augment them with true per-surface visibility.
    region_defs = [
        ('front',        np.array([0., 0., 1.])),
        ('rear',         np.array([0., 0., -1.])),
        ('right',        np.array([1., 0., 0.])),
        ('left',         np.array([-1., 0., 0.])),
        ('top',          np.array([0., 1., 0.])),
        ('bottom',       np.array([0., -1., 0.])),
        ('front_right',  np.array([1., 0., 1.])),
        ('front_left',   np.array([-1., 0., 1.])),
        ('rear_right',   np.array([1., 0., -1.])),
        ('rear_left',    np.array([-1., 0., -1.])),
        ('top_front',    np.array([0., 1., 1.])),
        ('top_rear',     np.array([0., 1., -1.])),
        ('bottom_front', np.array([0., -1., 1.])),
        ('bottom_rear',  np.array([0., -1., -1.])),
    ]

    cells = []
    for name, direction in region_defs:
        direction = direction / max(np.linalg.norm(direction), 1e-8)
        support = []
        for i, C in enumerate(camera_centres):
            v = C - surface_center
            norm = np.linalg.norm(v)
            if norm > 1e-8:
                score = float(np.dot(v / norm, direction))
                if score >= 0.35:
                    support.append(i)
        cells.append({
            'region': name,
            'supporting_views': len(support),
            'support_view_indices': support[:32],
            'confidence': (
                'confident' if len(support) >= 3 else
                'weak' if len(support) >= 1 else
                'unsupported'
            ),
            'reconstructed_surface_samples': 0,
        })

    # Attach reconstructed-surface evidence to cells. We sample deterministically
    # so a huge Gaussian cloud does not explode NIF metadata size.
    if surface_geo is not None:
        try:
            pts = np.asarray(surface_geo[:, :3], dtype=np.float64)
            pts = pts[np.all(np.isfinite(pts), axis=1)]
            if len(pts):
                center = np.median(pts, axis=0)
                rel = pts - center
                radius = np.linalg.norm(rel, axis=1)
                valid = radius > 1e-8
                rel = rel[valid]
                if len(rel) > 50_000:
                    idx = np.linspace(0, len(rel) - 1, 50_000, dtype=np.int64)
                    rel = rel[idx]

                # Each sample contributes to its strongest coarse direction.
                dirs = np.stack([d / max(np.linalg.norm(d), 1e-8) for _, d in region_defs])
                unit = rel / np.maximum(np.linalg.norm(rel, axis=1, keepdims=True), 1e-8)
                best = np.argmax(unit @ dirs.T, axis=1)
                for i, (_, d) in enumerate(region_defs):
                    cells[i]['reconstructed_surface_samples'] = int(np.count_nonzero(best == i))
        except Exception as e:
            print(f'[NIF] Encapsulation surface sampling skipped: {e}')

    for cell in cells:
        if cell['reconstructed_surface_samples'] > 0 and cell['supporting_views'] == 0:
            cell['confidence'] = 'unsupported_surface'
        elif cell['reconstructed_surface_samples'] == 0:
            cell['confidence'] = 'no_reconstructed_surface'

    confident_regions = sum(c['confidence'] == 'confident' for c in cells)
    weak_regions = sum(c['confidence'] == 'weak' for c in cells)
    unsupported_regions = sum(c['confidence'] == 'unsupported_surface' for c in cells)
    empty_regions = sum(c['confidence'] == 'no_reconstructed_surface' for c in cells)

    if not mesh_ok:
        status = 'not_reconstructed'
    elif declared_complete:
        status = 'encapsulated_declared'
    elif confident_regions >= 8 and unsupported_regions == 0:
        status = 'surface_encapsulated_unverified'
    elif confident_regions >= 4 or weak_regions >= 6:
        status = 'partial_surface_evidence'
    else:
        status = 'surface_evidence_insufficient'

    return {
        'status': status,
        'solid_closed': mesh_ok,
        'foreground_frames': foreground_frames,
        'pose_count': pose_count,
        'camera_centres_recovered': len(camera_centres),
        'coverage_cells': cells,
        'coverage_summary': {
            'confident_regions': confident_regions,
            'weak_regions': weak_regions,
            'unsupported_surface_regions': unsupported_regions,
            'regions_without_reconstructed_surface': empty_regions,
        },
        'complete_coverage_declared': declared_complete,
        'unseen_geometry_claimed': False,
        'evidence_policy': 'directional_surface_coverage_only',
        'policy': (
            'Camera-direction support indicates useful capture viewpoints but '
            'is not proof that every surface point was visible. Hidden, interior, '
            'underside and occluded geometry require direct capture evidence or '
            'explicit authored geometry. A closed mesh alone never upgrades that claim.'
        ),
    }

def _surface_camera_evidence(surface_geo: np.ndarray | None, poses: list | None,
                             alpha_masks: list | None, image_shape=None) -> dict:
    """Estimate per-surface support from projected camera observations.

    Level 2 of the Encapsulation Map: unlike the coarse directional layer,
    this tests individual reconstructed samples against real camera geometry.
    A sample is supported when it projects inside a foreground mask and its
    estimated surface normal faces the camera.

    This is deliberately called *projection evidence*, not visibility proof:
    without a depth buffer/ray cast we cannot know whether another surface
    occludes the sample. That stronger visibility test is the next layer.
    """
    if surface_geo is None or poses is None or not len(poses):
        return {
            'status': 'unavailable',
            'surface_samples': 0,
            'supported_samples': 0,
            'support_ratio': 0.0,
            'occlusion_tested': False,
        }

    try:
        pts = np.asarray(surface_geo[:, :3], dtype=np.float64)
        finite = np.all(np.isfinite(pts), axis=1)
        pts = pts[finite]
        if not len(pts):
            raise ValueError('no finite surface points')

        # Deterministic sample cap keeps metadata bounded.
        if len(pts) > 25_000:
            pts = pts[np.linspace(0, len(pts) - 1, 25_000, dtype=np.int64)]

        # Gaussian shortest-axis orientation is our surface-normal proxy.
        log_scales = np.asarray(surface_geo[:, 3:6], dtype=np.float64)[finite]
        quats = np.asarray(surface_geo[:, 6:10], dtype=np.float64)[finite]
        axis_idx = np.argmin(log_scales, axis=1)
        qn = quats / np.maximum(np.linalg.norm(quats, axis=1, keepdims=True), 1e-8)
        qw, qx, qy, qz = qn[:,0], qn[:,1], qn[:,2], qn[:,3]
        R = np.empty((len(qn), 3, 3), dtype=np.float64)
        R[:,0,0]=1-2*(qy*qy+qz*qz); R[:,0,1]=2*(qx*qy-qz*qw); R[:,0,2]=2*(qx*qz+qy*qw)
        R[:,1,0]=2*(qx*qy+qz*qw); R[:,1,1]=1-2*(qx*qx+qz*qz); R[:,1,2]=2*(qy*qz-qx*qw)
        R[:,2,0]=2*(qx*qz-qy*qw); R[:,2,1]=2*(qy*qz+qx*qw); R[:,2,2]=1-2*(qx*qx+qy*qy)
        normals = R[np.arange(len(R)), :, axis_idx]
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-8)

        # Match the deterministic sample selection used above.
        if len(finite.nonzero()[0]) > 25_000:
            source_idx = np.linspace(0, len(finite.nonzero()[0]) - 1, 25_000, dtype=np.int64)
            normals = normals[source_idx]

        H, W = image_shape or ((alpha_masks[0].shape if alpha_masks else (0,0)))
        if H <= 0 or W <= 0:
            raise ValueError('image dimensions unavailable')
        fx = fy = max(H, W) * 0.8
        cx, cy = W / 2.0, H / 2.0

        support_counts = np.zeros(len(pts), dtype=np.uint16)
        facing_counts = np.zeros(len(pts), dtype=np.uint16)
        foreground_counts = np.zeros(len(pts), dtype=np.uint16)

        for i, pose in enumerate(poses):
            vm = pose[1] if isinstance(pose, tuple) else pose
            vm = vm.detach().cpu().numpy() if hasattr(vm, 'detach') else np.asarray(vm)
            Rw = vm[:3,:3].astype(np.float64)
            tw = vm[:3,3].astype(np.float64)
            cam = (Rw @ pts.T).T + tw
            z = cam[:,2]
            valid = z > 1e-6
            u = fx * cam[:,0] / np.maximum(z, 1e-8) + cx
            v = fy * cam[:,1] / np.maximum(z, 1e-8) + cy
            inside = valid & (u >= 0) & (u < W) & (v >= 0) & (v < H)

            # Camera-facing test. Normal sign is ambiguous, so use the absolute
            # dot product: the sample can be oriented either way by a Gaussian.
            C = -Rw.T @ tw
            to_camera = C[None,:] - pts
            to_camera /= np.maximum(np.linalg.norm(to_camera, axis=1, keepdims=True), 1e-8)
            facing = np.abs(np.einsum('ij,ij->i', normals, to_camera)) >= 0.35
            facing_counts += (inside & facing).astype(np.uint16)

            if alpha_masks and i < len(alpha_masks):
                mask = np.asarray(alpha_masks[i])
                if mask.ndim > 2:
                    mask = mask.squeeze()
                uu = np.clip(np.rint(u).astype(np.int64), 0, W-1)
                vv = np.clip(np.rint(v).astype(np.int64), 0, H-1)
                fg = np.zeros(len(pts), dtype=bool)
                valid_idx = np.where(inside)[0]
                fg[valid_idx] = mask[vv[valid_idx], uu[valid_idx]] > 32
                foreground_counts += (inside & fg).astype(np.uint16)

            support_counts += (inside & facing).astype(np.uint16)

        supported = support_counts > 0
        strong = support_counts >= 2
        foreground_supported = foreground_counts > 0

        return {
            'status': 'available',
            'surface_samples': int(len(pts)),
            'supported_samples': int(np.count_nonzero(supported)),
            'strongly_supported_samples': int(np.count_nonzero(strong)),
            'foreground_supported_samples': int(np.count_nonzero(foreground_supported)),
            'support_ratio': float(np.mean(supported)),
            'strong_support_ratio': float(np.mean(strong)),
            'foreground_support_ratio': float(np.mean(foreground_supported)),
            'mean_support_views': float(np.mean(support_counts)),
            'occlusion_tested': False,
            'depth_consistency_tested': False,
            'policy': (
                'Projected surface support combines camera projection, foreground '
                'mask evidence and Gaussian surface orientation. It is not a true '
                'visibility test because occlusion/depth-buffer testing is not yet applied.'
            ),
        }
    except Exception as e:
        return {
            'status': 'error',
            'surface_samples': 0,
            'supported_samples': 0,
            'support_ratio': 0.0,
            'occlusion_tested': False,
            'error': str(e),
        }




def _semantic_part_evidence(surface_geo: np.ndarray | None, segments: dict | None,
                             pose, image_shape=None, geometry_confidence: dict | None = None) -> dict:
    """Level 5 evidence from observed SAM/SAM2 regions; never guesses product names."""
    base = {
        'status': 'unavailable', 'level': 5, 'encoding': 'uint8_per_gaussian',
        'unknown_label': 255, 'gaussian_count': 0, 'assigned_count': 0,
        'assignment_ratio': 0.0, 'parts': [],
        'policy': 'SAM/SAM2 region IDs are evidence regions, not guessed product names.'
    }
    if surface_geo is None or not segments or pose is None or not image_shape:
        return base
    try:
        raw = np.asarray(surface_geo, dtype=np.float32)
        n = len(raw)
        labels = np.full(n, 255, dtype=np.uint8)
        confidence = np.zeros(n, dtype=np.float32)
        H, W = int(image_shape[0]), int(image_shape[1])
        fx = fy = max(H, W) * 0.8
        cx, cy = W * 0.5, H * 0.5
        vm = pose[1] if isinstance(pose, tuple) else pose
        vm = vm.detach().cpu().numpy() if hasattr(vm, 'detach') else np.asarray(vm)
        cam = (vm[:3, :3] @ raw[:, :3].T + vm[:3, 3:4]).T
        z = cam[:, 2]
        u = fx * cam[:, 0] / np.maximum(z, 1e-8) + cx
        v = fy * cam[:, 1] / np.maximum(z, 1e-8) + cy
        valid = np.all(np.isfinite(raw[:, :3]), axis=1) & (z > 1e-6) & (u >= 0) & (u < W) & (v >= 0) & (v < H)
        items = []
        for sid, seg in sorted(segments.items(), key=lambda kv: int(kv[0])):
            mask = np.asarray(seg.get('mask'))
            if mask.ndim >= 2 and mask.shape[:2] == (H, W):
                items.append((int(sid), mask > 32, float(seg.get('score', 0.0)),
                              int(seg.get('area', np.count_nonzero(mask)))))
        if not items:
            return base
        votes = {sid: 0 for sid, *_ in items}
        sums = {sid: 0.0 for sid, *_ in items}
        score_by_sid = {sid: score for sid, _, score, _ in items}
        for j in np.flatnonzero(valid):
            x = int(np.clip(round(float(u[j])), 0, W - 1))
            y = int(np.clip(round(float(v[j])), 0, H - 1))
            candidates = [(score, -sid, sid) for sid, mask, score, _ in items if mask[y, x]]
            if not candidates:
                continue
            _, _, sid = max(candidates)
            labels[j] = np.uint8(sid if sid < 255 else 254)
            gc = 0.5
            if geometry_confidence:
                try:
                    # Level 4 samples are sparse; index them once rather than scanning
                    # the confidence sample list for every Gaussian (O(N*8192) worst case).
                    confidence_by_index = geometry_confidence.get('_confidence_by_index')
                    if confidence_by_index is None:
                        confidence_by_index = {
                            int(rec.get('index', -1)): float(rec.get('confidence', 0.5))
                            for rec in geometry_confidence.get('samples', [])
                            if int(rec.get('index', -1)) >= 0
                        }
                        geometry_confidence['_confidence_by_index'] = confidence_by_index
                    gc = float(confidence_by_index.get(int(j), 0.5))
                except Exception:
                    pass
            sem_score = float(np.clip(0.70 * score_by_sid[sid] + 0.30 * gc, 0.0, 1.0))
            confidence[j] = sem_score
            votes[sid] += 1
            sums[sid] += sem_score
        parts = []
        for sid, mask, sam_score, area in items:
            count = votes[sid]
            parts.append({
                'part_id': sid, 'source': 'sam2_reference_frame',
                'name': None, 'name_status': 'unassigned',
                'sam_score': sam_score, 'image_area_px': area,
                'assigned_gaussians': count,
                'mean_confidence': sums[sid] / max(count, 1),
                'interactive_ready': False
            })
        base.update({
            'status': 'available', 'gaussian_count': n,
            'assigned_count': int(np.count_nonzero(labels != 255)),
            'assignment_ratio': float(np.mean(labels != 255)),
            'labels': labels.tolist(), 'confidence': confidence.tolist(),
            'parts': parts
        })
        return base
    except Exception as e:
        base['status'] = 'error'
        base['error'] = str(e)
        return base

def _surface_geometry_confidence(surface_geo: np.ndarray | None,
                                  encapsulation: dict | None,
                                  mesh_info: dict | None,
                                  poses: list | None,
                                  object_masks: list | None,
                                  depth_maps: list | None,
                                  image_shape=None) -> dict:
    """Build Level 4 geometry-confidence evidence for reconstructed surface samples.

    Confidence is about *observed reconstruction reliability*, never about whether
    unseen geometry exists. Each sampled Gaussian gets a deterministic score from:
      1. camera/foreground support,
      2. depth consistency / occlusion evidence,
      3. Gaussian opacity,
      4. Gaussian shape stability,
      5. global mesh validity.

    The returned sample records are intentionally bounded so the ENCAPSULATION
    JSON chunk remains usable. The canonical GEO/mesh remain authoritative.
    """
    base = {
        'status': 'unavailable',
        'level': 4,
        'surface_samples': 0,
        'confident_samples': 0,
        'supported_samples': 0,
        'uncertain_samples': 0,
        'unsupported_samples': 0,
        'occluded_samples': 0,
        'mean_confidence': 0.0,
        'confidence_percentiles': [0.0, 0.0, 0.0, 0.0, 0.0],
        'mesh_quality_factor': 0.0,
        'evidence_weights': {
            'camera_support': 0.35,
            'depth_consistency': 0.30,
            'gaussian_stability': 0.20,
            'mesh_validity': 0.15,
        },
        'samples': [],
        'policy': (
            'Geometry confidence estimates reliability of observed/reconstructed '
            'surface samples. It is not semantic identity, proof of hidden geometry, '
            'or permission to fabricate unseen product surfaces.'
        ),
    }
    if surface_geo is None:
        return base

    try:
        raw = np.asarray(surface_geo, dtype=np.float32)
        finite = np.all(np.isfinite(raw[:, :14]), axis=1)
        idx_all = np.flatnonzero(finite)
        if not len(idx_all):
            return base

        # Deterministic sampling, biased toward the complete reconstructed surface
        # rather than whichever points happened to occur first.
        cap = max(256, min(int(os.environ.get('FUMOCA_CONFIDENCE_SAMPLES', '8192')), 16384))
        if len(idx_all) > cap:
            sample_idx = np.linspace(0, len(idx_all) - 1, cap, dtype=np.int64)
            idx = idx_all[sample_idx]
        else:
            idx = idx_all
        pts = raw[idx]
        n = len(pts)

        # Gaussian-native stability evidence.
        opacity = 1.0 / (1.0 + np.exp(-np.clip(pts[:, 10], -20, 20)))
        scales = np.exp(np.clip(pts[:, 3:6], -8, 2))
        max_scale = np.max(scales, axis=1)
        min_scale = np.min(scales, axis=1)
        anisotropy = np.clip(1.0 - (min_scale / np.maximum(max_scale, 1e-8)), 0.0, 1.0)
        opacity_score = np.clip((opacity - 0.08) / 0.72, 0.0, 1.0)
        # Very large, nearly isotropic splats are less surface-specific. Small
        # anisotropic splats are generally better localized surface evidence.
        scale_score = np.clip(1.0 - max_scale / (np.median(max_scale) * 4.0 + 1e-8), 0.0, 1.0)
        gaussian_stability = np.clip(0.65 * opacity_score + 0.20 * anisotropy + 0.15 * scale_score, 0, 1)

        # Mesh validity is a global prerequisite, not a substitute for observation.
        if mesh_info:
            mesh_quality_factor = 1.0
            if not mesh_info.get('is_watertight'): mesh_quality_factor *= 0.70
            if not mesh_info.get('is_winding_consistent'): mesh_quality_factor *= 0.75
            if not mesh_info.get('is_volume'): mesh_quality_factor *= 0.75
            if mesh_info.get('nonmanifold_edges', 0): mesh_quality_factor *= 0.75
            if mesh_info.get('boundary_edges', 0): mesh_quality_factor *= 0.80
            if mesh_info.get('n_degenerate_faces') not in (None, 0): mesh_quality_factor *= 0.90
        else:
            mesh_quality_factor = 0.0

        # Camera support per sample.
        support_counts = np.zeros(n, dtype=np.float32)
        foreground_counts = np.zeros(n, dtype=np.float32)
        depth_consistent = np.zeros(n, dtype=np.float32)
        depth_occluded = np.zeros(n, dtype=np.float32)
        depth_tested = np.zeros(n, dtype=np.float32)

        if poses and image_shape:
            H, W = int(image_shape[0]), int(image_shape[1])
            fx = fy = max(H, W) * 0.8
            cx, cy = W * 0.5, H * 0.5
            # Per-frame depth mappings are derived from the full sampled surface,
            # then applied to these confidence samples. This avoids treating
            # monocular depth as metric.
            for fi, pose in enumerate(poses):
                if fi >= len(depth_maps or []):
                    break
                try:
                    vm = pose[1] if isinstance(pose, tuple) else pose
                    vm = vm.detach().cpu().numpy() if hasattr(vm, 'detach') else np.asarray(vm)
                    cam = (vm[:3, :3] @ pts[:, :3].T + vm[:3, 3:4]).T
                    z = cam[:, 2]
                    valid = z > 1e-6
                    u = fx * cam[:, 0] / np.maximum(z, 1e-8) + cx
                    v = fy * cam[:, 1] / np.maximum(z, 1e-8) + cy
                    inside = valid & (u >= 0) & (u < W) & (v >= 0) & (v < H)
                    if not np.any(inside):
                        continue
                    support_counts[inside] += 1

                    mask = object_masks[fi] if object_masks and fi < len(object_masks) else None
                    if mask is not None:
                        mm = np.asarray(mask)
                        if mm.ndim >= 2:
                            yy = np.clip(np.rint(v[inside]).astype(np.int64), 0, H - 1)
                            xx = np.clip(np.rint(u[inside]).astype(np.int64), 0, W - 1)
                            fg = mm[yy, xx] > 32
                            inside_idx = np.flatnonzero(inside)
                            foreground_counts[inside_idx[fg]] += 1

                    dm = depth_maps[fi]
                    if dm is None:
                        continue
                    dd = np.asarray(dm, dtype=np.float32)
                    if dd.ndim < 2:
                        continue
                    yy = np.clip(np.rint(v[inside]).astype(np.int64), 0, H - 1)
                    xx = np.clip(np.rint(u[inside]).astype(np.int64), 0, W - 1)
                    observed = dd[yy, xx]
                    inside_idx = np.flatnonzero(inside)
                    finite_d = np.isfinite(observed) & (observed > 0)
                    if not np.any(finite_d):
                        continue

                    pred = z[inside_idx][finite_d]
                    obs = observed[finite_d]
                    # Use the projected sample population itself to fit the
                    # relative-depth relationship, matching Level 3's policy.
                    p10, p50, p90 = np.percentile(pred, [10, 50, 90])
                    o10, o50, o90 = np.percentile(obs, [10, 50, 90])
                    pspan = max(float(p90 - p10), 1e-6)
                    slope = float(o90 - o10) / pspan
                    intercept = float(o50 - slope * p50)
                    mapped = slope * pred + intercept
                    tolerance = max(float(o90 - o10) * 0.20, 1e-6)
                    residual = obs - mapped
                    tested_idx = inside_idx[finite_d]
                    consistent = np.abs(residual) <= tolerance
                    occluded = residual < -tolerance
                    depth_tested[tested_idx] += 1
                    depth_consistent[tested_idx[consistent]] += 1
                    depth_occluded[tested_idx[occluded]] += 1
                except Exception:
                    continue

        support_score = np.clip(support_counts / 3.0, 0.0, 1.0)
        foreground_score = np.clip(foreground_counts / np.maximum(support_counts, 1.0), 0.0, 1.0)
        camera_support = np.clip(0.70 * support_score + 0.30 * foreground_score, 0.0, 1.0)

        tested = depth_tested > 0
        depth_score = np.zeros(n, dtype=np.float32)
        depth_score[tested] = np.clip(
            depth_consistent[tested] / np.maximum(depth_tested[tested], 1.0), 0.0, 1.0
        )
        depth_score[~tested] = 0.0

        confidence = (
            0.35 * camera_support +
            0.30 * depth_score +
            0.20 * gaussian_stability +
            0.15 * mesh_quality_factor
        )
        # No observation support means the sample cannot become "confident"
        # merely because its Gaussian/mesh looks mathematically clean.
        confidence = np.where(support_counts > 0, confidence, confidence * 0.35)
        confidence = np.clip(confidence, 0.0, 1.0)

        occluded = (depth_occluded > 0) & (depth_consistent == 0)
        unsupported = support_counts == 0
        supported = (support_counts > 0) & (confidence >= 0.55) & ~occluded
        uncertain = ~(supported | unsupported | occluded)

        def pct(q):
            return [float(x) for x in np.percentile(confidence, q)]

        records = []
        for j in range(n):
            records.append({
                'index': int(idx[j]),
                'position': [float(x) for x in pts[j, :3]],
                'confidence': round(float(confidence[j]), 4),
                'camera_support_views': int(support_counts[j]),
                'foreground_support_views': int(foreground_counts[j]),
                'depth_tested_views': int(depth_tested[j]),
                'depth_consistent_views': int(depth_consistent[j]),
                'depth_occluded_views': int(depth_occluded[j]),
                'class': (
                    'occluded' if occluded[j] else
                    'unsupported' if unsupported[j] else
                    'confident' if supported[j] else
                    'uncertain'
                ),
            })

        base.update({
            'status': 'available',
            'surface_samples': n,
            'confident_samples': int(np.sum(supported)),
            'supported_samples': int(np.sum(support_counts > 0)),
            'uncertain_samples': int(np.sum(uncertain)),
            'unsupported_samples': int(np.sum(unsupported)),
            'occluded_samples': int(np.sum(occluded)),
            'mean_confidence': float(np.mean(confidence)),
            'confidence_percentiles': pct([0, 25, 50, 75, 100]),
            'mesh_quality_factor': float(mesh_quality_factor),
            'samples': records,
            'depth_evidence_available': bool(np.any(depth_tested > 0)),
            'policy': (
                'Level 4 combines observed camera support, foreground/depth evidence, '
                'Gaussian stability and mesh validity. A high score means the sampled '
                'surface is well supported by the capture; it does not mean unseen '
                'geometry has been recovered.'
            ),
        })
        return base
    except Exception as e:
        base['status'] = 'error'
        base['error'] = str(e)
        return base

def _surface_depth_visibility_evidence(surface_geo: np.ndarray | None,
                                    poses: list | None,
                                    alpha_masks: list | None,
                                    depth_maps: list | None,
                                    image_shape=None) -> dict:
    """Estimate whether reconstructed surface points are depth-consistent.

    Level 3 of the Encapsulation Map. Projection alone cannot distinguish a
    visible surface from one hidden behind another part of the product. This
    stage samples the reconstructed surface, projects it into each capture
    camera, and compares its camera-space depth with the observed foreground
    depth.

    DepthAnything may be relative rather than metric, so raw depth values are
    never compared directly to reconstruction metres. For each frame, a
    robust affine mapping is estimated from the foreground/projected sample
    population using percentile anchors. The resulting residual is evidence
    of visibility consistency, not a claim of metric depth.

    A point is:
      - depth_consistent when observed and reconstructed depth agree within
        the robust tolerance;
      - depth_occluded when the observed foreground surface is materially
        closer than the reconstructed point;
      - depth_inconsistent when the relationship cannot explain the point.

    This deliberately does not fabricate geometry for unsupported regions.
    """
    base = {
        'status': 'unavailable',
        'surface_samples': 0,
        'foreground_projected_samples': 0,
        'depth_consistent_samples': 0,
        'depth_occluded_samples': 0,
        'depth_inconsistent_samples': 0,
        'visibility_ratio': 0.0,
        'occlusion_ratio': 0.0,
        'depth_consistency_tested': False,
        'occlusion_tested': False,
    }
    if surface_geo is None or poses is None or not len(poses) or not depth_maps:
        return base

    try:
        raw = np.asarray(surface_geo, dtype=np.float64)
        finite = np.all(np.isfinite(raw[:, :10]), axis=1)
        pts_all = raw[finite, :3]
        if not len(pts_all):
            return base

        # Deterministic cap. Keep the same source rows for points, scale and
        # quaternion so later evidence always refers to the same surface.
        source_rows = np.flatnonzero(finite)
        if len(source_rows) > 25_000:
            source_rows = source_rows[np.linspace(0, len(source_rows) - 1, 25_000, dtype=np.int64)]
        pts = raw[source_rows, :3]

        H, W = image_shape or ((depth_maps[0].shape if depth_maps and depth_maps[0] is not None else (0, 0)))
        if H <= 0 or W <= 0:
            raise ValueError('image dimensions unavailable')

        fx = fy = max(H, W) * 0.8
        cx, cy = W / 2.0, H / 2.0

        consistent = np.zeros(len(pts), dtype=bool)
        occluded = np.zeros(len(pts), dtype=bool)
        inconsistent = np.zeros(len(pts), dtype=bool)
        foreground_any = np.zeros(len(pts), dtype=bool)
        tested_any = np.zeros(len(pts), dtype=bool)
        support_counts = np.zeros(len(pts), dtype=np.uint16)

        frame_reports = []

        for i, pose in enumerate(poses):
            if i >= len(depth_maps) or depth_maps[i] is None:
                continue

            vm = pose[1] if isinstance(pose, tuple) else pose
            vm = vm.detach().cpu().numpy() if hasattr(vm, 'detach') else np.asarray(vm)
            Rw = vm[:3, :3].astype(np.float64)
            tw = vm[:3, 3].astype(np.float64)

            cam = (Rw @ pts.T).T + tw
            z = cam[:, 2]
            valid = np.isfinite(z) & (z > 1e-6)

            u = fx * cam[:, 0] / np.maximum(z, 1e-8) + cx
            v = fy * cam[:, 1] / np.maximum(z, 1e-8) + cy
            inside = valid & (u >= 0) & (u < W) & (v >= 0) & (v < H)
            if not np.any(inside):
                continue

            depth = np.asarray(depth_maps[i], dtype=np.float64)
            if depth.ndim > 2:
                depth = np.squeeze(depth)
            if depth.shape != (H, W):
                continue

            uu = np.clip(np.rint(u).astype(np.int64), 0, W - 1)
            vv = np.clip(np.rint(v).astype(np.int64), 0, H - 1)
            observed = depth[vv, uu]

            fg = inside & np.isfinite(observed) & (observed > 0)
            if alpha_masks and i < len(alpha_masks):
                mask = np.asarray(alpha_masks[i])
                if mask.ndim > 2:
                    mask = np.squeeze(mask)
                if mask.shape == (H, W):
                    fg &= mask[vv, uu] > 32

            foreground_any |= fg
            idx = np.where(fg)[0]
            if len(idx) < 64:
                continue

            # Robust per-frame relationship between reconstruction camera
            # depth and observed monocular depth. Percentile anchors avoid
            # pretending the two coordinate systems share units.
            pred = z[idx]
            obs = observed[idx]
            p10, p50, p90 = np.percentile(pred, [10, 50, 90])
            o10, o50, o90 = np.percentile(obs, [10, 50, 90])
            p_span = max(float(p90 - p10), 1e-8)
            o_span = max(float(o90 - o10), 1e-8)

            # Map predicted depth into observed-depth coordinates. The mapping
            # is intentionally only used to test consistency; it is not stored
            # as a metric calibration.
            slope = o_span / p_span
            intercept = o50 - slope * p50
            expected = slope * pred + intercept
            residual = obs - expected

            # Scale the residual by the observed robust spread. A 20% spread
            # tolerates monocular-depth noise while still exposing surfaces
            # that are materially behind the observed foreground surface.
            tolerance = max(o_span * 0.20, 1e-6)
            abs_ok = np.abs(residual) <= tolerance

            # Negative residual means the observed foreground is closer than
            # the reconstructed point after mapping: that is the signature of
            # likely occlusion.
            likely_occluded = residual < -tolerance
            likely_inconsistent = (~abs_ok) & (~likely_occluded)

            tested_any[idx] = True
            support_counts[idx] += abs_ok.astype(np.uint16)
            consistent[idx] |= abs_ok
            occluded[idx] |= likely_occluded
            inconsistent[idx] |= likely_inconsistent

            frame_reports.append({
                'frame': int(i),
                'projected_foreground_samples': int(len(idx)),
                'depth_consistent_samples': int(np.count_nonzero(abs_ok)),
                'depth_occluded_samples': int(np.count_nonzero(likely_occluded)),
                'depth_inconsistent_samples': int(np.count_nonzero(likely_inconsistent)),
                'observed_depth_metric': False,
                'mapping': 'robust_percentile_affine',
                'tolerance_fraction_of_observed_p10_p90_span': 0.20,
            })

        tested = tested_any
        if not np.any(tested):
            return {
                **base,
                'status': 'insufficient_depth_evidence',
                'surface_samples': int(len(pts)),
                'foreground_projected_samples': int(np.count_nonzero(foreground_any)),
                'depth_consistency_tested': False,
                'occlusion_tested': False,
            }

        # Any point with at least one consistent view is supported. A point
        # repeatedly classified as occluded/inconsistent but never consistent
        # remains uncertain rather than being silently deleted.
        depth_consistent = consistent & tested
        depth_occluded = occluded & ~depth_consistent
        depth_inconsistent = inconsistent & ~depth_consistent & ~depth_occluded

        return {
            'status': 'available',
            'surface_samples': int(len(pts)),
            'foreground_projected_samples': int(np.count_nonzero(foreground_any)),
            'tested_samples': int(np.count_nonzero(tested)),
            'depth_consistent_samples': int(np.count_nonzero(depth_consistent)),
            'depth_occluded_samples': int(np.count_nonzero(depth_occluded)),
            'depth_inconsistent_samples': int(np.count_nonzero(depth_inconsistent)),
            'visibility_ratio': float(np.mean(depth_consistent[foreground_any])) if np.any(foreground_any) else 0.0,
            'occlusion_ratio': float(np.mean(depth_occluded[tested])) if np.any(tested) else 0.0,
            'depth_consistency_tested': True,
            'occlusion_tested': True,
            'frame_reports': frame_reports[:64],
            'policy': (
                'Depth visibility is evidence, not hidden-geometry recovery. '
                'Per-frame observed depth is robustly related to reconstruction '
                'depth because monocular depth may be relative. A surface that '
                'is consistently deeper than the observed foreground is marked '
                'likely occluded/uncertain; no unseen geometry is invented.'
            ),
        }
    except Exception as e:
        return {
            **base,
            'status': 'error',
            'error': str(e),
        }


def _mesh_quality_report(mesh, method: str, detail_tier: str) -> dict:
    """Return explicit geometry/printability diagnostics for every mesh output.

    A client-facing FUMOCA asset needs more than a single watertight boolean.
    Boundary and non-manifold edge counts, winding consistency and volume
    validity distinguish a real printable solid from a visually plausible
    surface. Edge counting is vectorized so it remains practical on
    production meshes.
    """
    faces = np.asarray(mesh.faces)
    edges = np.sort(np.concatenate(
        [faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]],
        axis=0
    ), axis=1) if len(faces) else np.empty((0, 2), dtype=np.int64)

    if len(edges):
        _unique_edges, edge_counts = np.unique(edges, axis=0, return_counts=True)
        boundary_edges = int(np.count_nonzero(edge_counts == 1))
        nonmanifold_edges = int(np.count_nonzero(edge_counts > 2))
    else:
        boundary_edges = 0
        nonmanifold_edges = 0

    try:
        nondegenerate = mesh.nondegenerate_faces()
        degenerate_faces = int(len(faces) - int(np.sum(nondegenerate)))
    except Exception:
        degenerate_faces = None

    watertight = bool(mesh.is_watertight)
    winding = bool(mesh.is_winding_consistent)
    is_volume = bool(mesh.is_volume)
    printable = bool(
        watertight and winding and is_volume and
        boundary_edges == 0 and nonmanifold_edges == 0 and
        (degenerate_faces in (None, 0))
    )

    bounds = np.asarray(mesh.bounds, dtype=np.float64) if len(mesh.vertices) else np.zeros((2, 3))
    extents = (bounds[1] - bounds[0]).tolist() if len(mesh.vertices) else [0.0, 0.0, 0.0]

    return {
        'method': method,
        'detail_tier': detail_tier,
        'n_verts': int(len(mesh.vertices)),
        'n_faces': int(len(mesh.faces)),
        'n_degenerate_faces': degenerate_faces,
        'is_watertight': watertight,
        'is_winding_consistent': winding,
        'is_volume': is_volume,
        'printable': printable,
        'boundary_edges': boundary_edges,
        'nonmanifold_edges': nonmanifold_edges,
        'surface_area_m2': float(mesh.area),
        'volume_m3': float(mesh.volume) if is_volume else None,
        'bounds_extent': extents,
        'euler_number': int(mesh.euler_number) if len(mesh.faces) else None,
    }


# ─── Stage 5: Gaussian Splatting ─────────────────────────────────────────────
def _dequantize_geometry(geo_bytes: bytes) -> tuple[int, np.ndarray]:
    """
    Mirrors NIFSpec.js's NIFReader.getGeometry() exactly — decodes either
    format (0x00 raw float32, 0x01 quantized) into the canonical (N,14)
    float32 array. Needed because export_buffer() returns quantized geometry
    by default, but downstream pipeline stages (mesh extraction, layer
    splitting) need the dequantized canonical form to work with.
    """
    flag = geo_bytes[0]
    count = struct.unpack('>I', geo_bytes[1:5])[0]

    if flag == 0x00:
        return count, np.frombuffer(geo_bytes[5:], dtype=np.float32).reshape(count, 14).copy()

    if flag == 0x01:
        bb_min = np.frombuffer(geo_bytes[5:17], dtype='>f4').astype(np.float32)
        bb_max = np.frombuffer(geo_bytes[17:29], dtype='>f4').astype(np.float32)
        bb_range = np.maximum(bb_max - bb_min, 1e-8)
        SCALE_MIN, SCALE_RANGE = -8.0, 10.0

        points = np.frombuffer(geo_bytes[29:29 + count * 17], dtype=[
            ('px', '>i2'), ('py', '>i2'), ('pz', '>i2'),
            ('sx', 'u1'),  ('sy', 'u1'),  ('sz', 'u1'),
            ('qw', 'i1'),  ('qx', 'i1'),  ('qy', 'i1'),  ('qz', 'i1'),
            ('op', 'u1'),
            ('r',  'u1'),  ('g',  'u1'),  ('b',  'u1'),
        ])

        out = np.zeros((count, 14), dtype=np.float32)
        out[:, 0] = ((points['px'].astype(np.float32) + 32767) / 65534) * bb_range[0] + bb_min[0]
        out[:, 1] = ((points['py'].astype(np.float32) + 32767) / 65534) * bb_range[1] + bb_min[1]
        out[:, 2] = ((points['pz'].astype(np.float32) + 32767) / 65534) * bb_range[2] + bb_min[2]
        out[:, 3] = (points['sx'].astype(np.float32) / 255) * SCALE_RANGE + SCALE_MIN
        out[:, 4] = (points['sy'].astype(np.float32) / 255) * SCALE_RANGE + SCALE_MIN
        out[:, 5] = (points['sz'].astype(np.float32) / 255) * SCALE_RANGE + SCALE_MIN
        out[:, 6] = points['qw'].astype(np.float32) / 127
        out[:, 7] = points['qx'].astype(np.float32) / 127
        out[:, 8] = points['qy'].astype(np.float32) / 127
        out[:, 9] = points['qz'].astype(np.float32) / 127
        op_sig = np.clip(points['op'].astype(np.float32) / 255, 1e-6, 1 - 1e-6)
        out[:, 10] = np.log(op_sig / (1 - op_sig))
        for ci, ch in enumerate(('r', 'g', 'b')):
            c_sig = np.clip(points[ch].astype(np.float32) / 255, 1e-6, 1 - 1e-6)
            out[:, 11 + ci] = np.log(c_sig / (1 - c_sig))
        return count, out

    raise RuntimeError(f'Unknown geometry format flag: {flag}')


class GaussianSplatTrainer:
    """Train a 3D depth field using gsplat v1.x API."""

    def __init__(self, n: int = 50_000, init_points: np.ndarray | None = None,
                 device: str | None = None):
        """
        init_points: optional (M, 3) array of real 3D points (COLMAP's sparse
        SfM point cloud) to seed self.means from, instead of pure random
        noise. This is the "geometry-derived Gaussians" step — Gaussians
        start at positions the reconstructed camera geometry actually
        observed, instead of a random cloud that has to be optimized into
        the right shape purely from photometric gradient.

        Falls back to the old random-init behavior when init_points is None
        or too sparse to be a meaningful seed (COLMAP can produce very few
        points on a weak-texture capture) — a handful of real points isn't a
        better starting distribution than random for 20k+ Gaussians, so the
        threshold below avoids seeding from noise that happens to have 3D
        coordinates.

        device: all parameters are created directly on this device. This
        matters more than it looks — nn.Parameter().to(device) does NOT
        preserve leaf-tensor status when device actually changes (the .to()
        call becomes a tracked, differentiable op, so the result is a
        non-leaf tensor with a grad_fn). torch.optim.Optimizer explicitly
        rejects non-leaf tensors ("can't optimize a non-leaf Tensor") when
        you build the optimizer from them. The previous code created
        parameters on CPU (torch.randn with no device=) and then reassigned
        trainer.means = trainer.means.to(DEVICE) etc. in _train_gaussians
        before building the optimizer — which is exactly that failure mode,
        and would raise on every real GPU run. Creating tensors on-device
        from the start avoids the .to() reassignment entirely.
        """
        self.n    = n
        self.device = device if device is not None else DEVICE
        MIN_SEED_POINTS = 200
        if init_points is not None and len(init_points) >= MIN_SEED_POINTS:
            pts = torch.tensor(init_points, dtype=torch.float32, device=self.device)
            # Sample n means from the point cloud (with replacement if the
            # cloud is smaller than n, which is the common case — COLMAP's
            # sparse cloud is typically far fewer points than n_gaussians).
            idx = torch.randint(0, len(pts), (n,), device=self.device)
            seeded = pts[idx]
            # Small jitter so Gaussians starting at the exact same COLMAP
            # point (common under with-replacement sampling) aren't fighting
            # over identical gradients at step 0.
            seeded = seeded + torch.randn_like(seeded) * 0.02
            self.means = nn.Parameter(seeded)
            print(f'[NIF] Gaussians seeded from {len(pts):,} COLMAP sparse points '
                  f'(geometry-derived init, not random)')
        else:
            if init_points is not None:
                print(f'[NIF] Only {len(init_points)} COLMAP sparse points — '
                      f'below the {MIN_SEED_POINTS} minimum to seed from, using random init')
            self.means = nn.Parameter(torch.randn(n, 3, device=self.device) * 0.3)
        # Initialize Gaussian size from the actual COLMAP geometry.
        # A fixed scale makes every Gaussian start as the same-size blob,
        # which causes the fuzzy/floaty appearance we are trying to eliminate.
        if init_points is not None and len(init_points) >= MIN_SEED_POINTS:
            with torch.no_grad():
                sample_n = min(len(pts), 4096)

                sample_idx = torch.randperm(
                    len(pts),
                    device=self.device
                )[:sample_n]

                sample_pts = pts[sample_idx]

                d = torch.cdist(
                    sample_pts,
                    sample_pts
                )

                d.fill_diagonal_(float("inf"))

                nearest = d.min(dim=1).values

                local_spacing = torch.median(
                    nearest
                ).clamp(min=1e-4)

                initial_scale = (
                    local_spacing * 0.35
                ).clamp(
                    min=1e-4,
                    max=0.5
                )

                print(
                    f'[NIF] Geometry-derived Gaussian scale: '
                    f'{float(initial_scale):.6f} '
                    f'(median local spacing='
                    f'{float(local_spacing):.6f})'
                )

            self.log_scales = nn.Parameter(
                torch.full(
                    (n, 3),
                    torch.log(initial_scale),
                    device=self.device
                )
            )
        else:
            self.log_scales = nn.Parameter(
                torch.full(
                    (n, 3),
                    -3.0,
                    device=self.device
                )
            )
        self.quats       = nn.Parameter(F.normalize(torch.randn(n, 4, device=self.device), dim=-1))
        self.log_opacity = nn.Parameter(torch.zeros(n, device=self.device))
        # View-dependent appearance is essential for photorealism: real paint,
        # glass, chrome, varnish and metallic packaging change appearance as the
        # camera moves. Keep higher-order spherical-harmonic bands in the MASTER.
        self.sh_degree = max(0, min(3, int(os.environ.get('FUMOCA_SH_DEGREE', '3'))))
        self.sh0         = nn.Parameter(torch.zeros(n, 1, 3, device=self.device))
        self.sh_rest     = nn.Parameter(torch.zeros(
            n, (self.sh_degree + 1) ** 2 - 1, 3, device=self.device
        ))
        self._opt = self._make_optimizer()
        self._step = 0

    def _make_optimizer(self):
        return torch.optim.Adam([
            {'params': [self.means],       'lr': 1e-3},
            {'params': [self.log_scales],  'lr': 5e-4},
            {'params': [self.quats],       'lr': 5e-4},
            {'params': [self.log_opacity], 'lr': 5e-3},
            {'params': [self.sh0],         'lr': 1e-3},
            {'params': [self.sh_rest],     'lr': 1e-3},
        ], eps=1e-15)

    def _reset_optimizer_after_topology_change(self):
        """Rebuild Adam after prune/densify changes the per-Gaussian tensor size.
        
        The older custom densifier mutated Parameter.data in place but left
        Adam's exp_avg/exp_avg_sq buffers at the old shape. The next optimizer
        step could therefore fail with a tensor-size mismatch. The official
        gsplat strategy manages these buffers explicitly; until we migrate the
        trainer fully to that strategy, rebuilding here is the safe invariant.
        """
        self._opt = self._make_optimizer()

    def train_step(self, gt: torch.Tensor, viewmat: torch.Tensor,
                   K: torch.Tensor,
                   alpha_mask: torch.Tensor | None = None,
                   depth_target: torch.Tensor | None = None,
                   depth_loss_weight: float = 0.0) -> float:
        H, W = gt.shape[:2]
        quats_n = F.normalize(self.quats, dim=-1)
        scales  = torch.exp(self.log_scales).clamp(min=1e-6)
        opacities = torch.sigmoid(self.log_opacity)
        # sigmoid alone is already (0,1), matching ground truth's [0,1]
        # range (frames are /255.0 before training — see _train_gaussians).
        # The prior "+ 0.5" shifted this to (0.5, 1.5): since sigmoid can
        # never reach 0, colours could never go below 0.5, so the model was
        # structurally unable to represent dark colors — shadows, dark
        # leather, charred edges, black text, all clamp toward a brightness
        # floor it can't train past. Note this does change the color at
        # step 0: sh0 initializes to zeros, so init color is now
        # sigmoid(0)=0.5 (neutral grey) instead of the old sigmoid(0)+0.5=1.0
        # (pure white) — grey is the more standard splat-init choice, and
        # unlike the old value it can actually converge toward black.
        # gsplat evaluates these coefficients against the actual camera
        # direction. This captures view-dependent appearance instead of freezing
        # one RGB value per Gaussian.
        sh_coeffs = torch.cat([self.sh0, self.sh_rest], dim=1)

        rendered, alpha, _info = gsplat.rasterization(
            means=self.means.unsqueeze(0),
            quats=quats_n.unsqueeze(0),
            scales=scales.unsqueeze(0),
            opacities=opacities.unsqueeze(0),
            colors=sh_coeffs,
            viewmats=viewmat.unsqueeze(0).unsqueeze(1),
            Ks=K.unsqueeze(0).unsqueeze(1),
            width=W, height=H,
            near_plane=0.01, far_plane=100.0,
            sh_degree=self.sh_degree,
            # ED gives expected Gaussian projection depth, which is the
            # useful differentiable depth signal for shape supervision.
            render_mode='RGB+ED' if depth_target is not None and depth_loss_weight > 0 else 'RGB',
        )
        rendered = rendered.squeeze(0).squeeze(0)
        rendered_depth = None
        if depth_target is not None and depth_loss_weight > 0:
            rendered_depth = rendered[..., 3]
            rendered = rendered[..., :3]  # H,W,3
        gt_rgb   = gt.to(DEVICE)

        if alpha_mask is not None:
            target_mask = alpha_mask.clamp(0.0, 1.0)

            render_alpha = alpha
            while render_alpha.ndim > 2:
                render_alpha = render_alpha.squeeze(0)

            if render_alpha.ndim == 3:
                render_alpha = render_alpha.squeeze(-1)

            render_alpha = render_alpha.clamp(0.0, 1.0)

            fg = target_mask.unsqueeze(-1)
            fg_pixels = target_mask.sum().clamp(min=1.0)

            rgb_loss = (
                torch.abs(rendered - gt_rgb) * fg
            ).sum() / (fg_pixels * 3.0)

            silhouette_loss = F.binary_cross_entropy(
                render_alpha.clamp(1e-4, 1.0 - 1e-4),
                target_mask
            )

            bg = 1.0 - target_mask
            bg_pixels = bg.sum().clamp(min=1.0)

            background_loss = (
                render_alpha * bg
            ).sum() / bg_pixels

            rendered_fg = rendered * fg
            gt_fg = gt_rgb * fg

            ssim_loss = 1.0 - self._ssim(
                rendered_fg,
                gt_fg
            )

            loss = (
                rgb_loss
                + 0.15 * ssim_loss
                + 0.50 * silhouette_loss
                + 0.10 * background_loss
            )

        else:
            loss = (
                F.l1_loss(rendered, gt_rgb)
                + 0.2 * (1.0 - self._ssim(rendered, gt_rgb))
            )

        if rendered_depth is not None and depth_target is not None and depth_loss_weight > 0:
            target_depth = depth_target.to(DEVICE)
            finite = torch.isfinite(target_depth) & (target_depth > 0)
            if alpha_mask is not None:
                finite = finite & (alpha_mask > 0.15)
            valid_render = torch.isfinite(rendered_depth) & (rendered_depth > 0)
            depth_alpha = alpha
            while depth_alpha.ndim > 2:
                depth_alpha = depth_alpha.squeeze(0)
            if depth_alpha.ndim == 3:
                depth_alpha = depth_alpha.squeeze(-1)
            valid = finite & valid_render & (depth_alpha > 0.05)

            if valid.sum() > 256:
                td = target_depth[valid]
                rd = rendered_depth[valid]
                # Relative-depth supervision is used intentionally. Monocular
                # depth may be metric or only up-to-scale, while COLMAP is also
                # scale ambiguous until calibration. Robust percentile
                # normalization constrains shape without inventing metres.
                t_lo, t_hi = torch.quantile(td.detach(), torch.tensor(0.05, device=DEVICE)), torch.quantile(td.detach(), torch.tensor(0.95, device=DEVICE))
                r_lo, r_hi = torch.quantile(rd.detach(), torch.tensor(0.05, device=DEVICE)), torch.quantile(rd.detach(), torch.tensor(0.95, device=DEVICE))
                t_norm = ((td - t_lo) / (t_hi - t_lo).clamp_min(1e-6)).clamp(0, 1)
                r_norm = ((rd - r_lo) / (r_hi - r_lo).clamp_min(1e-6)).clamp(0, 1)
                depth_loss = F.smooth_l1_loss(r_norm, t_norm)
                loss = loss + float(depth_loss_weight) * depth_loss

        self._opt.zero_grad()
        loss.backward()
        if self.means.grad is not None:
            self._last_mean_grad = self.means.grad.detach().norm(dim=1).clone()
        else:
            self._last_mean_grad = None
        self._opt.step()

        self._step += 1
        if self._step % 200 == 0:
            self._prune()

        return float(loss.detach())

    def _ssim(self, p, g, ws=11):
        p4 = p.permute(2, 0, 1).unsqueeze(0)
        g4 = g.permute(2, 0, 1).unsqueeze(0)

        mu1 = F.avg_pool2d(p4, ws, 1, ws // 2)
        mu2 = F.avg_pool2d(g4, ws, 1, ws // 2)

        s1 = F.avg_pool2d(p4 ** 2, ws, 1, ws // 2) - mu1 ** 2
        s2 = F.avg_pool2d(g4 ** 2, ws, 1, ws // 2) - mu2 ** 2
        s12 = F.avg_pool2d(p4 * g4, ws, 1, ws // 2) - mu1 * mu2

        c1 = 0.01 ** 2
        c2 = 0.03 ** 2

        ssim = (
            (2 * mu1 * mu2 + c1)
            * (2 * s12 + c2)
            /
            ((mu1 ** 2 + mu2 ** 2 + c1) * (s1 + s2 + c2))
        )

        return ssim.mean()

    def _prune(self, thr=0.005):
        with torch.no_grad():
            keep = torch.sigmoid(self.log_opacity) > thr
            if keep.sum() < 1000: return
            for p in [self.means, self.log_scales, self.quats,
                      self.log_opacity, self.sh0, self.sh_rest]:
                p.data = p.data[keep]
            self._reset_optimizer_after_topology_change()

    def _densify(self, grad_thr=0.0002):
        """
        Adaptive densification — the mechanism that fills in fine detail.
        Two operations:
          CLONE:  Small Gaussians (scale < scene_extent * 0.01) that have
                  high view-space position gradient are duplicated.
                  This fills in under-reconstructed regions.
          SPLIT:  Large Gaussians (scale > scene_extent * 0.05) that have
                  high gradient are split into two smaller ones.
                  This captures detail that one large blob was masking.

        Reference: Kerbl et al. 2023 §5 "Adaptive Control of Gaussians"
        """
        topology_changed = False
        with torch.no_grad():
            n = len(self.means)
            grad_score = getattr(self, '_last_mean_grad', None)
            if grad_score is None or len(grad_score) != n:
                grad_score = torch.zeros(n, device=self.means.device)
            grad_thr = float(grad_thr)
            active = torch.sigmoid(self.log_opacity) > 0.01
            high_grad = grad_score >= grad_thr
            # If the absolute threshold is too strict for a particular
            # capture, keep the top 2% visible Gaussians as a fallback. This
            # makes densification adaptive to exposure/scale instead of
            # silently doing nothing on a low-gradient sequence.
            if high_grad.sum() < max(32, int(n * 0.002)):
                k = max(32, int(n * 0.02))
                k = min(k, n)
                top_idx = torch.topk(grad_score, k=k).indices
                high_grad = torch.zeros_like(active)
                high_grad[top_idx] = True
            # Estimate scene extent from current point spread
            extent = float(self.means.std(dim=0).max()) * 3 + 1e-6

            # Use scale magnitude as proxy for Gaussian size
            scales = torch.exp(self.log_scales)  # (N, 3)
            max_scale = scales.max(dim=1).values  # (N,)
            mean_scale = max_scale.mean()

            # Identify candidates by opacity and actual training gradient.
            opacities = torch.sigmoid(self.log_opacity)  # (N,)

            # ── CLONE small under-represented Gaussians ──────────────────────
            clone_mask = active & high_grad & (max_scale < extent * 0.01)
            n_clone    = min(clone_mask.sum().item(), 5000)
            if n_clone > 0:
                idx = clone_mask.nonzero(as_tuple=True)[0][:n_clone]
                # Slight random perturbation so clones don't overlap exactly
                perturb = torch.randn_like(self.means[idx]) * max_scale[idx].unsqueeze(1) * 0.3
                new_means   = self.means[idx]       + perturb
                new_scales  = self.log_scales[idx]
                new_quats   = self.quats[idx]
                new_opacity = self.log_opacity[idx] - 1.0  # start slightly less opaque
                new_sh0     = self.sh0[idx]
                new_sh_rest = self.sh_rest[idx]
                for p, new_p in [(self.means, new_means),
                                 (self.log_scales, new_scales),
                                 (self.quats, new_quats),
                                 (self.log_opacity, new_opacity),
                                 (self.sh0, new_sh0),
                                 (self.sh_rest, new_sh_rest)]:
                    p.data = torch.cat([p.data, new_p.data], dim=0)
                topology_changed = True

            # ── SPLIT large Gaussians into two smaller ones ──────────────────
            split_mask = active & high_grad & (max_scale > extent * 0.05)
            n_split    = min(split_mask.sum().item(), 3000)
            if n_split > 0:
                idx = split_mask.nonzero(as_tuple=True)[0][:n_split]
                # Split along the principal (largest scale) axis
                principal_axis = scales[idx].argmax(dim=1)  # 0, 1, or 2
                offset = torch.zeros_like(self.means[idx])
                for i, ax in enumerate(principal_axis):
                    offset[i, ax] = float(scales[idx[i], ax]) * 0.5

                new_means_a  = self.means[idx] + offset
                new_means_b  = self.means[idx] - offset
                new_scales   = self.log_scales[idx] - 0.693  # ln(0.5) ≈ -0.693
                new_quats    = self.quats[idx]
                new_opacity  = self.log_opacity[idx]
                new_sh0      = self.sh0[idx]

                # Remove the parent and append two children. Every
                # per-Gaussian attribute must undergo the exact same topology
                # operation; otherwise positions/quaternions/scales/colors
                # become misaligned and the exported geometry is corrupted.
                keep = torch.ones(len(self.means), dtype=torch.bool, device=self.means.device)
                keep[idx] = False

                for p, new_a, new_b in [
                    (self.means, new_means_a, new_means_b),
                    (self.log_scales, new_scales, new_scales),
                    (self.quats, new_quats, new_quats),
                    (self.log_opacity, new_opacity, new_opacity),
                    (self.sh0, new_sh0, new_sh0),
                    (self.sh_rest, new_sh_rest, new_sh_rest),
                ]:
                    p.data = torch.cat([p.data[keep], new_a, new_b], dim=0)
                topology_changed = True

            if topology_changed:
                self._reset_optimizer_after_topology_change()

            n_after = len(self.means)
            if n_after != n:
                print(f'[NIF] Densify: {n:,} → {n_after:,} (+{n_after-n:,} clone={n_clone} split={n_split})')
                # Rebuild optimiser — required when parameter sizes change
                self._opt = self._make_optimizer()

    def export_buffer(self) -> tuple[int, bytes]:
        """
        Export geometry as quantised binary for maximum compression.

        Format (17 bytes per point — 70% smaller than float32):
          positions:  3 × int16   (normalised to [-32767, 32767] within bounding box)
          log_scales: 3 × uint8   (mapped from [-8, 2] log range to [0, 255])
          quaternion: 4 × int8    (normalised unit quat, values mapped to [-127, 127])
          opacity:    1 × uint8   (logit → sigmoid → [0, 255])
          sh0_rgb:    3 × uint8   (logit → sigmoid offset → [0, 255])

        Header: [n:uint32 BE][bb_min_x:f32][bb_min_y:f32][bb_min_z:f32]
                [bb_max_x:f32][bb_max_y:f32][bb_max_z:f32]
                (28 bytes bounding box for dequantisation)

        Fallback: if quantisation fails for any reason, returns raw float32
        with a flag byte so the viewer knows which format to decode.
        """
        import struct as _struct
        try:
            with torch.no_grad():
                means   = self.means.detach().cpu().numpy().astype(np.float32)        # (N,3)
                scales  = self.log_scales.detach().cpu().numpy().astype(np.float32)   # (N,3)
                quats   = self.quats.detach().cpu().numpy().astype(np.float32)        # (N,4)
                opacity = self.log_opacity.detach().cpu().numpy().astype(np.float32)  # (N,)
                sh0     = self.sh0.detach().cpu().numpy().astype(np.float32)

            n = len(means)
            # Legacy geometry keeps an RGB fallback. The full SH master is
            # trained above; this fallback is deliberately view-independent so
            # older NIF readers remain compatible.
            sh0_rgb = np.clip(sh0[:, 0, :] * 0.28209479177387814 + 0.5, 0.0, 1.0)

            # Normalise quats to unit length (defensive)
            norms = np.linalg.norm(quats, axis=1, keepdims=True)
            quats = quats / np.maximum(norms, 1e-8)

            # ── Bounding box for position dequantisation ──────────────────────
            bb_min = means.min(axis=0)
            bb_max = means.max(axis=0)
            bb_range = bb_max - bb_min
            # Avoid zero range on degenerate scenes
            bb_range = np.maximum(bb_range, 1e-6)

            # ── Quantise positions → int16 ────────────────────────────────────
            # Normalise to [0, 1], scale to [-32767, 32767]
            pos_norm = (means - bb_min) / bb_range  # [0, 1]
            pos_q = np.clip(pos_norm * 65534 - 32767, -32767, 32767).astype(np.int16)

            # ── Quantise log_scales → uint8 ───────────────────────────────────
            # Log scales typically in [-8, 2]. Map to [0, 255].
            SCALE_MIN, SCALE_MAX = -8.0, 2.0
            scale_norm = (scales - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)
            scale_q = np.clip(scale_norm * 255, 0, 255).astype(np.uint8)

            # ── Quantise quaternions → int8 ───────────────────────────────────
            quat_q = np.clip(quats * 127, -127, 127).astype(np.int8)

            # ── Quantise opacity (logit → sigmoid → uint8) ────────────────────
            # sigmoid(x) = 1/(1+exp(-x)), map to [0, 255]
            opacity_sig = 1.0 / (1.0 + np.exp(-np.clip(opacity, -20, 20)))
            opacity_q = np.clip(opacity_sig * 255, 0, 255).astype(np.uint8)

            # ── Quantise legacy RGB fallback derived from SH degree-0 ────────
            sh_q = np.clip(sh0_rgb * 255.0, 0, 255).astype(np.uint8)

            # ── Pack ──────────────────────────────────────────────────────────
            # Header: format_flag(1) + count(4) + bounding_box(24) = 29 bytes
            # format_flag: 0x01 = quantised, 0x00 = raw float32
            header = _struct.pack('>BI', 0x01, n)
            header += bb_min.astype('>f4').tobytes()   # 12 bytes, big-endian
            header += bb_max.astype('>f4').tobytes()   # 12 bytes, big-endian

            # Points: interleaved, 17 bytes each
            # [pos_x:i16][pos_y:i16][pos_z:i16][sx:u8][sy:u8][sz:u8]
            # [qw:i8][qx:i8][qy:i8][qz:i8][opacity:u8][r:u8][g:u8][b:u8]
            # Build as structured array for speed
            point_buf = np.zeros(n, dtype=[
                ('px', '>i2'), ('py', '>i2'), ('pz', '>i2'),
                ('sx', 'u1'),  ('sy', 'u1'),  ('sz', 'u1'),
                ('qw', 'i1'),  ('qx', 'i1'),  ('qy', 'i1'),  ('qz', 'i1'),
                ('op', 'u1'),
                ('r',  'u1'),  ('g',  'u1'),  ('b',  'u1'),
            ])
            point_buf['px'] = pos_q[:, 0]
            point_buf['py'] = pos_q[:, 1]
            point_buf['pz'] = pos_q[:, 2]
            point_buf['sx'] = scale_q[:, 0]
            point_buf['sy'] = scale_q[:, 1]
            point_buf['sz'] = scale_q[:, 2]
            point_buf['qw'] = quat_q[:, 0]
            point_buf['qx'] = quat_q[:, 1]
            point_buf['qy'] = quat_q[:, 2]
            point_buf['qz'] = quat_q[:, 3]
            point_buf['op'] = opacity_q
            point_buf['r']  = sh_q[:, 0]
            point_buf['g']  = sh_q[:, 1]
            point_buf['b']  = sh_q[:, 2]

            raw_sz  = n * 56
            quant_sz = n * 17
            print(f'[NIF] Quantised: {n:,} pts  '
                  f'{raw_sz/1024/1024:.2f}MB → {quant_sz/1024/1024:.2f}MB '
                  f'({(1-quant_sz/raw_sz):.0%} reduction before gzip)')
            return n, header + point_buf.tobytes()

        except Exception as e:
            # Fallback to raw float32 if quantisation fails
            print(f'[NIF] Quantisation failed ({e}), using raw float32')
            with torch.no_grad():
                n    = len(self.means)
                out  = np.zeros((n, 14), dtype=np.float32)
                out[:, 0:3]  = self.means.detach().cpu().numpy()
                out[:, 3:6]  = self.log_scales.detach().cpu().numpy()
                out[:, 6:10] = self.quats.detach().cpu().numpy()
                out[:, 10]   = self.log_opacity.detach().cpu().numpy()
                out[:, 11:14]= self.sh0.detach().cpu().numpy()[:, 0, :]
            # format_flag: 0x00 = raw float32
            import struct as _s
            header = _s.pack('>BI', 0x00, n)
            return n, header + out.tobytes()



def _multi_view_part_fusion(semantic: dict | None, poses: list | None,
                           object_masks: list | None, image_shape=None) -> dict:
    """Level 6: fuse reference-frame semantic regions into stable 3D part evidence.

    The reference SAM/SAM2 labels are anchors. Each labelled Gaussian is projected
    through every recovered camera and receives independent foreground support.
    This does NOT run a semantic classifier per view and does NOT invent part names.
    It answers the narrower, safer question: "does this observed 3D region continue
    to be supported by the captured product across multiple views?"
    """
    base = {
        'status': 'unavailable', 'level': 6,
        'gaussian_count': 0, 'parts': [],
        'views_tested': 0, 'views_with_foreground_evidence': 0,
        'fusion_policy': (
            'Reference SAM/SAM2 regions are fused into 3D evidence using recovered '
            'camera projections and foreground support. This is not semantic naming, '
            'true occlusion proof, or hidden-geometry recovery.'
        ),
        'unseen_geometry_claimed': False,
    }
    if not semantic or semantic.get('status') != 'available' or not poses or not image_shape:
        return base
    labels = np.asarray(semantic.get('labels', []), dtype=np.uint8)
    confidence = np.asarray(semantic.get('confidence', []), dtype=np.float32)
    if len(labels) == 0 or len(labels) != len(confidence):
        return base
    try:
        H, W = int(image_shape[0]), int(image_shape[1])
        fx = fy = max(H, W) * 0.8
        cx, cy = W * 0.5, H * 0.5
        # The semantic map is aligned to the canonical Gaussian array. Reuse the
        # same deterministic finite-point policy as the rest of the evidence layers.
        valid_idx = np.flatnonzero(labels != 255)
        if not len(valid_idx):
            return base
        # surface positions are supplied by the caller through semantic['_positions']
        # to avoid duplicating a potentially very large Gaussian array in JSON.
        positions = semantic.get('_positions')
        if positions is None:
            return base
        pts = np.asarray(positions, dtype=np.float32)
        if len(pts) != len(labels) or pts.ndim != 2 or pts.shape[1] < 3:
            return base
        finite = np.all(np.isfinite(pts[:, :3]), axis=1)
        valid_idx = valid_idx[finite[valid_idx]]
        if not len(valid_idx):
            return base

        part_ids = sorted(int(x) for x in np.unique(labels[valid_idx]))
        stats = {
            pid: {
                'gaussian_count': 0,
                'support_votes': 0,
                'foreground_support_votes': 0,
                'strong_views': 0,
                'view_ids': set(),
                'confidence_sum': 0.0,
                'min_xyz': np.full(3, np.inf, dtype=np.float32),
                'max_xyz': np.full(3, -np.inf, dtype=np.float32),
            } for pid in part_ids
        }
        for pid in part_ids:
            ii = valid_idx[labels[valid_idx] == pid]
            s = stats[pid]
            s['gaussian_count'] = int(len(ii))
            s['confidence_sum'] = float(np.sum(confidence[ii]))
            s['min_xyz'] = np.min(pts[ii, :3], axis=0)
            s['max_xyz'] = np.max(pts[ii, :3], axis=0)

        views_tested = 0
        views_with_fg = 0
        for vi, pose in enumerate(poses):
            vm = pose[1] if isinstance(pose, tuple) else pose
            vm = vm.detach().cpu().numpy() if hasattr(vm, 'detach') else np.asarray(vm)
            if vm.shape[0] < 3 or vm.shape[1] < 4:
                continue
            cam = (vm[:3, :3] @ pts[valid_idx, :3].T + vm[:3, 3:4]).T
            z = cam[:, 2]
            u = fx * cam[:, 0] / np.maximum(z, 1e-8) + cx
            v = fy * cam[:, 1] / np.maximum(z, 1e-8) + cy
            inside = np.isfinite(z) & (z > 1e-6) & np.isfinite(u) & np.isfinite(v) & (u >= 0) & (u < W) & (v >= 0) & (v < H)
            if not np.any(inside):
                continue
            views_tested += 1
            view_fg = object_masks[vi] if object_masks is not None and vi < len(object_masks) else None
            if view_fg is None:
                continue
            mask = np.asarray(view_fg)
            if mask.ndim < 2 or mask.shape[:2] != (H, W):
                continue
            px = np.clip(np.rint(u[inside]).astype(np.int64), 0, W - 1)
            py = np.clip(np.rint(v[inside]).astype(np.int64), 0, H - 1)
            fg = mask[py, px] > 32
            if not np.any(fg):
                continue
            views_with_fg += 1
            selected = valid_idx[inside][fg]
            selected_labels = labels[selected]
            for pid in part_ids:
                hit = selected_labels == pid
                count = int(np.count_nonzero(hit))
                if count:
                    s = stats[pid]
                    s['support_votes'] += 1
                    s['foreground_support_votes'] += count
                    s['view_ids'].add(int(vi))
                    if count >= max(4, int(s['gaussian_count'] * 0.02)):
                        s['strong_views'] += 1

        parts = []
        for pid in part_ids:
            s = stats[pid]
            view_count = len(s['view_ids'])
            denom = max(s['gaussian_count'] * max(views_tested, 1), 1)
            foreground_ratio = float(s['foreground_support_votes'] / denom)
            mean_conf = float(s['confidence_sum'] / max(s['gaussian_count'], 1))
            multi_view_score = float(np.clip(
                0.45 * min(view_count / 3.0, 1.0) +
                0.35 * min(s['strong_views'] / 3.0, 1.0) +
                0.20 * foreground_ratio,
                0.0, 1.0
            ))
            parts.append({
                'part_id': pid,
                'views_supported': view_count,
                'strong_views': int(s['strong_views']),
                'foreground_support_ratio': foreground_ratio,
                'multi_view_score': multi_view_score,
                'mean_semantic_confidence': mean_conf,
                'gaussian_count': int(s['gaussian_count']),
                'bounds_min': [float(x) for x in s['min_xyz']],
                'bounds_max': [float(x) for x in s['max_xyz']],
                'stable_3d_evidence': bool(view_count >= 2 and multi_view_score >= 0.45),
                'identity_status': 'unassigned',
                'mechanical_ready': False,
            })

        base.update({
            'status': 'available',
            'gaussian_count': int(len(labels)),
            'views_tested': int(views_tested),
            'views_with_foreground_evidence': int(views_with_fg),
            'parts': parts,
        })
        return base
    except Exception as e:
        base['status'] = 'error'
        base['error'] = str(e)
        return base


def _part_geometry_evidence(semantic: dict | None, multi_view: dict | None = None) -> dict:
    """Level 7: derive observed 3D part extent and frame candidates.

    This is geometric evidence only. PCA axes are candidates for a local frame;
    they are not declared hinges, rotations, or mechanical pivots. The canonical
    Gaussian geometry remains authoritative.
    """
    base = {
        'status': 'unavailable', 'level': 7, 'parts': [],
        'policy': (
            'Part centroids, bounds and principal axes are derived from observed '
            'reconstructed Gaussians. Axes are frame candidates, not mechanical '
            'hinges or proof of intended motion.'
        ),
        'unseen_geometry_claimed': False,
    }
    if not semantic or semantic.get('status') != 'available':
        return base
    positions = semantic.get('_positions')
    labels = np.asarray(semantic.get('labels', []), dtype=np.uint8)
    if positions is None or len(labels) == 0:
        return base
    try:
        pts = np.asarray(positions, dtype=np.float64)
        if pts.ndim != 2 or pts.shape[1] < 3 or len(pts) != len(labels):
            return base
        parts = []
        for pid in sorted(int(x) for x in np.unique(labels) if int(x) != 255):
            idx = np.flatnonzero(labels == pid)
            if len(idx) < 3:
                continue
            p = pts[idx, :3]
            finite = np.all(np.isfinite(p), axis=1)
            p = p[finite]
            if len(p) < 3:
                continue
            centroid = np.mean(p, axis=0)
            bounds_min = np.min(p, axis=0)
            bounds_max = np.max(p, axis=0)
            centered = p - centroid
            cov = (centered.T @ centered) / max(len(p) - 1, 1)
            try:
                eigvals, eigvecs = np.linalg.eigh(cov)
                order = np.argsort(eigvals)[::-1]
                eigvals = np.maximum(eigvals[order], 0.0)
                eigvecs = eigvecs[:, order]
                # Deterministic sign convention: make the largest-magnitude
                # component of each axis positive. This avoids random flips.
                for k in range(3):
                    j = int(np.argmax(np.abs(eigvecs[:, k])))
                    if eigvecs[j, k] < 0:
                        eigvecs[:, k] *= -1.0
                # Keep the frame right-handed after deterministic sign fixing.
                if np.linalg.det(eigvecs) < 0:
                    eigvecs[:, 2] *= -1.0
                total = float(np.sum(eigvals))
                axis_conf = float(np.clip((eigvals[0] - eigvals[1]) / max(eigvals[0], 1e-12), 0.0, 1.0)) if total > 0 else 0.0
            except Exception:
                eigvals = np.zeros(3, dtype=np.float64)
                eigvecs = np.eye(3, dtype=np.float64)
                axis_conf = 0.0
            mv = next((x for x in (multi_view or {}).get('parts', []) if int(x.get('part_id', -1)) == pid), None)
            pg = next((x for x in (part_geometry or {}).get('parts', []) if int(x.get('part_id', -1)) == pid), None)
            mc = next((x for x in (mechanical_candidates or {}).get('parts', []) if int(x.get('part_id', -1)) == pid), None)
            parts.append({
                'part_id': pid,
                'gaussian_count': int(len(p)),
                'centroid': [float(x) for x in centroid],
                'bounds_min': [float(x) for x in bounds_min],
                'bounds_max': [float(x) for x in bounds_max],
                'dimensions': [float(x) for x in (bounds_max - bounds_min)],
                'principal_axes': [[float(x) for x in eigvecs[:, k]] for k in range(3)],
                'principal_variance': [float(x) for x in eigvals],
                'axis_confidence': axis_conf,
                'frame_source': 'gaussian_pca_observed_geometry',
                'pivot_status': 'not_recovered',
                'mechanical_axis_status': 'not_recovered',
                'multi_view_stable': bool(mv and mv.get('stable_3d_evidence') is True),
            })
        base.update({'status': 'available' if parts else 'insufficient_geometry', 'parts': parts})
        return base
    except Exception as e:
        base['status'] = 'error'
        base['error'] = str(e)
        return base


def _part_mechanical_candidates(semantic: dict | None, part_geometry: dict | None = None) -> dict:
    """Level 8: derive conservative part-boundary and axis candidates.

    A candidate is evidence for authoring, never an automatic hinge. Boundary
    contact is measured in reconstructed 3D space between differently-labelled
    Gaussian regions. Principal axes are reused as possible motion-frame axes,
    but no mechanical interpretation is assigned here.
    """
    base = {
        'status': 'unavailable', 'level': 8, 'parts': [],
        'policy': (
            'Part boundaries and principal-axis candidates are observed geometry '
            'evidence only. They do not establish product identity, hinge location, '
            'or intended motion.'
        ),
        'unseen_geometry_claimed': False,
    }
    if not semantic or semantic.get('status') != 'available' or not part_geometry:
        return base
    positions = semantic.get('_positions')
    labels = np.asarray(semantic.get('labels', []), dtype=np.uint8)
    if positions is None or len(labels) == 0:
        return base
    try:
        pts = np.asarray(positions, dtype=np.float64)
        if pts.ndim != 2 or pts.shape[1] < 3 or len(pts) != len(labels):
            return base
        finite = np.all(np.isfinite(pts[:, :3]), axis=1)
        valid = np.flatnonzero(finite & (labels != 255))
        if len(valid) < 8:
            return base
        # Deterministic cap keeps Level 8 bounded for ultra-quality reconstructions.
        cap = min(len(valid), int(os.environ.get('FUMOCA_PART_BOUNDARY_SAMPLES', '12000')))
        valid = valid[np.linspace(0, len(valid) - 1, cap, dtype=np.int64)]
        p = pts[valid, :3]
        lab = labels[valid]
        try:
            from scipy.spatial import cKDTree
            tree = cKDTree(p)
            k = min(8, len(p))
            _, nn = tree.query(p, k=k, workers=1)
        except Exception:
            return base
        records = []
        for pg in part_geometry.get('parts', []):
            pid = int(pg.get('part_id', -1))
            if pid < 0:
                continue
            mask = lab == pid
            count = int(np.count_nonzero(mask))
            if count < 3:
                continue
            rows = np.flatnonzero(mask)
            neighbour_labels = lab[nn[rows].reshape(-1)]
            # The first neighbour is normally the point itself. Exclude same-part
            # contacts from the boundary ratio and count only observed other parts.
            cross = neighbour_labels != pid
            cross_count = int(np.count_nonzero(cross))
            boundary_point_ratio = float(np.mean(np.any(cross.reshape(len(rows), -1), axis=1)))
            contact_ratio = float(cross_count / max(len(rows) * max(k - 1, 1), 1))
            axes = np.asarray(pg.get('principal_axes', []), dtype=np.float64)
            variances = np.asarray(pg.get('principal_variance', []), dtype=np.float64)
            axis_candidates = []
            if axes.shape == (3, 3):
                for axis_i in range(3):
                    axis = axes[:, axis_i]
                    spread = float(variances[axis_i]) if axis_i < len(variances) else 0.0
                    axis_candidates.append({
                        'axis': [float(x) for x in axis],
                        'axis_index': axis_i,
                        'spread': spread,
                        'mechanical_candidate': bool(axis_i == 0 and pg.get('axis_confidence', 0.0) >= 0.35),
                        'status': 'candidate_only',
                    })
            boundary_score = float(np.clip(0.55 * boundary_point_ratio + 0.45 * min(contact_ratio * 4.0, 1.0), 0.0, 1.0))
            records.append({
                'part_id': pid,
                'sampled_gaussians': count,
                'boundary_point_ratio': boundary_point_ratio,
                'cross_part_contact_ratio': contact_ratio,
                'boundary_evidence_score': boundary_score,
                'boundary_status': 'observed_contact' if boundary_score >= 0.20 else 'weak_contact',
                'axis_candidates': axis_candidates,
                'pivot': None,
                'pivot_status': 'not_recovered',
                'mechanical_axis_status': 'candidate_only' if axis_candidates else 'not_recovered',
                'identity_status': 'unassigned',
            })
        base.update({'status': 'available' if records else 'insufficient_geometry', 'parts': records})
        return base
    except Exception as e:
        base['status'] = 'error'
        base['error'] = str(e)
        return base


def _build_product_part_graph(semantic: dict | None, geometry_confidence: dict | None = None,
                              multi_view: dict | None = None,
                              part_geometry: dict | None = None,
                              mechanical_candidates: dict | None = None) -> dict:
    """Build the evidence-backed Product Part Graph.

    This is intentionally a graph of observed regions, not an AI guess of product
    terminology. A region becomes mechanically interactive only after a later
    authoring/identity stage supplies a semantic name, pivot and transform.
    """
    parts = []
    if semantic and semantic.get('status') == 'available':
        for part in sorted(semantic.get('parts', []), key=lambda p: int(p.get('part_id', 0))):
            pid = int(part.get('part_id', 0))
            mv = next((x for x in (multi_view or {}).get('parts', []) if int(x.get('part_id', -1)) == pid), None)
            pg = next((x for x in (part_geometry or {}).get('parts', []) if int(x.get('part_id', -1)) == pid), None)
            parts.append({
                'id': f'part-{pid}',
                'part_id': pid,
                'name': None,
                'name_status': 'unassigned',
                'parent_id': None,
                'geometry': {
                    'semantic_label': pid,
                    'multi_view': mv or {'stable_3d_evidence': False, 'multi_view_score': 0.0},
                    'observed_3d': pg or {'frame_source': 'unavailable', 'pivot_status': 'not_recovered'},
                    'mechanical_candidates': mc or {'boundary_status': 'unavailable', 'mechanical_axis_status': 'not_recovered'},
                    'assigned_gaussians': int(part.get('assigned_gaussians', 0)),
                    'source': part.get('source', 'sam2_reference_frame'),
                    'confidence': float(part.get('mean_confidence', 0.0)),
                },
                'transform': {
                    'pivot': None,
                    'rotation': [0.0, 0.0, 0.0, 1.0],
                    'translation': [0.0, 0.0, 0.0],
                },
                'capabilities': {
                    # Multi-view evidence is necessary groundwork, not proof of
                    # mechanical behavior. Level 7 must explicitly author/recover
                    # identity, pivot and transform before interaction is enabled.
                    'interactive_ready': False,
                    'animatable': False,
                    'hinge_authored': False,
                },
                'identity': {
                    'source': 'observed_segmentation',
                    'verified': False,
                },
            })
    return {
        'version': 1,
        'fusion_level': 6 if multi_view and multi_view.get('status') == 'available' else 5,
        'status': 'evidence_only' if parts else 'unavailable',
        'root_id': 'product-root',
        'root': {
            'id': 'product-root',
            'name': None,
            'name_status': 'unassigned',
            'type': 'whole_product',
        },
        'parts': parts,
        'edges': [{'parent_id': 'product-root', 'child_id': p['id'], 'relation': 'observed_part'} for p in parts],
        'policy': 'Observed SAM/SAM2 regions are not product names. Mechanical behavior requires explicit identity, pivot and transform authoring.',
        'unseen_geometry_claimed': False,
    }


def _pack_semantic_map(semantic: dict | None) -> bytes | None:
    """Pack Level 5 per-Gaussian semantic evidence.
    v1: FSMP + version + unknown label + part count + Gaussian count +
    uint8 labels + float16 confidence + JSON part metadata.
    """
    if not semantic or semantic.get('status') != 'available':
        return None
    labels = np.asarray(semantic.get('labels', []), dtype=np.uint8)
    confidence = np.asarray(semantic.get('confidence', []), dtype=np.float32)
    if len(labels) == 0 or len(labels) != len(confidence):
        return None
    parts = json.dumps(semantic.get('parts', []), separators=(',', ':')).encode('utf-8')
    header = struct.pack(
        '>4sBBHI', b'FSMP', 1, 255, len(semantic.get('parts', [])), len(labels)
    )
    return (
        header +
        labels.tobytes() +
        confidence.astype('>f2').tobytes() +
        struct.pack('>I', len(parts)) +
        parts
    )

# ─── Stage 6: Layer splitting ─────────────────────────────────────────────────
def split_layers(geo_data: np.ndarray, depth_map: np.ndarray,
                 alpha_mask: np.ndarray, segments: dict) -> bytes:
    """
    Split the reconstructed depth field into layers based on depth + segmentation.

    Layer structure packed as bytes (v2 — adds the indices block):
      [n_layers: uint32]
      per layer:
        [label_len: uint8][label: ascii]
        [depth_min: float32][depth_max: float32]
        [n_points: uint32][points: n_points × 14 × float32]
        [indices: n_points × uint32]   -- original row index into the full
                                        -- KEYFRAME_GEO buffer for each point
                                        -- in this layer, in the same order.
                                        --
                                        -- Added because without this, a
                                        -- layer's points are an unlinked copy:
                                        -- nothing can tell you which points in
                                        -- the main buffer they came from, so a
                                        -- layer could be *viewed* but never
                                        -- *moved* — e.g. NIFAnimator can't
                                        -- rotate "just the door" in the live
                                        -- render buffer without this mapping.
                                        -- (See engine-next/animation/
                                        -- NIFAnimator.js.) NIFViewer.js's
                                        -- _parseLayers() was updated to match
                                        -- — this is a breaking change to the
                                        -- internal (non-public) LAYER_GEO byte
                                        -- layout, not just an appended field.

    The foreground/background split enables:
      - Rendering foreground over arbitrary backgrounds
      - Selecting individual objects (Coca-Cola can, person, product)
      - Parallax depth effect when the viewer tilts the device
      - Background replacement in the video editor
      - Part-level animation (hinge/rotate a named layer) — new
    """
    # geo_data: (N, 14) float32
    positions = geo_data[:, 0:3]  # x,y,z world positions

    # Map point depth (z coordinate in camera space, negative forward) to depth buckets
    # The depth_map from DepthAnything gives metric depth in metres
    # We use z-position directly as the depth proxy for layer splitting
    z_vals = positions[:, 2]  # world-space depth proxy

    # Compute percentile thresholds
    z_min, z_max = np.percentile(z_vals, 5), np.percentile(z_vals, 95)
    z_range = max(z_max - z_min, 0.01)

    # Define layers
    layer_defs = [
        {'label': 'foreground', 'z_min': z_min,                  'z_max': z_min + z_range*0.3},
        {'label': 'midground',  'z_min': z_min + z_range*0.3,    'z_max': z_min + z_range*0.7},
        {'label': 'background', 'z_min': z_min + z_range*0.7,    'z_max': z_max + 1.0},
    ]

    # Also add per-segment layers from SAM
    for seg_id, seg in segments.items():
        if seg['area'] > 1000:  # only sizeable segments
            layer_defs.append({
                'label':  f'segment_{seg_id}',
                'z_min':  z_min,
                'z_max':  z_max + 1.0,
                'mask_filter': seg['mask'],  # optional: spatial mask filter
            })

    parts = [struct.pack('>I', len(layer_defs))]

    for ld in layer_defs:
        mask = (z_vals >= ld['z_min']) & (z_vals < ld['z_max'])
        indices = np.where(mask)[0].astype('>u4')  # big-endian uint32 — matches
                                                    # every other integer in this
                                                    # format (JS reads via
                                                    # DataView with `false` =
                                                    # big-endian throughout).
                                                    # Plain np.uint32.tobytes()
                                                    # would use native byte order
                                                    # (little-endian on the
                                                    # Kaggle GPU boxes this
                                                    # actually runs on), which
                                                    # would silently corrupt
                                                    # every index on read.
        pts  = geo_data[mask]
        label_b = ld['label'].encode('ascii')[:32]
        parts.append(struct.pack('>B', len(label_b)) + label_b)
        parts.append(struct.pack('>ff', float(ld['z_min']), float(ld['z_max'])))
        parts.append(struct.pack('>I', len(pts)))
        parts.append(pts.astype(np.float32).tobytes())
        parts.append(indices.tobytes())  # big-endian to match struct.pack('>I', ...) above

    layer_summary = ', '.join(
        f'{ld["label"]}:{int(((z_vals >= ld["z_min"]) & (z_vals < ld["z_max"])).sum())}'
        for ld in layer_defs
    )
    print(f'[NIF] Layer split: {layer_summary}')
    return b''.join(parts)


# ─── Stage 7: Proxy video ──────────────────────────────────────────────────────
def encode_proxy_video(frames_dir: Path, fps: int) -> bytes:
    """Encode input frames as H.264 proxy video for social sharing."""
    out_path = frames_dir.parent / 'proxy.mp4'
    r = subprocess.run([
        'ffmpeg', '-y',
        '-framerate', str(fps),
        '-i', str(frames_dir / 'frame_%05d.jpg'),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',  # web-optimised
        '-vf', 'scale=1280:-2',     # cap at 720p for proxy
        str(out_path),
    ], capture_output=True, text=True)
    if r.returncode != 0 or not out_path.exists():
        print(f'[NIF] ffmpeg proxy failed: {r.stderr[-200:]}')
        return b''
    data = out_path.read_bytes()
    print(f'[NIF] Proxy video: {len(data):,}B')
    return data


# ─── Worker ───────────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def _patch(job_id: str, payload: dict):
    """
    Write job progress straight to reconstruction_jobs in Supabase.

    This used to PATCH `{API_BASE}/api/jobs/{job_id}/progress`, which requires
    engine-next/backend-api to be deployed — per ROADMAP.md that's still
    "untested... not yet wired." reconstruction_jobs itself is the real, live
    table (confirmed directly against fumoca-production), and claim_next_job()
    already talks to it straight from the Kaggle worker, so progress updates
    do the same rather than depending on a service that isn't running.
    """
    row = {k: v for k, v in payload.items()}
    if row.get('status') == 'processing' and 'started_at' not in row:
        pass  # started_at is already set by claim_next_reconstruction_job()
    try:
        SB.table('reconstruction_jobs').update(row).eq('id', job_id).execute()
    except Exception as e:
        print(f'[warn] Supabase progress update failed: {e}')


class ReconstructionWorker:

    def __init__(self, job_id: str, user_id: str):
        self.job_id  = job_id
        self.user_id = user_id
        self.tmp     = Path(tempfile.mkdtemp(prefix=f'nif_{job_id[:8]}_'))
        self.deblur  = DeblurNet().to(DEVICE).eval()

    def _tick(self, status: str, pct: int, **kw):
        _patch(self.job_id, {'status': status, 'progress': pct, **kw})
        print(f'[NIF] {self.job_id[:8]} {status} {pct}%')

    def run(self, raw_r2_key: str, vertical: str, capture_mode: str, meta: dict):
        try:
            self._tick('processing', 5)
            raw = self._download(raw_r2_key)

            self._tick('processing', 10)
            frames, fps = self._extract_frames(raw, capture_mode)
            print(f'[NIF] {len(frames)} frames at {fps}fps')

            # ── Frame usefulness filter — analyze all extracted frames,
            # keep the ones that add real coverage (drop blur/near-dupes).
            # Runs before deblur/depth/bg-removal/COLMAP so none of those
            # more expensive stages pay for frames that add no viewpoint.
            self._tick('processing', 14)
            frames = self._select_useful_frames(frames)

            # ── Viewpoint coverage filter — second stage, using actual
            # estimated relative camera rotation rather than pixel
            # difference. See _select_by_viewpoint_coverage's docstring for
            # why this is a cheap proxy rather than full COLMAP-based
            # coverage (poses aren't known yet at this point).
            self._tick('processing', 16)
            frames = self._select_by_viewpoint_coverage(frames)

            self._tick('processing', 18)
            frames = self._deblur_frames(frames)

            # ── Depth estimation — now runs on every useful frame, not just
            # the first. depth_maps[0] (the reference frame) still drives
            # calibration and the single-frame CHUNK_DEPTH/CHUNK_ALPHA
            # entries, since those chunks are reference-frame-only by
            # format — but full-frame depth/masks are available below for
            # anything that wants per-frame coverage rather than a single
            # snapshot.
            self._tick('processing', 25)
            ref_frame = frames[0]
            depth_maps, is_metric_depth = estimate_depth(frames, vertical)
            depth_map  = depth_maps[0]  # (H, W) float32 — reference frame

            # ── Scale calibration — determines whether/how reconstruction-
            # space units map to real metres. Computed here (frame + depth
            # available) but applied later, after mesh extraction, since that's
            # where "positions" actually get consumed for anything metric.
            calibration = estimate_scale(ref_frame, depth_map, is_metric_depth, meta)
            print(f"[NIF] Calibration: {calibration['method']} "
                  f"(confidence={calibration['confidence']}) — {calibration['note']}")

            # ── Background removal — now runs on every useful frame.
            # alpha_masks[0] still backs the single-frame CHUNK_ALPHA and
            # reference segmentation below.
            self._tick('processing', 33)
            alpha_masks = remove_background(frames)
            alpha_mask  = alpha_masks[0]  # (H, W) uint8 — reference frame

            # ── Temporal object tracking — SAM 2's video predictor,
            # propagating ONE tracked object identity across every frame
            # (seeded automatically from alpha_masks[0]'s largest foreground
            # component). This replaces the per-frame independent bg-removal
            # masks with masks that all refer to the same tracked object —
            # falls back to the untracked alpha_masks unchanged if SAM 2's
            # video predictor isn't installed/configured. See
            # track_primary_object()'s docstring for the real caveat: this
            # is unexecuted here, no GPU/SAM2 in this environment.
            self._tick('processing', 36)
            object_masks = track_primary_object(frames, alpha_masks)

            # ── Segmentation ──────────────────────────────────────────────────
            self._tick('processing', 38)
            segments = segment_objects(ref_frame, alpha_mask)

            # ── Pose estimation — also validates geometry (pose_source tells
            # us whether COLMAP actually produced real multi-view geometry,
            # or fell back to a synthetic orbit) and returns COLMAP's sparse
            # point cloud when available, so training can start from real
            # geometry instead of random noise.
            self._tick('processing', 42)
            poses, pose_source, sparse_points = self._estimate_poses(frames)

            # ── Geometry quality gate — opt-in hard stop before Gaussian
            # training. Default is off (FUMOCA_STRICT_GEOMETRY_GATE unset),
            # which preserves the existing behavior: a synthetic/degraded
            # pose_source still trains (at reduced budget — see
            # _train_gaussians) and ships a result explicitly labeled
            # 'pose_estimation_fallback' in quality_warnings, rather than
            # failing the job outright. Set FUMOCA_STRICT_GEOMETRY_GATE=1 to
            # instead abort here — no training, no mesh, no NIF — whenever
            # pose_source isn't 'colmap'. This is a product decision, not a
            # correctness one: which behavior you want depends on whether a
            # visibly-labeled degraded result is useful to ship or worse
            # than no result at all. Raising here routes through run()'s
            # existing except-block failure path (self._tick('failed', ...)),
            # so no new error-handling plumbing is needed.
            if os.environ.get('FUMOCA_STRICT_GEOMETRY_GATE') == '1' and pose_source != 'colmap':
                raise RuntimeError(
                    f'Geometry validation failed (pose_source={pose_source}) — '
                    f'FUMOCA_STRICT_GEOMETRY_GATE=1 aborts before Gaussian training '
                    f'instead of training on a synthetic/degraded fallback.'
                )

            # ── 3D depth field training — geometry-derived init when pose_source
            # == 'colmap' (real SfM geometry), and a reduced iteration budget
            # when it isn't, instead of spending the full budget optimizing
            # against poses already known to be a synthetic fallback.
            self._tick('processing', 52)
            n, geo_bytes, appearance_bytes, eval_psnr = self._train_gaussians(
                frames,
                poses,
                sparse_points,
                pose_source,
                object_masks=object_masks,
                depth_maps=depth_maps
            )

            # Dequantize for internal use (mesh extraction, layer splitting need
            # the canonical float32 form regardless of which format was written).
            # Previously this hard-rejected anything but flag 0x00 — but
            # export_buffer() returns flag 0x01 (quantized) by default, so every
            # successful training run would have crashed right here.
            count, geo_data = _dequantize_geometry(geo_bytes)

            # ── Apply scale calibration (if any) before anything metric-facing
            # consumes positions. The raw GEO/LAYER chunks stay in native
            # reconstruction-space units unchanged (that's what the existing
            # viewer already renders and nothing needs to break there) — only
            # the mesh, STL, and captured_dimensions below get calibrated,
            # since those are exactly the outputs product-verification and
            # printing actually depend on being real-world accurate.
            scale_factor = calibration.get('scale_factor')
            mesh_geo_data = geo_data.copy()
            if scale_factor:
                mesh_geo_data[:, 0:3] *= scale_factor

            # ── Real mesh extraction — triangulation from the trained Gaussians ─
            self._tick('processing', 65)
            mesh_bytes, stl_bytes, mesh_info = self._extract_mesh(mesh_geo_data)
            encapsulation = _encapsulation_report(
                mesh_info, poses, mesh_geo_data, object_masks, alpha_masks
            )
            surface_camera_evidence = _surface_camera_evidence(
                mesh_geo_data,
                poses,
                object_masks,
                image_shape=frames[0].shape[:2] if frames else None,
            )
            depth_visibility_evidence = _surface_depth_visibility_evidence(
                mesh_geo_data,
                poses,
                object_masks,
                depth_maps,
                image_shape=frames[0].shape[:2] if frames else None,
            )
            encapsulation['surface_camera_evidence'] = surface_camera_evidence
            encapsulation['depth_visibility_evidence'] = depth_visibility_evidence
            geometry_confidence = _surface_geometry_confidence(
                mesh_geo_data,
                encapsulation,
                mesh_info,
                poses,
                object_masks,
                depth_maps,
                image_shape=frames[0].shape[:2] if frames else None,
            )
            encapsulation['geometry_confidence'] = geometry_confidence
            semantic_evidence = _semantic_part_evidence(
                mesh_geo_data,
                segments,
                poses[0] if poses else None,
                image_shape=frames[0].shape[:2] if frames else None,
                geometry_confidence=geometry_confidence,
            )
            encapsulation['semantic_part_evidence'] = {
                k: v for k, v in semantic_evidence.items()
                if k not in ('labels', 'confidence')
            }
            # Level 6: carry the canonical Gaussian positions through the fusion
            # function without serialising them into the evidence chunk.
            semantic_evidence['_positions'] = mesh_geo_data[:, :3] if mesh_geo_data is not None else None
            multi_view_part_fusion = _multi_view_part_fusion(
                semantic_evidence,
                poses,
                object_masks,
                image_shape=frames[0].shape[:2] if frames else None,
            )
            part_geometry_evidence = _part_geometry_evidence(semantic_evidence, multi_view_part_fusion)
            mechanical_candidates = _part_mechanical_candidates(semantic_evidence, part_geometry_evidence)
            semantic_evidence.pop('_positions', None)
            encapsulation['multi_view_part_fusion'] = multi_view_part_fusion
            encapsulation['part_geometry_evidence'] = part_geometry_evidence
            encapsulation['mechanical_candidates'] = mechanical_candidates
            if mesh_info is not None:
                mesh_info['encapsulation'] = encapsulation

            self._tick('processing', 72)
            layer_bytes = split_layers(
                geo_data,
                depth_map,
                alpha_mask,
                segments
            )

            # ── Proxy video ───────────────────────────────────────────────────
            self._tick('processing', 78)
            frames_dir  = self.tmp / 'frames'
            proxy_bytes = encode_proxy_video(frames_dir, fps)

            # ── Thumbnail bytes (built once, used two ways below) ──────────────
            thumb_bytes = self._make_thumbnail_bytes(frames)

            # ── Pack .nif ─────────────────────────────────────────────────────
            self._tick('processing', 84)
            semantic_bytes = _pack_semantic_map(semantic_evidence)
            part_graph = _build_product_part_graph(semantic_evidence, geometry_confidence, multi_view_part_fusion, part_geometry_evidence, mechanical_candidates)
            part_graph_bytes = json.dumps(part_graph, separators=(',', ':')).encode('utf-8')
            chunks = [
                # geo_bytes already contains its own [flag][count][data] header
                # (built by export_buffer()) — do NOT prepend another count field,
                # that was corrupting every CHUNK_GEO ever written.
                (CHUNK_GEO,     geo_bytes),
                (CHUNK_CAMERAS, self._pack_cameras(poses, pose_source)),
                (CHUNK_DEPTH,   self._pack_depth_map(depth_map)),
                (CHUNK_ALPHA,   self._pack_alpha_mask(alpha_mask)),
                (CHUNK_LAYER,   layer_bytes),
                # META/THUMBNAIL make the file self-describing on its own, matching
                # what the JS editor's save path already writes (see NIFSpec.js /
                # nif-format.js) — without these, a .nif produced by this worker
                # had no title, no hotspots, and no poster image outside Supabase.
                (CHUNK_META,    self._pack_meta(vertical, meta)),
                (CHUNK_PHYSICS, json.dumps(_build_physics_chunk(mesh_info, vertical, calibration, meta)).encode('utf-8')),
                (CHUNK_CALIB,   json.dumps(calibration).encode('utf-8')),
                (CHUNK_ENCAPSULATION, json.dumps(
                    (mesh_info or {}).get('encapsulation', {})
                ).encode('utf-8')),
                *([(CHUNK_SEM, semantic_bytes)] if semantic_bytes else []),
                *([(CHUNK_APPEARANCE, appearance_bytes)] if appearance_bytes else []),
                (CHUNK_PART_GRAPH, part_graph_bytes),
            ]
            # ── Product verification — only runs when the job explicitly
            # supplies a reference mesh to compare against (meta
            # ['verify_reference_r2_key']). Absence of CHUNK_VERIFY means
            # "not requested", not "passed" — never inferred as a pass.
            verify_reference_key = meta.get('verify_reference_r2_key')
            if verify_reference_key and mesh_bytes:
                try:
                    from verify import verify_nif_meshes
                    ref_path = self._download(verify_reference_key)
                    ref_format = ref_path.suffix.lstrip('.').lower() or 'stl'
                    verification = verify_nif_meshes(
                        mesh_bytes, ref_path.read_bytes(),
                        reference_format=ref_format,
                        tolerance_mm=float(meta.get('verify_tolerance_mm', 2.0)),
                        candidate_calibrated=bool(scale_factor),
                    )
                    chunks.append((CHUNK_VERIFY, json.dumps(verification).encode('utf-8')))
                    print(f"[NIF] Verification: pass={verification.get('pass')} "
                          f"mean_dev={verification.get('mean_deviation')}")
                except Exception as e:
                    print(f'[NIF] Verification failed (non-fatal, no CHUNK_VERIFY written): {e}')
            if thumb_bytes:
                chunks.append((CHUNK_THUMB, thumb_bytes))
            if mesh_bytes:
                chunks.append((CHUNK_MESH, mesh_bytes))
            if stl_bytes:
                chunks.append((CHUNK_PRINT, stl_bytes))
            if proxy_bytes:
                chunks.insert(0, (CHUNK_PROXY, proxy_bytes))

            nif_bytes = pack_nif(chunks, vertical, fps)
            # Log compression stats
            raw_geo_size = 4 + n * 14 * 4
            nif_total    = len(nif_bytes)
            print(f'[NIF] Packed: {nif_total:,}B  '
                  f'(geo raw={raw_geo_size:,}B, total compression ratio='
                  f'{nif_total / max(raw_geo_size + len(proxy_bytes or b""),1):.2f}x)')

            # ── Upload ────────────────────────────────────────────────────────
            self._tick('processing', 90)
            r2_key = self._upload_nif(nif_bytes)

            # ── Upload proxy video separately for sharing/delivery ─────────────
            proxy_r2_key  = None
            if proxy_bytes:
                proxy_r2_key = self._upload_proxy_video(proxy_bytes, fps)
            thumbnail_r2 = self._upload_thumbnail_bytes(thumb_bytes)

            # ── Compute captured dimensions from the (possibly calibrated)
            # mesh-space positions — labeled honestly depending on whether a
            # real scale_factor was actually applied, not assumed.
            captured_dims = None
            try:
                xs = mesh_geo_data[:,0]; ys = mesh_geo_data[:,1]; zs = mesh_geo_data[:,2]
                dims_key = 'm' if scale_factor else 'units'
                captured_dims = {
                    f'height_{dims_key}': float(round(float(ys.max()-ys.min()), 3)),
                    f'width_{dims_key}':  float(round(float(xs.max()-xs.min()), 3)),
                    f'depth_{dims_key}':  float(round(float(zs.max()-zs.min()), 3)),
                    'calibrated': bool(scale_factor),
                }
                print(f'[NIF] Dims: {captured_dims}')
            except Exception as e:
                print(f'[NIF] Dimension extraction failed: {e}')

            # ── Quality gating — make degraded output loud, not silent. A
            # verification/print consumer needs to know *before* trusting a
            # file, not discover it after the fact from a support ticket.
            quality_warnings = []
            if pose_source != 'colmap':
                quality_warnings.append('pose_estimation_fallback')  # synthetic poses, not real multi-view SfM
            if calibration['confidence'] in ('none', 'medium'):
                quality_warnings.append(f"scale_confidence_{calibration['confidence']}")
            if not mesh_bytes:
                quality_warnings.append('mesh_extraction_failed')
            if object_masks is alpha_masks:  # `is` check: track_primary_object falls
                # back by returning alpha_masks unchanged (same object) on any
                # failure/unavailability — this distinguishes that from a real
                # tracked result without needing a second return value.
                quality_warnings.append('object_tracking_unavailable')
            # PSNR check: eval_psnr is None when there weren't enough poses
            # to hold any out (see _train_gaussians) — that's a "couldn't
            # measure" case, not a "measured and it's bad" case, so it does
            # NOT get flagged here on its own; low_reconstruction_quality
            # AND holdout_frames_insufficient_for_eval are kept as distinct,
            # honest signals rather than collapsing "unmeasured" into "bad".
            if eval_psnr is not None and eval_psnr < 18.0:
                quality_warnings.append(f'low_reconstruction_psnr_{eval_psnr:.1f}db')
            elif eval_psnr is None:
                quality_warnings.append('holdout_frames_insufficient_for_eval')
            if mesh_info and not mesh_info.get('is_watertight'):
                quality_warnings.append('mesh_not_watertight')
            if mesh_info and mesh_info.get('boundary_edges', 0):
                quality_warnings.append(f"mesh_boundary_edges_{mesh_info['boundary_edges']}")
            if mesh_info and mesh_info.get('nonmanifold_edges', 0):
                quality_warnings.append(f"mesh_nonmanifold_edges_{mesh_info['nonmanifold_edges']}")
            if mesh_info and not mesh_info.get('is_winding_consistent', True):
                quality_warnings.append('mesh_winding_inconsistent')
            if mesh_info and not mesh_info.get('is_volume', False):
                quality_warnings.append('mesh_not_valid_volume')
            if mesh_info and not mesh_info.get('printable', False):
                quality_warnings.append('mesh_not_printable')
            if mesh_info and mesh_info.get('n_degenerate_faces'):
                n_deg = mesh_info['n_degenerate_faces']
                n_tot = mesh_info.get('n_faces') or 1
                if n_deg / n_tot > 0.05:  # >5% degenerate faces — provisional threshold, same caveat as PSNR
                    quality_warnings.append(f'high_degenerate_face_ratio_{n_deg}_of_{n_tot}')
            reconstruction_quality = 'full_multiview' if pose_source == 'colmap' else 'degraded_fallback'
            verified_for_measurement = (
                pose_source == 'colmap'
                and calibration['confidence'] in ('high', 'medium')
                and bool(mesh_bytes)
            )

            # ── Minimum-acceptable gate — this is the line between "shippable
            # to a client" and "needs a retry." It is deliberately narrower
            # than verified_for_measurement: verified_for_measurement is about
            # whether you can trust a *measurement* off this file (needs real
            # calibration too); MIN_ACCEPTABLE is about whether the object
            # reconstructed at all. A capture with no calibration marker can
            # still legitimately pass this gate and go live — it just won't
            # be measurement-verified. A capture that fell back to a
            # synthetic circular-orbit pose (no real multi-view geometry) or
            # never produced a mesh should NOT reach a client looking like a
            # finished result — those get sent back for a retry instead.
            min_acceptable = (pose_source == 'colmap') and bool(mesh_bytes)
            quality_reason = None
            if not min_acceptable:
                reasons = []
                if pose_source != 'colmap':
                    reasons.append('not enough usable viewpoints for a real 3D reconstruction — '
                                    'try recapturing with a slower, fuller orbit around the object')
                if not mesh_bytes:
                    reasons.append('mesh extraction failed on the reconstructed geometry')
                quality_reason = '; '.join(reasons)

            # ── Register ──────────────────────────────────────────────────────
            self._tick('processing', 95)
            self._register(r2_key, n, vertical, meta, nif_total, {
                'has_depth_map':     True,
                'has_alpha_mask':    True,
                'has_layers':        True,
                'has_proxy':         bool(proxy_bytes),
                'n_segments':        len(segments),
                'compressed':        True,
                'proxy_r2_key':      proxy_r2_key,
                'thumbnail_r2_key':  thumbnail_r2,
                'captured_dimensions': captured_dims,
                'pose_source':       pose_source,  # 'colmap' = real multi-view reconstruction;
                                                    # 'synthetic_*' = depth-based pseudo-3D fallback
                'reconstruction_quality': reconstruction_quality,
                'has_mesh':          bool(mesh_bytes),  # real triangulated geometry, not just splats
                # NOT the same as bool(stl_bytes) — STL export can succeed on
                # a leaky/non-manifold mesh and still fail slicer validation.
                # This is the actual "will this print" signal; STL bytes
                # existing only means the export step didn't crash.
                'mesh_watertight':   bool(mesh_info.get('is_watertight')) if mesh_info else False,
                'mesh_printable':     bool(mesh_info.get('printable')) if mesh_info else False,
                'mesh_volume_m3':     mesh_info.get('volume_m3') if mesh_info else None,
                'mesh_quality':       mesh_info or {},
                'encapsulation':       (mesh_info or {}).get('encapsulation', {}),
                'has_print_export':   bool(stl_bytes) and bool(mesh_info and mesh_info.get('printable')),
                'calibration_method':     calibration['method'],
                'calibration_confidence': calibration['confidence'],
                'quality_warnings':       quality_warnings,  # [] means nothing flagged
                # True only when pose + scale + mesh all clear the bar for
                # trusting a measurement/verification decision on this file.
                # False does NOT mean "broken" — a nice-looking demo capture
                # with no calibration marker will still legitimately be False.
                'verified_for_measurement': verified_for_measurement,
                'min_acceptable':    min_acceptable,
                'quality_reason':    quality_reason,
            }, min_acceptable=min_acceptable, quality_reason=quality_reason)

            if min_acceptable:
                self._tick('complete', 100, nif_r2_key=r2_key, gaussian_count=n,
                            completed_at=_now_iso())
            else:
                # Terminal state distinct from both 'complete' and 'failed'.
                # The file IS written and registered (nothing is thrown away —
                # useful for internal debugging), but the client-facing status
                # is a clear "try again," not a silently-shipped bad result and
                # not an opaque "failed" that looks like a system error.
                print(f'[NIF] {self.job_id[:8]} below minimum-acceptable bar: {quality_reason}')
                self._tick('needs_retry', 100, nif_r2_key=r2_key, gaussian_count=n,
                            error_message=quality_reason, completed_at=_now_iso())
            return r2_key

        except Exception as e:
            self._tick('failed', 0, error_message=str(e), completed_at=_now_iso())
            raise
        finally:
            shutil.rmtree(self.tmp, ignore_errors=True)

    # ── Chunk packers ──────────────────────────────────────────────────────────
    def _pack_depth_map(self, depth: np.ndarray) -> bytes:
        """Pack float32 depth map as float16 (half the size, sufficient precision)."""
        H, W    = depth.shape
        f16     = depth.astype(np.float16)
        header  = struct.pack('>HH', H, W)
        return header + f16.tobytes()

    def _pack_alpha_mask(self, mask: np.ndarray) -> bytes:
        """Pack uint8 alpha mask."""
        H, W   = mask.shape
        header = struct.pack('>HH', H, W)
        return header + mask.astype(np.uint8).tobytes()

    def _pack_cameras(self, poses: list, pose_source: str) -> bytes:
        """
        Pack camera view matrices as their own chunk, independent of CHUNK_GEO.

        Layout:
          [count:u32 BE][pose_source_len:u8][pose_source: ascii, pose_source_len bytes]
          then count × 16 float32 BE (row-major 4×4 view matrix, world→camera)

        pose_source is carried along ('colmap' = real multi-view SfM vs
        'synthetic_*' = fallback orbit) so a viewer/editor can tell whether the
        camera path reflects the actual capture or is an approximation —
        the same distinction already tracked in meta.reconstruction_quality,
        now available without needing the rest of the job's metadata.
        """
        src = pose_source.encode('ascii')[:255]
        header = struct.pack('>IB', len(poses), len(src)) + src
        body = b''.join(
            struct.pack('>16f', *(p.detach().cpu().numpy().astype(np.float32).flatten().tolist()))
            for p in poses
        )
        return header + body

    # ── Download ───────────────────────────────────────────────────────────────
    def _download(self, key: str) -> Path:
        ext  = Path(key).suffix or '.bin'
        path = self.tmp / f'capture{ext}'
        R2.download_file(RAW_BUCKET, key, str(path))
        print(f'[NIF] Downloaded {path.stat().st_size:,}B')
        return path

    # ── Frame extraction ───────────────────────────────────────────────────────
    def _extract_frames(self, src: Path, mode: str) -> tuple:
        out_dir = self.tmp / 'frames'
        out_dir.mkdir()
        fps = 5

        if mode == 'burst':
            # Multi-photo capture arrives as a single .zip (built client-side
            # by js/modules/zip-writer.js) — unzip it first. Previously this
            # branch assumed images were already loose next to the downloaded
            # file, which never happens: _download() always fetches exactly
            # one file, and that file IS the zip.
            if src.suffix.lower() == '.zip':
                extract_dir = self.tmp / 'burst_extracted'
                extract_dir.mkdir(exist_ok=True)
                with zipfile.ZipFile(src) as zf:
                    zf.extractall(extract_dir)
                img_paths = sorted(
                    p for ext in ('*.jpg', '*.jpeg', '*.png', '*.JPG', '*.JPEG', '*.PNG')
                    for p in extract_dir.glob(ext)
                )
            else:
                img_paths = sorted(src.parent.glob('*.jpg'))

            if len(img_paths) < 3:
                raise RuntimeError(
                    f'Burst capture needs at least 3 images for real multi-view '
                    f'reconstruction — got {len(img_paths)}.'
                )
            for i, img in enumerate(img_paths):
                shutil.copy(img, out_dir / f'frame_{i:05d}.jpg')

        elif mode in ('image', 'photo'):
            # Single image — duplicate to create minimal multi-view illusion
            shutil.copy(src, out_dir / 'frame_00001.jpg')
            shutil.copy(src, out_dir / 'frame_00002.jpg')
            fps = 1

        else:
            # Default: everything else really is a video file — this
            # includes every real capture_mode value the app's own UI
            # actually sends (orbit_360, orbit_180, exterior_car,
            # interior_front, interior_rear — see CAPTURE_SCRIPTS in
            # js/modules/capture-guide.js, which sets capture_mode to the
            # script's own key, never the literal string 'video'). A
            # whitelist of exact mode strings here would silently produce
            # zero frames for every one of those — this happened.
            r = subprocess.run([
                'ffmpeg', '-i', str(src), '-q:v', '2',
                '-vf', f'fps={fps},scale=1280:-2',
                str(out_dir / 'frame_%05d.jpg'),
            ], capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f'ffmpeg failed:\n{r.stderr[-500:]}')

        frames = []
        for p in sorted(out_dir.glob('*.jpg')):
            img = np.array(Image.open(p).convert('RGB'))
            frames.append(img)

        # ── Frame cap: opt-in only, off by default ──────────────────────────
        # No default ceiling — every extracted frame goes to pose estimation
        # and feeds detail/depth. FUMOCA_MAX_RECON_FRAMES stays available as
        # an explicit operator override (e.g. to bound cost on a quota'd GPU
        # box) but is unset by default, so it no longer silently throws away
        # coverage. Lifting this only stays affordable because
        # _estimate_poses now uses COLMAP's sequential (video-order) matcher
        # instead of exhaustive — see the --data_type change there. Without
        # that change, un-capping frame count here would make matching cost
        # blow up closer to quadratically instead of linearly.
        max_frames_env = os.environ.get('FUMOCA_MAX_RECON_FRAMES')
        if max_frames_env:
            max_frames = int(max_frames_env)
            if len(frames) > max_frames:
                stride = len(frames) / max_frames
                idxs = [int(i * stride) for i in range(max_frames)]
                frames = [frames[i] for i in idxs]

        return frames, fps

    # ── Frame usefulness filter ───────────────────────────────────────────────
    def _select_useful_frames(self, frames: list) -> list:
        """
        Drop frames that don't add useful coverage: heavily blurred/motion-
        smeared frames, and frames that are near-duplicates of the last
        *kept* frame (camera paused, or fps outran actual camera motion).

        This is deliberately a cheap, self-contained filter — grayscale
        Laplacian variance for blur, downsampled mean-abs-difference for
        redundancy — not a learned coverage model. It's the "analyze ALL
        useful frames" / "select useful viewpoints" step: with the frame cap
        removed (_extract_frames no longer truncates), a 300+ frame orbit
        capture would otherwise feed COLMAP and per-frame depth/bg-removal
        with a lot of frames that add compute cost but no new viewpoint —
        this trims those before the expensive stages, rather than after.

        Always keeps the first and last frame (orbit start/end), and never
        drops below MIN_KEEP frames even if every frame scores badly — a
        capture that's uniformly blurry should still get a best-effort
        reconstruction with a quality warning downstream, not zero frames.
        """
        if len(frames) <= 3:
            return frames

        MIN_KEEP = max(3, int(os.environ.get('FUMOCA_MIN_USEFUL_FRAMES', '12')))
        BLUR_PERCENTILE = float(os.environ.get('FUMOCA_BLUR_DROP_PERCENTILE', '15'))
        DUP_THRESHOLD   = float(os.environ.get('FUMOCA_DUP_THRESHOLD', '2.0'))  # mean abs diff, 0-255 scale

        try:
            import cv2
            def blur_score(gray):
                return cv2.Laplacian(gray, cv2.CV_64F).var()
        except ImportError:
            # numpy-only fallback: a simple discrete Laplacian via shifted
            # differences — cruder than cv2's kernel but the same idea
            # (edge energy — sharp frames have more of it than blurred ones).
            def blur_score(gray):
                lap = (-4 * gray
                       + np.roll(gray, 1, axis=0) + np.roll(gray, -1, axis=0)
                       + np.roll(gray, 1, axis=1) + np.roll(gray, -1, axis=1))
                return float(lap.var())

        grays = [np.asarray(Image.fromarray(f).convert('L').resize((160, 90))) for f in frames]
        blur_scores = np.array([blur_score(g.astype(np.float64)) for g in grays])

        blur_cutoff = np.percentile(blur_scores, BLUR_PERCENTILE)

        kept_idxs = [0]  # always keep first frame
        last_kept_gray = grays[0].astype(np.float64)
        for i in range(1, len(frames) - 1):
            if blur_scores[i] < blur_cutoff:
                continue  # too blurred — no new usable detail
            diff = np.abs(grays[i].astype(np.float64) - last_kept_gray).mean()
            if diff < DUP_THRESHOLD:
                continue  # near-duplicate of the last kept frame — no new coverage
            kept_idxs.append(i)
            last_kept_gray = grays[i].astype(np.float64)
        kept_idxs.append(len(frames) - 1)  # always keep last frame

        # Floor: if filtering was too aggressive (e.g. a genuinely static
        # capture), fall back to an even stride over all frames rather than
        # shipping a near-empty set.
        if len(kept_idxs) < MIN_KEEP:
            stride = len(frames) / MIN_KEEP
            kept_idxs = sorted(set(int(i * stride) for i in range(MIN_KEEP)) | {0, len(frames) - 1})

        useful = [frames[i] for i in sorted(set(kept_idxs))]
        print(f'[NIF] Frame usefulness filter: {len(frames)} → {len(useful)} frames '
              f'(dropped blurred/redundant, kept full-orbit coverage)')
        return useful

    # ── Viewpoint coverage filter ─────────────────────────────────────────────
    def _select_by_viewpoint_coverage(self, frames: list) -> list:
        """
        Second-stage filter, run after _select_useful_frames. That filter
        only knows "this frame looks different from the last kept one" —
        which conflates real new viewpoint with things like exposure
        flicker, motion blur variation, or the subject itself moving while
        the camera holds still. This filter estimates actual relative
        camera rotation between consecutive frames (a cheap visual-odometry
        style keyframe selection, not full SfM) and only keeps a frame once
        the camera has genuinely rotated past a threshold since the last
        kept keyframe — the real "does this give a new 3D viewpoint"
        question, as opposed to "does this look different".

        Deliberately NOT full COLMAP-based coverage: that needs poses,
        which is exactly the expensive step this filter runs before, to
        keep affordable on a large frame set. This is the cheap proxy for
        it — relative pose between adjacent frame *pairs* only, via ORB
        feature matching + essential matrix decomposition, no global
        bundle adjustment or absolute pose.

        Safe-by-default on failure: if OpenCV isn't available, or a given
        pair doesn't have enough feature matches to estimate a reliable
        essential matrix (common on close-up, low-texture, or blurry
        pairs), the frame is KEPT rather than dropped — an uncertain-but-
        kept frame just costs a little extra COLMAP time; an incorrectly
        dropped frame is coverage that's gone for good.
        """
        try:
            import cv2
        except ImportError:
            print('[NIF] cv2 not available — skipping viewpoint-coverage filter, '
                  'keeping all usefulness-filtered frames')
            return frames

        if len(frames) <= 3:
            return frames

        MIN_KEEP = max(3, int(os.environ.get('FUMOCA_MIN_USEFUL_FRAMES', '12')))
        ANGLE_THRESHOLD_DEG = float(os.environ.get('FUMOCA_VIEWPOINT_ANGLE_DEG', '8.0'))
        MIN_MATCHES = 20

        H, W = frames[0].shape[:2]
        fx = fy = max(H, W) * 0.8  # same rough-intrinsics assumption used later in _train_gaussians
        K = np.array([[fx, 0, W/2], [0, fy, H/2], [0, 0, 1]], dtype=np.float64)

        orb = cv2.ORB_create(nfeatures=800)
        bf  = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

        def relative_angle_deg(img_a, img_b):
            """Rotation angle (degrees) between two frames via ORB matches
            + essential matrix, or None if it can't be estimated reliably."""
            ga = cv2.cvtColor(img_a, cv2.COLOR_RGB2GRAY)
            gb = cv2.cvtColor(img_b, cv2.COLOR_RGB2GRAY)
            kp1, des1 = orb.detectAndCompute(ga, None)
            kp2, des2 = orb.detectAndCompute(gb, None)
            if des1 is None or des2 is None or len(kp1) < MIN_MATCHES or len(kp2) < MIN_MATCHES:
                return None
            matches = bf.match(des1, des2)
            if len(matches) < MIN_MATCHES:
                return None
            pts1 = np.float32([kp1[m.queryIdx].pt for m in matches])
            pts2 = np.float32([kp2[m.trainIdx].pt for m in matches])
            E, mask = cv2.findEssentialMat(pts1, pts2, K, method=cv2.RANSAC,
                                            prob=0.999, threshold=1.0)
            if E is None or E.shape != (3, 3):
                return None
            _, R, _t, _mask = cv2.recoverPose(E, pts1, pts2, K)
            # Rotation angle from R via the standard trace formula.
            cos_angle = (np.trace(R) - 1.0) / 2.0
            cos_angle = np.clip(cos_angle, -1.0, 1.0)
            return float(np.degrees(np.arccos(cos_angle)))

        kept_idxs = [0]
        last_kept_frame = frames[0]
        uncertain_count = 0
        for i in range(1, len(frames) - 1):
            angle = relative_angle_deg(last_kept_frame, frames[i])
            if angle is None:
                kept_idxs.append(i)  # can't measure — keep, safe default
                last_kept_frame = frames[i]
                uncertain_count += 1
                continue
            if angle >= ANGLE_THRESHOLD_DEG:
                kept_idxs.append(i)
                last_kept_frame = frames[i]
        kept_idxs.append(len(frames) - 1)

        if len(kept_idxs) < MIN_KEEP:
            stride = len(frames) / MIN_KEEP
            kept_idxs = sorted(set(int(i * stride) for i in range(MIN_KEEP)) | {0, len(frames) - 1})

        covered = [frames[i] for i in sorted(set(kept_idxs))]
        print(f'[NIF] Viewpoint coverage filter: {len(frames)} → {len(covered)} frames '
              f'(kept where relative rotation ≥{ANGLE_THRESHOLD_DEG}° since last keyframe, '
              f'{uncertain_count} pairs unmeasurable and kept by default)')
        return covered

    # ── Deblur ─────────────────────────────────────────────────────────────────
    def _deblur_frames(self, frames: list) -> list:
        """
        Deblur full-resolution frames using overlapping tiles.

        Running an entire high-resolution photo through DeblurNet can
        require several GB of GPU activation memory. Tiling keeps peak
        VRAM bounded while preserving the original frame resolution.
        """
        out = []

        TILE = 512
        OVERLAP = 64
        STRIDE = TILE - OVERLAP

        with torch.inference_mode():
            for frame_idx, frame in enumerate(frames):
                h, w = frame.shape[:2]

                if h <= TILE and w <= TILE:
                    t = (
                        torch.from_numpy(frame)
                        .float()
                        .permute(2, 0, 1)
                        .unsqueeze(0)
                        .to(DEVICE)
                        / 255.0
                    )

                    d = self.deblur(t)

                    arr = (
                        d.squeeze(0)
                        .permute(1, 2, 0)
                        .clamp(0, 1)
                        .cpu()
                        .numpy()
                        * 255
                    ).astype(np.uint8)

                    del t, d
                    out.append(arr)
                    continue

                result = np.zeros((h, w, 3), dtype=np.float32)
                weights = np.zeros((h, w, 1), dtype=np.float32)

                y_positions = list(range(0, max(h - TILE, 0) + 1, STRIDE))
                x_positions = list(range(0, max(w - TILE, 0) + 1, STRIDE))

                if not y_positions or y_positions[-1] + TILE < h:
                    y_positions.append(max(h - TILE, 0))

                if not x_positions or x_positions[-1] + TILE < w:
                    x_positions.append(max(w - TILE, 0))

                for y0 in y_positions:
                    y1 = min(y0 + TILE, h)

                    for x0 in x_positions:
                        x1 = min(x0 + TILE, w)

                        tile = frame[y0:y1, x0:x1]

                        t = (
                            torch.from_numpy(tile)
                            .float()
                            .permute(2, 0, 1)
                            .unsqueeze(0)
                            .to(DEVICE)
                            / 255.0
                        )

                        d = self.deblur(t)

                        tile_out = (
                            d.squeeze(0)
                            .permute(1, 2, 0)
                            .clamp(0, 1)
                            .cpu()
                            .numpy()
                        )

                        th, tw = tile_out.shape[:2]

                        wy = np.ones(th, dtype=np.float32)
                        wx = np.ones(tw, dtype=np.float32)

                        if y0 > 0:
                            fade = min(OVERLAP, th)
                            wy[:fade] = np.linspace(
                                0.0, 1.0, fade, dtype=np.float32
                            )

                        if y1 < h:
                            fade = min(OVERLAP, th)
                            wy[-fade:] = np.minimum(
                                wy[-fade:],
                                np.linspace(
                                    1.0, 0.0, fade, dtype=np.float32
                                ),
                            )

                        if x0 > 0:
                            fade = min(OVERLAP, tw)
                            wx[:fade] = np.linspace(
                                0.0, 1.0, fade, dtype=np.float32
                            )

                        if x1 < w:
                            fade = min(OVERLAP, tw)
                            wx[-fade:] = np.minimum(
                                wx[-fade:],
                                np.linspace(
                                    1.0, 0.0, fade, dtype=np.float32
                                ),
                            )

                        weight = wy[:, None, None] * wx[None, :, None]

                        result[y0:y1, x0:x1] += tile_out * weight
                        weights[y0:y1, x0:x1] += weight

                        del t, d, tile_out, weight

                    if DEVICE == 'cuda':
                        torch.cuda.empty_cache()

                arr = (
                    result / np.maximum(weights, 1e-8)
                ).clip(0, 1)

                arr = (arr * 255).astype(np.uint8)

                del result, weights

                if DEVICE == 'cuda':
                    torch.cuda.empty_cache()

                print(
                    f'[NIF] Deblurred frame {frame_idx + 1}/{len(frames)} '
                    f'({w}x{h}, tiled)'
                )

                out.append(arr)

        return out

    def _estimate_poses(self, frames: list) -> tuple[list, str, np.ndarray | None]:
        if len(frames) < 3:
            print(f'[NIF] Only {len(frames)} frame(s) — not enough for real multi-view SfM, using synthetic poses')
            return self._synthetic_poses(len(frames)), 'synthetic_insufficient_frames', None

        img_dir = self.tmp / 'frames'
        col_dir = self.tmp / 'colmap'
        col_dir.mkdir()

        # Run COLMAP explicitly instead of automatic_reconstructor.
        #
        # automatic_reconstructor is a convenience wrapper that attempts to
        # create an OpenGL context on COLMAP 3.7. Kaggle workers are headless,
        # so that wrapper can fail before SfM even starts.
        #
        # The explicit CLI stages are headless:
        #   1. feature_extractor
        #   2. sequential_matcher
        #   3. mapper
        #
        # Frames arrive in capture order, so sequential matching preserves
        # the video's temporal structure and scales better than exhaustive
        # matching for long captures.
        database_path = col_dir / 'database.db'
        sparse_dir = col_dir / 'sparse'
        sparse_dir.mkdir(exist_ok=True)

        def _run_colmap(args, stage):
            print(f'[NIF] COLMAP {stage}...')
            result = subprocess.run(
                ['colmap'] + args,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(
                    f'[NIF] COLMAP {stage} failed '
                    f'(returncode={result.returncode})'
                )
                if result.stdout:
                    print(result.stdout[-6000:])
                if result.stderr:
                    print(result.stderr[-6000:])
                return False
            return True

        # GPU SIFT extraction with one shared camera model.
        if not _run_colmap([
            'feature_extractor',
            '--database_path', str(database_path),
            '--image_path', str(img_dir),
            '--ImageReader.single_camera', '1',
            '--SiftExtraction.use_gpu', '0',
        ], 'feature extraction'):
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_failed', None

        # Sequential matching for video frames.
        if not _run_colmap([
            'sequential_matcher',
            '--database_path', str(database_path),
            '--SequentialMatching.overlap', '10',
            '--SiftMatching.use_gpu', '0',
        ], 'sequential matching'):
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_failed', None

        # Mapper creates the actual SfM cameras and triangulated geometry.
        # Two-view tracks are retained because they can be useful for
        # object/turntable captures.
        if not _run_colmap([
            'mapper',
            '--image_path', str(img_dir),
            '--database_path', str(database_path),
            '--output_path', str(sparse_dir),
            '--Mapper.tri_ignore_two_view_track', '0',
            '--Mapper.multiple_models', '0',
        ], 'mapping'):
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_failed', None

        if not (sparse_dir / '0').exists():
            print('[NIF] COLMAP mapper completed without a sparse/0 model')
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_failed', None

        # Record basic reconstruction statistics before parsing the binary
        # model. These metrics make the real SfM result observable in worker
        # logs instead of treating every weak reconstruction as an opaque
        # success/failure.
        model_dir = sparse_dir / '0'
        images_bin = model_dir / 'images.bin'
        points3d_bin = model_dir / 'points3D.bin'
        cameras_bin = model_dir / 'cameras.bin'

        print('[NIF] COLMAP model artifacts:')
        print(f'       images.bin:  {images_bin.stat().st_size if images_bin.exists() else 0:,} bytes')
        print(f'       cameras.bin: {cameras_bin.stat().st_size if cameras_bin.exists() else 0:,} bytes')
        print(f'       points3D.bin:{points3d_bin.stat().st_size if points3d_bin.exists() else 0:,} bytes')

        # Parse COLMAP images.bin and restore exact frame/pose alignment.
        pose_records = self._parse_colmap(col_dir / 'sparse' / '0' / 'images.bin')

        # COLMAP may return images in a different order from our filtered
        # frame list. Match poses by the authoritative filename stored in
        # images.bin instead of assuming list indices are identical.
        pose_by_name = {
            Path(name).name: pose
            for name, pose in pose_records
        }

        aligned_frames = []
        aligned_poses = []

        for i, frame in enumerate(frames):
            frame_name = f'frame_{i:05d}.jpg'
            pose = pose_by_name.get(frame_name)

            if pose is not None:
                aligned_frames.append(frame)
                aligned_poses.append(pose)

        # Keep only frames for which COLMAP produced a corresponding pose.
        frames[:] = aligned_frames
        poses = aligned_poses

        if len(poses) < 2:
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_insufficient_poses', None

        # Parse COLMAP's sparse 3D point cloud (points3D.bin) — this is what
        # lets Gaussian training start from real observed geometry instead of
        # random noise (see GaussianSplatTrainer.init_points). Best-effort:
        # a parse failure here shouldn't take down an otherwise-successful
        # pose estimate, it just means training falls back to random init.
        sparse_points = None
        try:
            points3d_path = col_dir / 'sparse' / '0' / 'points3D.bin'
            if points3d_path.exists():
                sparse_points = self._parse_colmap_points3d(points3d_path)
                print(f'[NIF] {len(sparse_points):,} sparse 3D points parsed from COLMAP')
        except Exception as e:
            print(f'[NIF] Failed to parse COLMAP sparse point cloud ({e}) — Gaussian init will use random fallback')
            sparse_points = None

        print(f'[NIF] {len(poses)} poses estimated via COLMAP SfM — real multi-view reconstruction')
        return poses, 'colmap', sparse_points

    def _synthetic_poses(self, n: int) -> list:
        """
        Circular orbit poses for single-image or COLMAP-fail fallback.

        Built as an explicit look-at construction (camera position C on a
        constant-radius circle around Y, rotation = camera's own basis
        vectors expressed in world coordinates, translation = -R@C) rather
        than a hand-picked R/t pair — the previous version's R and t didn't
        correspond to any single consistent camera position: recovering the
        implied world position (C = -R^T@t) gave a radius that swung from 0
        (camera exactly at the origin, inside the subject, at the very first
        pose) to 4 across one orbit. Verified in isolation before shipping:
        -R^T@t round-trips back to the exact C used to build R/t, at a
        constant radius, for every theta.
        """
        poses = []
        r  = 2.5
        up = np.array([0., 1., 0.])
        for i in range(max(n, 3)):
            th = 2 * np.pi * i / max(n, 3)
            C  = np.array([r * np.sin(th), 0.0, r * np.cos(th)])  # camera position, world space
            f  = -C / (np.linalg.norm(C) + 1e-8)                   # forward: camera -> origin
            right = np.cross(f, up); right /= (np.linalg.norm(right) + 1e-8)
            true_up = np.cross(right, f)
            R = np.stack([right, -true_up, f], axis=0)             # world->camera rotation (OpenCV: X right, Y down, Z fwd)
            t = -R @ C
            vm = np.eye(4)
            vm[:3, :3] = R; vm[:3, 3] = t
            poses.append(torch.tensor(vm, dtype=torch.float32))
        return poses

    def _parse_colmap(self, images_bin: Path) -> list:
        """Parse COLMAP binary images.bin → list of 4×4 view matrices."""
        poses = []
        with open(images_bin, 'rb') as f:
            n = struct.unpack('<Q', f.read(8))[0]
            for _ in range(n):
                img_id = struct.unpack('<I', f.read(4))[0]
                qw,qx,qy,qz = struct.unpack('<dddd', f.read(32))
                tx,ty,tz    = struct.unpack('<ddd',  f.read(24))
                _cam_id     = struct.unpack('<I', f.read(4))[0]
                _name = b''
                while True:
                    c = f.read(1)
                    if c == b'\x00': break
                    _name += c
                _n2d = struct.unpack('<Q', f.read(8))[0]
                f.read(_n2d * 24)  # skip 2D points

                # Quaternion → rotation matrix
                R = np.array([
                    [1-2*(qy*qy+qz*qz), 2*(qx*qy-qw*qz),   2*(qx*qz+qw*qy)],
                    [2*(qx*qy+qw*qz),   1-2*(qx*qx+qz*qz), 2*(qy*qz-qw*qx)],
                    [2*(qx*qz-qw*qy),   2*(qy*qz+qw*qx),   1-2*(qx*qx+qy*qy)],
                ])
                vm = np.eye(4)
                vm[:3,:3] = R
                vm[:3,3]  = [tx, ty, tz]
                poses.append((os.fsdecode(_name), torch.tensor(vm, dtype=torch.float32)))
        return poses

    def _parse_colmap_points3d(self, points3d_bin: Path) -> np.ndarray:
        """
        Parse COLMAP binary points3D.bin → (M, 3) float32 array of sparse
        SfM point positions, in the same reconstruction-space coordinate
        frame as the poses from _parse_colmap (both come from the same
        COLMAP run, so no extra alignment is needed).

        Binary layout (COLMAP's documented points3D.bin format):
          uint64 num_points
          per point:
            uint64 point3D_id
            double x, y, z
            uint8  r, g, b
            double error
            uint64 track_length
            track_length * (uint32 image_id, uint32 point2D_idx)
        """
        points = []
        with open(points3d_bin, 'rb') as f:
            n = struct.unpack('<Q', f.read(8))[0]
            for _ in range(n):
                f.read(8)  # point3D_id — unused, order is all we need
                x, y, z = struct.unpack('<ddd', f.read(24))
                f.read(3)  # rgb — not needed for geometry seeding
                f.read(8)  # reprojection error
                track_length = struct.unpack('<Q', f.read(8))[0]
                f.read(track_length * 8)  # skip (image_id, point2D_idx) pairs
                points.append((x, y, z))
        return np.array(points, dtype=np.float32)

    # ── Training ───────────────────────────────────────────────────────────────
    def _train_gaussians(self, frames: list, poses: list,
                          sparse_points: np.ndarray | None = None,
                          pose_source: str = 'colmap',
                          object_masks: list | None = None,
                          depth_maps: list | None = None) -> tuple:
        # Configurable so quality can be dialed back up later without a code
        # change — defaults tuned for fast turnaround during testing rather
        # than final quality. n=50k/3000 iters (the old fixed values) is a
        # real, noticeable time cost on top of COLMAP; halving both roughly
        # halves training wall-clock with a real but acceptable quality hit
        # for "does this work at all" testing.
        quality = os.environ.get('FUMOCA_RECON_QUALITY', 'high').lower()
        quality_tiers = {
            'fast': {'gaussians': 20_000, 'iters': 1_200, 'max_gaussians': 120_000},
            'balanced': {'gaussians': 30_000, 'iters': 1_800, 'max_gaussians': 160_000},
            'high': {'gaussians': 40_000, 'iters': 2_500, 'max_gaussians': 220_000},
            'ultra': {'gaussians': 60_000, 'iters': 3_500, 'max_gaussians': 300_000},
        }
        qcfg = quality_tiers.get(quality, quality_tiers['high'])
        n_gaussians = int(os.environ.get('FUMOCA_N_GAUSSIANS', qcfg['gaussians']) )
        # Geometry-derived init: seed from COLMAP's real sparse point cloud
        # when pose estimation actually succeeded (pose_source == 'colmap').
        # Deliberately NOT passed when pose_source is a synthetic fallback —
        # sparse_points is always None in that case anyway (see
        # _estimate_poses), but the explicit check documents why: synthetic
        # circular-orbit poses have no COLMAP geometry backing them, so
        # there's nothing real to seed from.
        trainer = GaussianSplatTrainer(
            n=n_gaussians,
            init_points=sparse_points if pose_source == 'colmap' else None,
            device=DEVICE,
        )
        # No .to(DEVICE) reassignment here — parameters are created directly
        # on DEVICE inside __init__ above, so they stay real leaf Parameters
        # and self._opt (built in __init__) is already correct. Reassigning
        # trainer.means = trainer.means.to(DEVICE) here (the old code) breaks
        # leaf-tensor status the moment DEVICE differs from where the
        # parameter was created, and torch.optim.Adam refuses to optimize a
        # non-leaf tensor — that would have raised on every real GPU run.

        H, W = frames[0].shape[:2]
        fx = fy = max(H, W) * 0.8
        K = torch.tensor([[fx,0,W/2],[0,fy,H/2],[0,0,1]], dtype=torch.float32, device=DEVICE)

        n_poses = min(len(poses), len(frames))

        # 3000 iterations with adaptive densification
        # Production 3DGS uses 30k but Kaggle T4 12hr limit means ~3k is practical.
        # Densification: split high-gradient Gaussians and clone small ones.
        # This is the core mechanism that fills in detail — without it you get blobs.
        ITERS = int(os.environ.get('FUMOCA_GS_ITERS', qcfg['iters']))
        # Geometry validation gate, applied here rather than only reported
        # after the fact: pose_source is already known before this method is
        # called (it comes from _estimate_poses, run before training). A
        # synthetic/fallback pose_source means we already know this isn't
        # real multi-view geometry — training the full iteration budget
        # against it spends GPU time optimizing something the pipeline
        # already knows is degraded. Cut the budget instead of skipping
        # training outright, since the existing design intentionally still
        # ships a depth-based pseudo-3D result in this case (see
        # _synthetic_poses' docstring) rather than failing the whole job —
        # this keeps that behavior but stops paying full price for it.
        if pose_source != 'colmap':
            ITERS = max(int(ITERS * 0.4), 200)
            print(f'[NIF] pose_source={pose_source} (not real multi-view geometry) — '
                  f'reducing training budget to {ITERS} iterations instead of full budget')
        DENSIFY_EVERY    = 300   # densify at step 300, 600, 900, 1200
        DENSIFY_UNTIL    = 1500  # stop densifying past this point
        DENSIFY_GRAD_THR = 0.0002  # position gradient threshold for splitting
        PRUNE_EVERY      = 100
        MAX_GAUSSIANS    = int(os.environ.get('FUMOCA_MAX_GAUSSIANS', qcfg['max_gaussians']))

        # ── Held-out evaluation split — this is what makes the eventual
        # PSNR check below a real reconstruction-quality signal instead of a
        # training-loss restatement. Reusing training frames for "quality"
        # measures memorization, not generalization — a severely overfit
        # reconstruction can still show a low training loss. Held-out frames
        # never appear in a train_step() call, so rendering them afterward
        # actually tests whether the Gaussians learned real 3D structure.
        # Only holds out when there's enough poses to afford it — n_poses<8
        # means every frame is needed for training, so QA on captures that
        # small isn't guaranteed to be very meaningful and shouldn't come
        # at the cost of training quality itself.
        if n_poses >= 8:
            holdout_stride = max(4, n_poses // 6)
            holdout_idxs = set(range(0, n_poses, holdout_stride))
        else:
            holdout_idxs = set()
        train_idxs = [i for i in range(n_poses) if i not in holdout_idxs] or list(range(n_poses))

        for step in range(ITERS):
            idx  = train_idxs[step % len(train_idxs)]
            gt   = torch.from_numpy(frames[idx]).float().to(DEVICE) / 255.0
            vm   = poses[idx].to(DEVICE)

            alpha_mask = None
            if object_masks is not None and idx < len(object_masks):
                mask_np = object_masks[idx]
                if mask_np is not None:
                    alpha_mask = torch.from_numpy(
                        mask_np.astype(np.float32) / 255.0
                    ).to(DEVICE)

            depth_target = None
            if depth_maps is not None and idx < len(depth_maps):
                try:
                    depth_target = torch.from_numpy(depth_maps[idx]).float()
                except Exception:
                    depth_target = None
            depth_weight = float(os.environ.get('FUMOCA_DEPTH_LOSS_WEIGHT', '0.08'))
            depth_every = max(1, int(os.environ.get('FUMOCA_DEPTH_LOSS_EVERY', '8')))
            if step % depth_every != 0:
                depth_weight = 0.0

            loss = trainer.train_step(
                gt,
                vm,
                K,
                alpha_mask=alpha_mask,
                depth_target=depth_target,
                depth_loss_weight=depth_weight
            )

            if step % 100 == 0:
                n = len(trainer.means)
                print(f'[NIF] step {step}/{ITERS}  loss={loss:.4f}  n={n:,}')

            # Adaptive densification — the key to capturing fine detail
            if step > 0 and step % DENSIFY_EVERY == 0 and step < DENSIFY_UNTIL:
                if len(trainer.means) < MAX_GAUSSIANS:
                    trainer._densify(DENSIFY_GRAD_THR)

        # ── Held-out PSNR — render each held-out pose (never seen during
        # training) and compare against the real photo. This is a real,
        # if approximate, "does this actually look like the object" signal.
        # PROVISIONAL THRESHOLD: 18dB below is picked as an obviously-bad
        # floor (well below what even a rough reconstruction should hit),
        # not a tuned production cutoff — there's no real capture yet to
        # tune it against. Treat it as a first-pass sanity check, not a
        # final QA bar; revisit once you've seen PSNR numbers from an
        # actual capture and know what "good" looks like for this pipeline.
        eval_psnr = None
        if holdout_idxs:
            with torch.no_grad():
                mses = []
                for idx in sorted(holdout_idxs):
                    gt = torch.from_numpy(frames[idx]).float().to(DEVICE) / 255.0
                    vm = poses[idx].to(DEVICE)
                    quats_n = F.normalize(trainer.quats, dim=-1)
                    scales  = torch.exp(trainer.log_scales).clamp(min=1e-6)
                    opacities = torch.sigmoid(trainer.log_opacity)
                    sh_coeffs = torch.cat([trainer.sh0, trainer.sh_rest], dim=1)
                    rendered, _a, _i = gsplat.rasterization(
                        means=trainer.means.unsqueeze(0), quats=quats_n.unsqueeze(0),
                        scales=scales.unsqueeze(0), opacities=opacities.unsqueeze(0),
                        colors=sh_coeffs, viewmats=vm.unsqueeze(0).unsqueeze(1), Ks=K.unsqueeze(0).unsqueeze(1),
                        width=gt.shape[1], height=gt.shape[0],
                        near_plane=0.01, far_plane=100.0, sh_degree=trainer.sh_degree, render_mode='RGB',
                    )
                    mses.append(float(F.mse_loss(rendered.squeeze(0).squeeze(0), gt)))
                mean_mse = sum(mses) / len(mses)
                eval_psnr = 10.0 * math.log10(1.0 / max(mean_mse, 1e-10))
            print(f'[NIF] Held-out PSNR: {eval_psnr:.2f}dB over {len(holdout_idxs)} held-out frames '
                  f'(provisional 18dB floor — not yet tuned against a real capture)')
        else:
            print(f'[NIF] Only {n_poses} poses — too few to hold any out for PSNR eval, skipping')

        # ── DEBUG: render a trained Gaussian preview before mesh extraction ──
        # This tells us whether the Gaussian representation itself looks like
        # the captured product, independently of the mesh reconstruction.
        try:
            import imageio.v2 as imageio

            debug_idx = train_idxs[len(train_idxs) // 2]
            debug_gt = torch.from_numpy(frames[debug_idx]).float().to(DEVICE) / 255.0
            debug_vm = poses[debug_idx].to(DEVICE)

            with torch.no_grad():
                quats_n = F.normalize(trainer.quats, dim=-1)
                scales = torch.exp(trainer.log_scales).clamp(min=1e-6)
                opacities = torch.sigmoid(trainer.log_opacity)
                sh_coeffs = torch.cat([trainer.sh0, trainer.sh_rest], dim=1)

                debug_rendered, _, _ = gsplat.rasterization(
                    means=trainer.means.unsqueeze(0),
                    quats=quats_n.unsqueeze(0),
                    scales=scales.unsqueeze(0),
                    opacities=opacities.unsqueeze(0),
                    colors=sh_coeffs,
                    viewmats=debug_vm.unsqueeze(0).unsqueeze(1),
                    Ks=K.unsqueeze(0).unsqueeze(1),
                    width=debug_gt.shape[1],
                    height=debug_gt.shape[0],
                    near_plane=0.01,
                    far_plane=100.0,
                    sh_degree=trainer.sh_degree,
                    render_mode='RGB',
                )

                debug_rendered = debug_rendered.squeeze(0).squeeze(0)

                debug_img = (
                    debug_rendered.clamp(0, 1).cpu().numpy() * 255
                ).astype(np.uint8)

                debug_gt_img = (
                    debug_gt.clamp(0, 1).cpu().numpy() * 255
                ).astype(np.uint8)

            debug_path = str(self.tmp / 'gaussian_debug_render.png')
            gt_path = str(self.tmp / 'gaussian_debug_gt.png')

            imageio.imwrite(debug_path, debug_img)
            imageio.imwrite(gt_path, debug_gt_img)

            print(f'[NIF] Gaussian debug render saved: {debug_path}')
            print(f'[NIF] Gaussian debug ground truth saved: {gt_path}')

        except Exception as e:
            print(f'[NIF] Gaussian debug render failed (non-fatal): {e}')

        n, geo_bytes = trainer.export_buffer()
        appearance_bytes = self._pack_sh_appearance(trainer)
        return n, geo_bytes, appearance_bytes, eval_psnr
    def _pack_sh_appearance(self, trainer: GaussianSplatTrainer) -> bytes:
        """Pack the full view-dependent SH appearance master.

        Layout v1: magic 'FSHA', version, SH degree, coefficient count K,
        Gaussian count N, then N × K × 3 float16 coefficients (big-endian).
        GEO keeps a compact RGB fallback for legacy readers.
        """
        with torch.no_grad():
            coeffs = torch.cat([trainer.sh0, trainer.sh_rest], dim=1).detach().cpu().numpy()
        coeffs = np.asarray(coeffs, dtype=np.float32)
        K = coeffs.shape[1]
        N = coeffs.shape[0]
        header = struct.pack('>4sBBHI', b'FSHA', 1, int(trainer.sh_degree), K, N)
        body = coeffs.astype('>f2').tobytes()
        print(f'[NIF] SH appearance master: degree={trainer.sh_degree} K={K} '
              f'gaussians={N:,} size={(len(header)+len(body))/1024/1024:.2f}MB')
        return header + body

    def _extract_mesh(self, geo_data: np.ndarray, grid_res: int = 96,
                       opacity_thresh: float = 0.18, max_faces: int | None = None) -> tuple:
        """
        Real triangulation from the trained Gaussians — not a renamed point
        cloud. After training, each Gaussian's *shortest* axis aligns with the
        true surface normal (the same property SuGaR and related Gaussian-to-
        mesh papers rely on). We use that to treat the splats as an oriented
        point cloud: splat each point's signed distance (along its normal)
        into a volume, then run marching cubes for a real watertight mesh.

        geo_data: (N, 14) float32 — [x,y,z, log_sx,log_sy,log_sz,
                                      qw,qx,qy,qz, opacity_logit, r,g,b (logit)]
        Returns (mesh_bytes, stl_bytes) — either may be None if too few
        confident points remain to fit a surface (e.g. a very sparse/noisy
        capture), or if STL export specifically fails.

        mesh_bytes layout: [format_flag:u8]
          flag 0x00 (raw struct — used automatically when DracoPy isn't
            installed or encoding throws, see the try/except around
            DracoPy.encode() below):
            [n_verts:u32 BE][n_faces:u32 BE]
            [positions: n_verts × 3 × f32 BE][colors: n_verts × 3 × u8]
            [faces: n_faces × 3 × u32 BE]
          flag 0x01 (Draco-encoded — the default now that ENABLE_DRACO_MESH=True):
            remaining bytes are a Draco buffer as produced by DracoPy.encode().
            nif-format.js's _decodeDracoMesh() reads this via THREE.DRACOLoader.
            UNVERIFIED end-to-end as of this revision — no browser/wasm
            execution was available to confirm the round trip on a real file,
            specifically whether DracoPy's color-attribute encoding lands the
            way THREE.DRACOLoader expects. Check the first real Draco file's
            rendered colors before trusting this in front of a client; flip
            ENABLE_DRACO_MESH back to False if they're wrong (raw struct
            format is unaffected either way).
        """
        opacity = 1.0 / (1.0 + np.exp(-geo_data[:, 10]))
        keep = opacity > opacity_thresh
        pts = geo_data[keep]
        if len(pts) < 200:
            print(f'[NIF] Only {len(pts)} confident points — skipping mesh extraction')
            return None, None, None
        positions = pts[:, 0:3]
        log_scales = pts[:, 3:6]
        quats = pts[:, 6:10]
        colors = 1.0 / (1.0 + np.exp(-pts[:, 11:14]))  # sigmoid → 0-1 RGB

        # One face budget is shared by the production and fallback paths.
        # Production detail tiers choose the default; an explicit max_faces
        # remains an escape hatch for constrained jobs.
        detail_name = os.environ.get('FUMOCA_MESH_DETAIL', 'high').lower()
        detail_face_defaults = {
            'fast': 80_000,
            'balanced': 160_000,
            'high': 250_000,
            'ultra': 350_000,
        }
        target_max_faces = (
            int(max_faces) if max_faces is not None
            else int(os.environ.get(
                'FUMOCA_MESH_MAX_FACES',
                detail_face_defaults.get(detail_name, detail_face_defaults['high'])
            ))
        )

        # ── FUMOCA production surface path ─────────────────────────────────
        # The old path below built a signed-distance volume by projecting
        # Gaussian normals and then ran Marching Cubes. That is useful as a
        # dependency-light fallback, but its signed direction is fundamentally
        # ambiguous on concave products and can create shells/holes.
        #
        # Production FUMOCA therefore prefers screened Poisson reconstruction
        # from an oriented surface point cloud. This is the same class of
        # Gaussian-to-mesh strategy used by surface-aligned Gaussian methods:
        # extract/organise surface samples first, then reconstruct a continuous
        # surface. If Open3D is unavailable or the Poisson result is unusable,
        # the existing marching-cubes implementation continues below.
        mesh_method = os.environ.get('FUMOCA_MESH_METHOD', 'poisson').lower()
        if mesh_method in ('poisson', 'auto'):
            import trimesh
            try:
                import open3d as o3d
                from scipy.spatial import cKDTree

                # FUMOCA detail tiers. The solid should never be capped at the
                # same polygon budget as the lightweight web preview: small
                # handles, seams, bottle threads, badges and door gaps are
                # geometry, not noise.
                detail = os.environ.get('FUMOCA_MESH_DETAIL', 'high').lower()
                tiers = {
                    'fast':     {'max_points': 100_000, 'depth': 8,  'density_q': 0.03,  'max_faces': 80_000},
                    'balanced': {'max_points': 160_000, 'depth': 9,  'density_q': 0.015, 'max_faces': 160_000},
                    'high':     {'max_points': 220_000, 'depth': 10, 'density_q': 0.01,  'max_faces': 250_000},
                    'ultra':    {'max_points': 300_000, 'depth': 11, 'density_q': 0.005, 'max_faces': 350_000},
                }
                tier = tiers.get(detail, tiers['high'])
                max_points = int(os.environ.get('FUMOCA_POISSON_MAX_POINTS', tier['max_points']))
                poisson_depth = int(os.environ.get('FUMOCA_POISSON_DEPTH', tier['depth']))
                poisson_depth = max(7, min(poisson_depth, 11))
                density_q = float(os.environ.get('FUMOCA_POISSON_DENSITY_Q', tier['density_q']))
                density_q = min(max(density_q, 0.0), 0.20)
                target_max_faces = (
                    int(max_faces) if max_faces is not None
                    else int(os.environ.get('FUMOCA_MESH_MAX_FACES', tier['max_faces']))
                )

                work_positions = positions
                work_colors = colors
                work_normals = None

                # Derive a surface normal from the Gaussian's shortest axis.
                # This uses the learned anisotropic Gaussian orientation rather
                # than throwing that geometry away and re-fitting a generic
                # plane. Surface-aligned Gaussians are exactly the signal that
                # makes Poisson extraction preserve fine geometry.
                axis_idx = np.argmin(log_scales, axis=1)
                qw, qx, qy, qz = quats[:, 0], quats[:, 1], quats[:, 2], quats[:, 3]
                qn = np.sqrt(qw*qw + qx*qx + qy*qy + qz*qz) + 1e-8
                qw, qx, qy, qz = qw/qn, qx/qn, qy/qn, qz/qn
                G = np.empty((len(pts), 3, 3), dtype=np.float64)
                G[:,0,0]=1-2*(qy*qy+qz*qz); G[:,0,1]=2*(qx*qy-qz*qw);   G[:,0,2]=2*(qx*qz+qy*qw)
                G[:,1,0]=2*(qx*qy+qz*qw);   G[:,1,1]=1-2*(qx*qx+qz*qz); G[:,1,2]=2*(qy*qz-qx*qw)
                G[:,2,0]=2*(qx*qz-qy*qw);   G[:,2,1]=2*(qy*qz+qx*qw);   G[:,2,2]=1-2*(qx*qx+qy*qy)
                gaussian_normals = G[np.arange(len(pts)), :, axis_idx]
                gaussian_normals /= np.maximum(
                    np.linalg.norm(gaussian_normals, axis=1, keepdims=True), 1e-8
                )

                if len(work_positions) > max_points:
                    # Deterministic stride keeps runs reproducible while still
                    # retaining the learned normal/orientation field.
                    stride = int(math.ceil(len(work_positions) / max_points))
                    work_positions = work_positions[::stride]
                    work_colors = work_colors[::stride]
                    work_normals = gaussian_normals[::stride]
                else:
                    work_normals = gaussian_normals

                if len(work_positions) >= 500:
                    # Estimate local sampling scale. Poisson depth controls the
                    # reconstruction resolution, while local spacing controls
                    # normal propagation and only the optional safety downsample.
                    nn_tree = cKDTree(work_positions)
                    nn_d, _ = nn_tree.query(work_positions, k=2, workers=-1)
                    local_spacing = float(np.median(nn_d[:, 1]))
                    local_spacing = max(local_spacing, 1e-6)

                    pcd = o3d.geometry.PointCloud()
                    pcd.points = o3d.utility.Vector3dVector(work_positions.astype(np.float64))
                    pcd.colors = o3d.utility.Vector3dVector(np.clip(work_colors, 0, 1).astype(np.float64))
                    pcd.normals = o3d.utility.Vector3dVector(work_normals.astype(np.float64))

                    # Only downsample at the extreme end of the point budget.
                    # A fixed voxel reduction is one of the easiest ways to
                    # erase small product details before Poisson ever sees them.
                    if len(work_positions) > 180_000:
                        pcd = pcd.voxel_down_sample(voxel_size=local_spacing * 0.50)
                        pcd.normalize_normals()

                    # Re-orient the Gaussian-derived normals as a connected
                    # field. Open3D documents this as a minimum-spanning-tree
                    # style propagation, which is substantially safer than
                    # independently estimating/flipping every normal.
                    try:
                        k_orient = min(100, max(20, len(pcd.points) // 2500))
                        pcd.orient_normals_consistent_tangent_plane(k_orient, 0.5, 0.8)
                    except Exception as e:
                        print(f'[NIF] Normal orientation propagation skipped: {e}')

                    # A global outward pass gives a stable convention for
                    # single-object captures. We deliberately do not rebuild
                    # normals from planes here; that would throw away the
                    # Gaussian surface orientation we just preserved.
                    p_np = np.asarray(pcd.points)
                    n_np = np.asarray(pcd.normals)
                    center = p_np.mean(axis=0)
                    outward = p_np - center
                    flip = np.einsum('ij,ij->i', n_np, outward) < 0
                    n_np[flip] *= -1
                    pcd.normals = o3d.utility.Vector3dVector(n_np)

                    poisson_mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
                        pcd,
                        depth=poisson_depth,
                        scale=float(os.environ.get('FUMOCA_POISSON_SCALE', '1.03')),
                        linear_fit=True,
                    )

                    # Poisson intentionally smooths high-frequency noise, but
                    # it can also extrapolate into poorly sampled regions.
                    # Density trimming is therefore adaptive to the selected
                    # detail tier instead of using one blunt 2% cutoff.
                    densities = np.asarray(densities)
                    if len(densities) == len(poisson_mesh.vertices) and len(densities) > 100:
                        cutoff = float(np.quantile(densities, density_q))
                        poisson_mesh.remove_vertices_by_mask(densities < cutoff)

                    bb_min = work_positions.min(axis=0)
                    bb_max = work_positions.max(axis=0)
                    # Keep the crop tight enough to reject Poisson extrapolation
                    # but wide enough to preserve edge curvature and small parts.
                    pad_fraction = float(os.environ.get('FUMOCA_POISSON_PAD', '0.015'))
                    pad = np.maximum((bb_max - bb_min) * pad_fraction, local_spacing * 2.0)
                    bbox = o3d.geometry.AxisAlignedBoundingBox(
                        bb_min - pad,
                        bb_max + pad,
                    )
                    poisson_mesh = poisson_mesh.crop(bbox)

                    mesh = trimesh.Trimesh(
                        vertices=np.asarray(poisson_mesh.vertices),
                        faces=np.asarray(poisson_mesh.triangles),
                        process=True,
                    )
                    mesh.update_faces(mesh.nondegenerate_faces())
                    mesh.remove_duplicate_faces()
                    mesh.remove_unreferenced_vertices()

                    # Keep the primary product surface and discard Poisson's
                    # occasional detached islands.
                    components = mesh.split(only_watertight=False)
                    if components:
                        mesh = max(components, key=lambda m: len(m.faces))

                    # Re-transfer colours from the original Gaussian cloud.
                    colour_tree = cKDTree(positions)
                    _, colour_idx = colour_tree.query(mesh.vertices, k=1, workers=-1)
                    mesh.visual.vertex_colors = np.clip(
                        colors[colour_idx] * 255, 0, 255
                    ).astype(np.uint8)

                    # Conservative repair sequence. Never silently turn a
                    # detailed product into a convex hull unless explicitly
                    # requested — convex-hull repair destroys cavities and
                    # door/handle/bottle details that FUMOCA needs to preserve.
                    trimesh.repair.fix_winding(mesh)
                    trimesh.repair.fix_inversion(mesh)
                    # Do NOT blindly fill holes: a hole may be a real product
                    # opening/cavity (bottle neck, wheel arch, door gap, vent).
                    # Micro-hole repair is opt-in and should only be enabled
                    # after capture-specific QA.
                    if os.environ.get('FUMOCA_FILL_MICRO_HOLES', '0').lower() in ('1', 'true', 'yes'):
                        trimesh.repair.fill_holes(mesh)
                    mesh.merge_vertices()
                    mesh.remove_duplicate_faces()
                    mesh.remove_unreferenced_vertices()

                    if mesh.is_watertight and len(mesh.faces) >= 50:
                        if len(mesh.faces) > target_max_faces:
                            try:
                                mesh = mesh.simplify_quadric_decimation(face_count=target_max_faces)
                            except Exception as e:
                                print(f'[NIF] Poisson decimation unavailable ({e}) — keeping full mesh')

                        print(
                            f'[NIF] Production Poisson mesh: {len(mesh.vertices):,} verts, '
                            f'{len(mesh.faces):,} faces, watertight=True, depth={poisson_depth}'
                        )

                        # Continue through the exact same NIF/STL packaging
                        # contract used by the fallback path below.
                        n_verts, n_faces = len(mesh.vertices), len(mesh.faces)
                        colors_out = (
                            mesh.visual.vertex_colors[:, :3].astype(np.uint8)
                            if mesh.visual.vertex_colors is not None
                            else np.zeros((n_verts, 3), dtype=np.uint8)
                        )
                        header = struct.pack('>II', n_verts, n_faces)
                        pos_bytes = mesh.vertices.astype('>f4').tobytes()
                        col_bytes = colors_out.tobytes()
                        face_bytes = mesh.faces.astype('>u4').tobytes()
                        mesh_chunk_bytes = header + pos_bytes + col_bytes + face_bytes

                        if ENABLE_DRACO_MESH:
                            try:
                                import DracoPy
                                draco_bytes = DracoPy.encode(
                                    mesh.vertices, mesh.faces,
                                    colors=colors_out,
                                    quantization_bits=14,
                                    compression_level=7,
                                )
                                mesh_chunk_bytes = struct.pack('>B', 0x01) + draco_bytes
                            except Exception as e:
                                print(f'[NIF] Poisson Draco unavailable ({e}) — using raw mesh format')
                                mesh_chunk_bytes = struct.pack('>B', 0x00) + mesh_chunk_bytes
                        else:
                            mesh_chunk_bytes = struct.pack('>B', 0x00) + mesh_chunk_bytes

                        try:
                            stl_bytes = mesh.export(file_type='stl')
                        except Exception as e:
                            print(f'[NIF] Poisson STL export failed: {e}')
                            stl_bytes = None

                        n_degenerate = 0
                        try:
                            keep_mask = mesh.nondegenerate_faces()
                            n_degenerate = int(n_faces - int(np.sum(keep_mask)))
                        except Exception:
                            pass

                        mesh_info = _mesh_quality_report(
                            mesh, 'screened_poisson', detail
                        )
                        mesh_info.update({
                            'poisson_depth': poisson_depth,
                            'density_trim_quantile': density_q,
                        })
                        return mesh_chunk_bytes, stl_bytes, mesh_info

                    print('[NIF] Poisson result was not a valid watertight product surface — falling back to marching cubes')
            except ImportError as e:
                print(f'[NIF] Open3D unavailable ({e}) — falling back to marching cubes')
            except Exception as e:
                print(f'[NIF] Poisson mesh failed ({e}) — falling back to marching cubes')

        # Normal = the rotated local axis with the smallest scale
        axis_idx = np.argmin(log_scales, axis=1)
        qw, qx, qy, qz = quats[:, 0], quats[:, 1], quats[:, 2], quats[:, 3]
        n = np.sqrt(qw*qw + qx*qx + qy*qy + qz*qz) + 1e-8
        qw, qx, qy, qz = qw/n, qx/n, qy/n, qz/n
        # Build rotation matrices for all points (N,3,3), then pick out the
        # column matching axis_idx to avoid a per-point Python loop.
        R = np.empty((len(pts), 3, 3), dtype=np.float64)
        R[:,0,0]=1-2*(qy*qy+qz*qz); R[:,0,1]=2*(qx*qy-qz*qw);   R[:,0,2]=2*(qx*qz+qy*qw)
        R[:,1,0]=2*(qx*qy+qz*qw);   R[:,1,1]=1-2*(qx*qx+qz*qz); R[:,1,2]=2*(qy*qz-qx*qw)
        R[:,2,0]=2*(qx*qz-qy*qw);   R[:,2,1]=2*(qy*qz+qx*qw);   R[:,2,2]=1-2*(qx*qx+qy*qy)
        normals = R[np.arange(len(pts)), :, axis_idx]
        norm_len = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals / np.maximum(norm_len, 1e-8)

        # A Gaussian's shortest axis gives the normal *line*, not a signed
        # direction — quaternion rotation of a basis vector has no inherent
        # "outward" sense, so adjacent points can end up with randomly
        # flipped normals. Left unresolved, that corrupts the signed-distance
        # field below (sd = diff·normal flips sign incoherently between
        # neighbors) and produces holes/spurious shells in marching cubes.
        # Orient outward from the point-cloud centroid — correct for
        # roughly-convex, star-shaped single subjects, which matches the
        # orbit-capture scripts this pipeline is built around (not correct
        # for strongly concave scenes, e.g. capturing the inside of a room).
        centroid = positions.mean(axis=0)
        outward  = positions - centroid
        flip     = np.einsum('vc,vc->v', normals, outward) < 0
        normals[flip] *= -1

        # ── Splat oriented points into a signed-distance volume ────────────────
        mn = positions.min(axis=0) - 0.05
        mx = positions.max(axis=0) + 0.05
        extent = mx - mn
        voxel_size = extent.max() / grid_res
        dims = np.maximum(np.ceil(extent / voxel_size).astype(int) + 1, 4)
        # Cap total voxel count so this stays tractable on CPU
        while dims[0]*dims[1]*dims[2] > 2_000_000:
            voxel_size *= 1.25
            dims = np.maximum(np.ceil(extent / voxel_size).astype(int) + 1, 4)

        xs = mn[0] + np.arange(dims[0]) * voxel_size
        ys = mn[1] + np.arange(dims[1]) * voxel_size
        zs = mn[2] + np.arange(dims[2]) * voxel_size
        gx, gy, gz = np.meshgrid(xs, ys, zs, indexing='ij')
        grid = np.stack([gx, gy, gz], axis=-1).reshape(-1, 3)

        from scipy.spatial import cKDTree
        tree = cKDTree(positions)
        sigma = voxel_size * 3
        k = min(8, len(positions))
        dists, idx = tree.query(grid, k=k, workers=-1)
        if k == 1:
            dists = dists[:, None]; idx = idx[:, None]
        w = np.exp(-(dists**2) / (2 * sigma**2))
        w_sum = w.sum(axis=1) + 1e-8
        diff = grid[:, None, :] - positions[idx]
        sd = np.einsum('vkc,vkc->vk', diff, normals[idx])
        tsdf = ((sd * w).sum(axis=1) / w_sum).reshape(dims[0], dims[1], dims[2])

        try:
            from skimage import measure
            verts, faces, _, _ = measure.marching_cubes(tsdf, level=0.0)
        except (ValueError, RuntimeError) as e:
            print(f'[NIF] Marching cubes found no closed surface — skipping mesh ({e})')
            return None, None, None

        verts_world = verts * voxel_size + mn

        # Vertex colors: nearest trained Gaussian's color
        _, cidx = tree.query(verts_world, k=1, workers=-1)
        vertex_colors = np.clip(colors[cidx] * 255, 0, 255).astype(np.uint8)

        import trimesh
        mesh = trimesh.Trimesh(vertices=verts_world, faces=faces,
                                vertex_colors=vertex_colors, process=True)
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.remove_unreferenced_vertices()

        if len(mesh.faces) > target_max_faces:
            try:
                mesh = mesh.simplify_quadric_decimation(face_count=target_max_faces)
            except Exception as e:
                print(f'[NIF] Decimation unavailable ({e}) — keeping full-res mesh')

        try:
            import manifold3d
            m3_mesh = manifold3d.Mesh(
                vert_properties=mesh.vertices.astype(np.float32),
                tri_verts=mesh.faces.astype(np.uint32),
            )
            manifold = manifold3d.Manifold(m3_mesh)
            if not manifold.is_empty():
                out = manifold.to_mesh()
                mv, mf = out.vert_properties[:, :3], out.tri_verts
                mesh = trimesh.Trimesh(vertices=mv, faces=mf, process=True)
        except Exception as e:
            print(f'[NIF] manifold3d repair skipped (non-fatal): {e}')

        n_verts, n_faces = len(mesh.vertices), len(mesh.faces)
        print(f'[NIF] Mesh extracted: {n_verts:,} verts, {n_faces:,} faces, '
              f'watertight={mesh.is_watertight}')

        colors_out = np.zeros((n_verts, 3), dtype=np.uint8)
        if mesh.visual.vertex_colors is not None:
            colors_out = mesh.visual.vertex_colors[:, :3].astype(np.uint8)

        header = struct.pack('>II', n_verts, n_faces)
        pos_bytes = mesh.vertices.astype('>f4').tobytes()
        col_bytes = colors_out.tobytes()
        face_bytes = mesh.faces.astype('>u4').tobytes()
        mesh_chunk_bytes = header + pos_bytes + col_bytes + face_bytes

        # Optional Draco compression — typically 5-10x smaller than the raw
        # struct format above for meshes this size. ENABLE_DRACO_MESH=True
        # now that nif-format.js's decodeMeshChunk()/_decodeDracoMesh() reads
        # it via THREE.DRACOLoader — but that round trip is UNVERIFIED
        # end-to-end (no browser/wasm available at authoring time; see the
        # caveat on ENABLE_DRACO_MESH's definition and in _decodeDracoMesh's
        # comments about the color-attribute risk specifically). If encoding
        # itself throws for any reason, this falls back to the raw struct
        # format automatically — that path is unaffected regardless.
        if ENABLE_DRACO_MESH:
            try:
                import DracoPy
                draco_bytes = DracoPy.encode(
                    mesh.vertices, mesh.faces,
                    colors=colors_out if colors_out is not None else None,
                    quantization_bits=14, compression_level=7,
                )
                # format_flag: 0x00 = raw struct (above), 0x01 = Draco-encoded
                mesh_chunk_bytes = struct.pack('>B', 0x01) + draco_bytes
                print(f'[NIF] Mesh Draco-encoded: {len(header+pos_bytes+col_bytes+face_bytes):,}B '
                      f'→ {len(mesh_chunk_bytes):,}B')
            except Exception as e:
                print(f'[NIF] Draco encoding unavailable ({e}) — using raw struct mesh format')
                mesh_chunk_bytes = struct.pack('>B', 0x00) + mesh_chunk_bytes
        else:
            mesh_chunk_bytes = struct.pack('>B', 0x00) + mesh_chunk_bytes

        # Real binary STL for the print pipeline. IMPORTANT CAVEAT, logged so
        # it doesn't get lost: mesh coordinates are in reconstruction-space
        # units, not calibrated real-world millimeters — COLMAP SfM is
        # scale-ambiguous without a known reference (a ruler, an AR-tracked
        # capture, or a fixed-size calibration object in frame). A print
        # service needs a real scale factor before this STL is dimensionally
        # trustworthy; right now it prints "a correctly-shaped object at some
        # scale", not "an object that will be X mm tall".
        stl_bytes = None
        try:
            stl_bytes = mesh.export(file_type='stl')
            if not mesh.is_watertight:
                print('[NIF] WARNING: mesh is not watertight — STL may fail '
                      'slicer validation (holes, non-manifold edges)')
        except Exception as e:
            print(f'[NIF] STL export failed (non-fatal, mesh chunk still included): {e}')

        # ── Mesh sanity checks — nondegenerate_faces() is a real, documented
        # trimesh method (returns a boolean keep-mask); zero/near-zero-area
        # triangles are a concrete sign of noisy/failed reconstruction (e.g.
        # duplicate or collapsed vertices from bad Gaussian geometry).
        # Deliberately not adding a non-manifold-edge check — not confident
        # enough in the exact trimesh attribute for that without being able
        # to run it, and a guessed API call that's subtly wrong is worse
        # than leaving it out.
        try:
            keep_mask = mesh.nondegenerate_faces()
            n_degenerate = int(n_faces - int(np.sum(keep_mask)))
        except Exception as e:
            print(f'[NIF] Degenerate-face check failed (non-fatal): {e}')
            n_degenerate = None

        mesh_info = _mesh_quality_report(
            mesh,
            'oriented_tsdf_marching_cubes',
            os.environ.get('FUMOCA_MESH_DETAIL', 'high').lower(),
        )
        return mesh_chunk_bytes, stl_bytes, mesh_info

    def run_mesh_only(self, geo_r2_key: str, meta: dict):
        """
        Lightweight path: extract a real mesh + STL from an already-existing
        set of Gaussians (e.g. whatever survives a lasso/erase edit in the
        studio) without running video/photo capture, COLMAP, or gsplat
        training. Reuses _extract_mesh() and _dequantize_geometry() exactly
        as-is — same tested code, different entry point.

        geo_r2_key: R2 key of a small file containing ONLY a packed
        KEYFRAME_GEO-style blob (see js/modules/nif-format.js's encodeNif
        with no thumbnail/hotspots — just the geometry chunk bytes,
        uploaded raw, not wrapped in a full .nif container, to keep this
        path simple on both ends).
        """
        try:
            self._tick('downloading', 5)
            local = self._download(geo_r2_key)
            geo_bytes = local.read_bytes()

            self._tick('processing', 20)
            count, geo_data = _dequantize_geometry(geo_bytes)
            print(f'[NIF] mesh_only: {count:,} input points')

            self._tick('processing', 50)
            mesh_bytes, stl_bytes, mesh_info = self._extract_mesh(geo_data)

            if not stl_bytes:
                raise RuntimeError(
                    'Mesh extraction produced no printable surface — the '
                    'selection may be too sparse, or too few points survived '
                    'opacity filtering. Try a less aggressive erase, or a '
                    'capture with more coverage of the subject.'
                )

            # Same gap as the main run() path, same fix: STL bytes existing
            # only means the export call didn't crash, not that the mesh is
            # actually manifold. This is the literal "Export Figurine" button
            # a client presses expecting a printable file — it was shipping
            # 'complete' + a download link for leaky/non-manifold geometry
            # with no signal that a slicer might reject it. Now the job
            # itself is honest about which one the client is getting.
            watertight = bool(mesh_info.get('is_watertight'))
            printable = bool(mesh_info.get('printable'))
            if not printable:
                print('[NIF] mesh_only: mesh is NOT print-ready — '
                      'STL will not be published as a trusted print export')

            if not printable:
                SB.table('reconstruction_jobs').update({
                    'status': 'needs_retry', 'progress': 100,
                    'meta': {**meta,
                             'mesh_bytes_included': bool(mesh_bytes),
                             'mesh_watertight': watertight,
                             'mesh_printable': printable,
                             'mesh_quality': mesh_info,
                             'print_warning': 'The reconstructed mesh is not a trusted printable solid. '
                                              'Repair or recapture before sending it to a printer.'},
                }).eq('id', self.job_id).execute()
                self._tick('needs_retry', 100, error_message='Mesh is not print-ready')
                return

            self._tick('uploading', 85)
            stl_key = f'print/{self.user_id}/{self.job_id}/figurine.stl'
            R2.put_object(Bucket=OUTPUT_BUCKET, Key=stl_key, Body=stl_bytes,
                           ContentType='model/stl')

            stl_url = R2.generate_presigned_url(
                'get_object', Params={'Bucket': OUTPUT_BUCKET, 'Key': stl_key}, ExpiresIn=604800,
            )

            SB.table('reconstruction_jobs').update({
                'status': 'complete', 'progress': 100,
                'meta': {**meta, 'stl_r2_key': stl_key, 'stl_url': stl_url,
                         'mesh_bytes_included': bool(mesh_bytes),
                         'mesh_watertight': watertight,
                         'mesh_printable': printable,
                         'mesh_quality': mesh_info,
                         'mesh_volume_m3': mesh_info.get('volume_m3'),
                         'print_warning': None},
            }).eq('id', self.job_id).execute()
            print(f'[NIF] mesh_only complete: {stl_key} (printable={printable})')

        except Exception as e:
            SB.table('reconstruction_jobs').update({
                'status': 'failed', 'error_message': str(e),
            }).eq('id', self.job_id).execute()
            print(f'[NIF] mesh_only FAILED: {e}')
            raise


    # ── Upload ─────────────────────────────────────────────────────────────────
    def _upload_nif(self, data: bytes) -> str:
        key = f'nif/{self.user_id}/{self.job_id}/scene.nif'
        R2.put_object(Bucket=OUTPUT_BUCKET, Key=key, Body=data, ContentType='application/octet-stream')
        print(f'[NIF] Uploaded {len(data):,}B → {key}')
        return key

    def _upload_proxy_video(self, proxy_bytes: bytes, fps: int) -> str:
        """Upload the proxy video as a separate accessible file for sharing/download."""
        key = f'nif/{self.user_id}/{self.job_id}/proxy.mp4'
        R2.put_object(Bucket=OUTPUT_BUCKET, Key=key, Body=proxy_bytes,
                      ContentType='video/mp4')
        print(f'[NIF] Proxy video uploaded → {key}')
        return key

    def _make_thumbnail_bytes(self, frames: list) -> bytes:
        """
        Build a JPEG thumbnail from a quarter-way-through frame (tends to be
        cleaner than frame 0, which is often still mid-motion at capture start).

        Bug fixed here: this previously read frames[min(len(frames)//4, 0)] —
        min(x, 0) is always 0 for any non-negative x, so despite the "quarter-way
        frame" comment, this always grabbed frame 0. Fixed to actually pick the
        quarter-way frame (clamped to a valid index).
        """
        import io
        if not frames:
            return None
        idx = min(len(frames) // 4, len(frames) - 1)
        frame = frames[idx]
        try:
            if hasattr(frame, 'save'):
                buf = io.BytesIO()
                frame.save(buf, format='JPEG', quality=85)
                return buf.getvalue()
            # frame may be a raw numpy array rather than a PIL Image
            Image.fromarray(frame).convert('RGB').save(
                (buf := __import__('io').BytesIO()), format='JPEG', quality=85)
            return buf.getvalue()
        except Exception as e:
            print(f'[NIF] Thumbnail encode failed: {e}')
            return None

    def _upload_thumbnail_bytes(self, jpeg_bytes: bytes) -> str:
        """Upload thumbnail bytes to R2 as a standalone object too (used for
        quick gallery/feed previews without needing to parse the .nif itself)."""
        if not jpeg_bytes:
            return None
        try:
            key = f'nif/{self.user_id}/{self.job_id}/thumb.jpg'
            R2.put_object(Bucket=OUTPUT_BUCKET, Key=key, Body=jpeg_bytes,
                          ContentType='image/jpeg')
            print(f'[NIF] Thumbnail uploaded → {key}')
            return key
        except Exception as e:
            print(f'[NIF] Thumbnail upload failed: {e}')
            return None

    def _pack_meta(self, vertical: str, meta: dict) -> bytes:
        """
        Build the CHUNK_META JSON payload — same shape NIFSpec.js's
        encodeMetaChunk()/decodeMetaChunk() read/write on the JS editor path,
        so a .nif produced by either encoder decodes identically.
        """
        payload = {
            'title':       meta.get('title') or 'Untitled NIF',
            'description': meta.get('description') or '',
            'author':      self.user_id,
            'vertical':    vertical,
            'hotspots':    meta.get('hotspots') or [],
            'tourStops':   meta.get('tourStops') or [],
            'createdAt':   _now_iso(),
        }
        return json.dumps(payload).encode('utf-8')

    # ── Register ───────────────────────────────────────────────────────────────
    def _register(self, r2_key: str, n: int, vertical: str,
                  meta: dict, file_size: int, capabilities: dict,
                  min_acceptable: bool = True, quality_reason: str = None):
        title = meta.get('title', 'Untitled NIF')

        # Build a public-ish signed URL for thumbnail (24 hour expiry)
        thumb_url = None
        thumb_key = capabilities.get('thumbnail_r2_key')
        if thumb_key:
            try:
                from botocore.signers import generate_presigned_url
                thumb_url = R2.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': OUTPUT_BUCKET, 'Key': thumb_key},
                    ExpiresIn=86400,
                )
            except Exception:
                thumb_url = None  # non-fatal

        SB.table('nif_files').insert({
            'id':             self.job_id,
            'user_id':        self.user_id,
            'title':          title,
            'vertical':       vertical,
            'r2_key':         r2_key,
            'gaussian_count': n,
            'file_size':      file_size,
            # is_public stays False regardless of quality — publishing is a
            # separate, explicit user action. min_acceptable only governs
            # whether the *job* reports back as done-and-shippable versus
            # needs-a-retry; it never auto-publishes anything either way.
            'is_public':      False,
            'thumbnail_url':  thumb_url,
            'meta':           {**meta, **capabilities},
        }).execute()
        # status is set by the caller's self._tick() right after this
        # (either 'complete' or 'needs_retry') — _register() only creates
        # the nif_files row so a below-bar capture is still inspectable
        # internally instead of being thrown away.
        print(f'[NIF] Registered nif_files id={self.job_id} '
              f"(min_acceptable={min_acceptable}{f', reason={quality_reason}' if quality_reason else ''})")


# ─── CLI ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    if len(sys.argv) < 4:
        print('Usage: pipeline.py <job_id> <user_id> <raw_r2_key> [vertical] [capture_mode]')
        sys.exit(1)
    job_id       = sys.argv[1]
    user_id      = sys.argv[2]
    raw_r2_key   = sys.argv[3]
    vertical     = sys.argv[4] if len(sys.argv) > 4 else 'generic'
    capture_mode = sys.argv[5] if len(sys.argv) > 5 else 'video'
    meta         = json.loads(sys.argv[6]) if len(sys.argv) > 6 else {}

    worker = ReconstructionWorker(job_id, user_id)
    if capture_mode == 'mesh_only':
        # On-demand print export from the studio's current edit selection —
        # skips video/photo/COLMAP/training entirely, reuses the tested
        # mesh-extraction path directly against an already-existing geometry blob.
        worker.run_mesh_only(raw_r2_key, meta)
    else:
        worker.run(raw_r2_key, vertical, capture_mode, meta)
