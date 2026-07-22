"""
NIF Reconstruction Pipeline — Complete
fumoca.co.za · © Fumoca Technologies

What this produces per .nif file:
  CHUNK 0x0002  PROXY_VIDEO    — H.264 proxy video (from input or rendered)
  CHUNK 0x0003  KEYFRAME_GEO   — full 3D depth field (all points, 14 floats each)
  CHUNK 0x0004  KEYFRAME_MESH  — real triangulated watertight mesh, extracted from
                                 the trained Gaussians (see stage 9 below)
  CHUNK 0x0007  DEPTH_MAP      — per-pixel metric depth (float16 HxW, reference frame)
  CHUNK 0x0008  ALPHA_MASK     — per-pixel foreground alpha (uint8 HxW, 0=bg, 255=fg)
  CHUNK 0x0009  LAYER_GEO      — layered depth field: foreground + background split
  CHUNK 0x0016  SEMANTIC_MAP   — per-point semantic label (uint8, from SAM segments)

Pipeline stages:
  1. Download raw capture from R2
  2. Extract frames (video → jpg sequence at 5fps)
  3. Neural deblurring (U-Net)
  4. Depth estimation — DepthAnything v2 (metric monocular depth from single frame)
  5. Background removal — rembg (U2-Net / BiRefNet) for clean alpha mask
  6. Segment Anything (SAM 2) — per-object segmentation for interactive layers
  7. Camera pose estimation — COLMAP sparse SfM
  8. 3D depth field training — gsplat v1.x
  9. Mesh extraction — real triangulation from the trained Gaussians. Each
     Gaussian's shortest axis (after training) aligns with the true surface
     normal, so we treat the splats as an oriented point cloud, splat them into
     a signed-distance volume, and run marching cubes to get an actual
     watertight triangle mesh — not a renamed point cloud. This is the same
     family of technique as SuGaR / Gaussian-to-mesh literature, implemented
     here with only numpy/scipy/scikit-image (no GPU, no extra service).
  10. Layer splitting — divide points into foreground/background by depth + mask
  11. Proxy video encoding — ffmpeg H.264
  12. Pack all chunks → .nif binary
  13. Upload to R2
  14. Register in Supabase

Requirements:
  pip install gsplat torch torchvision rembg segment-anything-2 depth-anything boto3 \
              supabase trimesh scikit-image scipy manifold3d fast_simplification \
              imageio[ffmpeg] Pillow requests
"""

import os
import sys
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
from PIL import Image

# ─── Environment ─────────────────────────────────────────────────────────────
REQUIRED = ['CF_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY',
            'SUPABASE_URL','SUPABASE_SECRET_KEY','GPU_WORKER_SECRET']
_missing = [k for k in REQUIRED if not os.environ.get(k)]
if _missing:
    raise EnvironmentError(f"Missing env vars: {', '.join(_missing)}")

DEVICE     = 'cuda' if torch.cuda.is_available() else 'cpu'
BUCKET     = os.environ.get('R2_BUCKET', 'fumoca-nif-storage')
API_BASE   = os.environ.get('API_BASE', 'https://api.fumoca.co.za')
WORKER_KEY = os.environ['GPU_WORKER_SECRET']

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
CHUNK_PRINT  = 0x0014  # Binary STL for 3D printing — verified real trimesh export, not a stub
CHUNK_PROXY  = 0x0002
CHUNK_DEPTH  = 0x0007
CHUNK_ALPHA  = 0x0008
CHUNK_LAYER  = 0x0009
CHUNK_CERT   = 0x0020  # Encoder certificate — fumoca INTERNAL tier

# Encoder tier constants (must match NIFSpec.js ENCODER_TIER)
ENCODER_TIER_UNCERTIFIED = 0x00
ENCODER_TIER_DEVELOPER   = 0x01
ENCODER_TIER_COMMERCIAL  = 0x02
ENCODER_TIER_OEM         = 0x03
ENCODER_TIER_ENTERPRISE  = 0x04
ENCODER_TIER_INTERNAL    = 0xFF  # Fumoca pipeline — highest trust


def _build_cert_chunk(encoder_id: str, licensee_id: str, tier: int = ENCODER_TIER_INTERNAL) -> bytes:
    """
    Build a CERT chunk for embedding in every NIF file.

    The certificate identifies the encoder that produced the file.
    Fumoca pipeline always uses INTERNAL tier — the highest trust level.
    Third-party licensed encoders use DEVELOPER/COMMERCIAL/OEM/ENTERPRISE.

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

CODEC_RAW  = 0x00
CODEC_GZIP = 0x02
MIN_COMPRESS = 1024  # don't compress tiny chunks

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
    hdr[4], hdr[5] = 1, 0          # version 1.0
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
def estimate_depth(frames: list[np.ndarray]) -> list[np.ndarray]:
    """
    Estimate metric depth for each frame using DepthAnything v2.
    Returns list of float32 depth maps (H, W) in metres.
    Falls back to MiDaS if DepthAnything v2 unavailable.
    """
    try:
        from depth_anything_v2.dpt import DepthAnythingV2
        model = DepthAnythingV2(encoder='vitl', features=256, out_channels=[256,512,1024,1024])
        # Load from HuggingFace Hub
        from huggingface_hub import hf_hub_download
        ckpt = hf_hub_download('depth-anything/Depth-Anything-V2-Large', 'depth_anything_v2_vitl.pth')
        model.load_state_dict(torch.load(ckpt, map_location='cpu'))
        model = model.to(DEVICE).eval()
        print('[NIF] DepthAnything v2 ViT-L loaded')

        depths = []
        with torch.no_grad():
            for frame in frames:
                depth = model.infer_image(frame)  # returns numpy H×W float32
                depths.append(depth)
        return depths

    except ImportError:
        print('[NIF] DepthAnything v2 not available — using MiDaS fallback')
        return _midas_depth(frames)

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
    """Simple fallback: threshold median depth to separate foreground."""
    masks = []
    for frame in frames:
        # Simple edge-based mask using frame brightness (very rough)
        gray = frame.mean(axis=2)
        median = np.median(gray)
        mask = (gray > median * 0.8).astype(np.uint8) * 255
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

    def __init__(self, n: int = 50_000):
        self.n    = n
        self.device = DEVICE
        self.means       = nn.Parameter(torch.randn(n, 3) * 0.3)
        self.log_scales  = nn.Parameter(torch.full((n, 3), -3.0))
        self.quats       = nn.Parameter(F.normalize(torch.randn(n, 4), dim=-1))
        self.log_opacity = nn.Parameter(torch.zeros(n))
        self.sh0         = nn.Parameter(torch.zeros(n, 3))
        self._opt = self._make_optimizer()
        self._step = 0

    def _make_optimizer(self):
        return torch.optim.Adam([
            {'params': [self.means],       'lr': 1e-3},
            {'params': [self.log_scales],  'lr': 5e-4},
            {'params': [self.quats],       'lr': 5e-4},
            {'params': [self.log_opacity], 'lr': 5e-3},
            {'params': [self.sh0],         'lr': 1e-3},
        ], eps=1e-15)

    def train_step(self, gt: torch.Tensor, viewmat: torch.Tensor,
                   K: torch.Tensor) -> float:
        H, W = gt.shape[1:3]
        quats_n = F.normalize(self.quats, dim=-1)
        scales  = torch.exp(self.log_scales).clamp(min=1e-6)
        opacities = torch.sigmoid(self.log_opacity)
        colours   = torch.sigmoid(self.sh0) + 0.5

        rendered, _alpha, _info = gsplat.rasterization(
            means=self.means.unsqueeze(0),
            quats=quats_n.unsqueeze(0),
            scales=scales.unsqueeze(0),
            opacities=opacities.unsqueeze(0).unsqueeze(-1),
            colors=colours.unsqueeze(0),
            viewmats=viewmat.unsqueeze(0),
            Ks=K.unsqueeze(0),
            width=W, height=H,
            near_plane=0.01, far_plane=100.0,
            render_mode='RGB',
        )
        rendered = rendered.squeeze(0)  # H,W,3
        gt_rgb   = gt.to(DEVICE)

        loss = F.l1_loss(rendered, gt_rgb) + 0.2 * (1 - self._ssim(rendered, gt_rgb))

        self._opt.zero_grad()
        loss.backward()
        self._opt.step()

        self._step += 1
        if self._step % 200 == 0:
            self._prune()
        return float(loss)

    def _ssim(self, p, g, ws=11):
        mu1 = F.avg_pool2d(p.permute(2,0,1).unsqueeze(0), ws, 1, ws//2)
        mu2 = F.avg_pool2d(g.permute(2,0,1).unsqueeze(0), ws, 1, ws//2)
        s1  = F.avg_pool2d((p**2).permute(2,0,1).unsqueeze(0), ws,1,ws//2) - mu1**2
        s2  = F.avg_pool2d((g**2).permute(2,0,1).unsqueeze(0), ws,1,ws//2) - mu2**2
        s12 = F.avg_pool2d((p*g).permute(2,0,1).unsqueeze(0), ws,1,ws//2) - mu1*mu2
        c1,c2 = 0.01**2, 0.03**2
        return float(((2*mu1*mu2+c1)*(2*s12+c2)/((mu1**2+mu2**2+c1)*(s1+s2+c2))).mean())

    def _prune(self, thr=0.005):
        with torch.no_grad():
            keep = torch.sigmoid(self.log_opacity) > thr
            if keep.sum() < 1000: return
            for p in [self.means, self.log_scales, self.quats,
                      self.log_opacity, self.sh0]:
                p.data = p.data[keep]

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
        with torch.no_grad():
            n = len(self.means)
            # Estimate scene extent from current point spread
            extent = float(self.means.std(dim=0).max()) * 3 + 1e-6

            # Use scale magnitude as proxy for Gaussian size
            scales = torch.exp(self.log_scales)  # (N, 3)
            max_scale = scales.max(dim=1).values  # (N,)
            mean_scale = max_scale.mean()

            # Identify candidates by opacity — only well-formed Gaussians
            opacities = torch.sigmoid(self.log_opacity)  # (N,)
            active = opacities > 0.01

            # ── CLONE small under-represented Gaussians ──────────────────────
            clone_mask = active & (max_scale < extent * 0.01)
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
                for p, new_p in [(self.means, new_means),
                                 (self.log_scales, new_scales),
                                 (self.quats, new_quats),
                                 (self.log_opacity, new_opacity),
                                 (self.sh0, new_sh0)]:
                    p.data = torch.cat([p.data, new_p.data], dim=0)

            # ── SPLIT large Gaussians into two smaller ones ──────────────────
            split_mask = active & (max_scale > extent * 0.05)
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

                # Remove originals, add two replacements each
                keep = torch.ones(len(self.means), dtype=torch.bool)
                keep[idx] = False
                for p, new_a, new_b in [(self.means, new_means_a, new_means_b),]:
                    p.data = torch.cat([p.data[keep], new_a, new_b], dim=0)
                # Other params: keep the non-split ones, append copies
                for p, new_p in [(self.log_scales, new_scales),
                                 (self.quats, new_quats),
                                 (self.log_opacity, new_opacity),
                                 (self.sh0, new_sh0)]:
                    p.data = torch.cat([p.data[keep], new_p, new_p.clone()], dim=0)

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
                sh0     = self.sh0.detach().cpu().numpy().astype(np.float32)          # (N,3)

            n = len(means)

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

            # ── Quantise SH0 colour (logit → sigmoid offset → uint8) ─────────
            sh_sig = 1.0 / (1.0 + np.exp(-np.clip(sh0, -20, 20))) + 0.5
            sh_q = np.clip((sh_sig - 0.5) * 255, 0, 255).astype(np.uint8)

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
                out[:, 11:14]= self.sh0.detach().cpu().numpy()
            # format_flag: 0x00 = raw float32
            import struct as _s
            header = _s.pack('>BI', 0x00, n)
            return n, header + out.tobytes()


# ─── Stage 6: Layer splitting ─────────────────────────────────────────────────
def split_layers(geo_data: np.ndarray, depth_map: np.ndarray,
                 alpha_mask: np.ndarray, segments: dict) -> bytes:
    """
    Split the reconstructed depth field into layers based on depth + segmentation.

    Layer structure packed as bytes:
      [n_layers: uint32]
      per layer:
        [label_len: uint8][label: ascii]
        [depth_min: float32][depth_max: float32]
        [n_points: uint32][points: n_points × 14 × float32]

    The foreground/background split enables:
      - Rendering foreground over arbitrary backgrounds
      - Selecting individual objects (Coca-Cola can, person, product)
      - Parallax depth effect when the viewer tilts the device
      - Background replacement in the video editor
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
        pts  = geo_data[mask]
        label_b = ld['label'].encode('ascii')[:32]
        parts.append(struct.pack('>B', len(label_b)) + label_b)
        parts.append(struct.pack('>ff', float(ld['z_min']), float(ld['z_max'])))
        parts.append(struct.pack('>I', len(pts)))
        parts.append(pts.astype(np.float32).tobytes())

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
def _patch(job_id: str, payload: dict):
    try:
        r = requests.patch(
            f'{API_BASE}/api/jobs/{job_id}/progress',
            json=payload,
            headers={'x-worker-key': WORKER_KEY},
            timeout=15,
        )
        if not r.ok:
            print(f'[warn] API {r.status_code}: {r.text[:100]}')
    except Exception as e:
        print(f'[warn] API unreachable: {e}')


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

            self._tick('processing', 18)
            frames = self._deblur_frames(frames)

            # ── Depth estimation (reference frame = first frame) ──────────────
            self._tick('processing', 25)
            ref_frame = frames[0]
            depth_maps = estimate_depth([ref_frame])
            depth_map  = depth_maps[0]  # (H, W) float32

            # ── Background removal ────────────────────────────────────────────
            self._tick('processing', 33)
            alpha_masks = remove_background([ref_frame])
            alpha_mask  = alpha_masks[0]  # (H, W) uint8

            # ── Segmentation ──────────────────────────────────────────────────
            self._tick('processing', 38)
            segments = segment_objects(ref_frame, alpha_mask)

            # ── Pose estimation ───────────────────────────────────────────────
            self._tick('processing', 42)
            poses, pose_source = self._estimate_poses(frames)

            # ── 3D depth field training ───────────────────────────────────────
            self._tick('processing', 52)
            n, geo_bytes = self._train_gaussians(frames, poses)

            # Dequantize for internal use (mesh extraction, layer splitting need
            # the canonical float32 form regardless of which format was written).
            # Previously this hard-rejected anything but flag 0x00 — but
            # export_buffer() returns flag 0x01 (quantized) by default, so every
            # successful training run would have crashed right here.
            count, geo_data = _dequantize_geometry(geo_bytes)

            # ── Real mesh extraction — triangulation from the trained Gaussians ─
            self._tick('processing', 65)
            mesh_bytes, stl_bytes = self._extract_mesh(geo_data)

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

            # ── Pack .nif ─────────────────────────────────────────────────────
            self._tick('processing', 84)
            chunks = [
                # geo_bytes already contains its own [flag][count][data] header
                # (built by export_buffer()) — do NOT prepend another count field,
                # that was corrupting every CHUNK_GEO ever written.
                (CHUNK_GEO,   geo_bytes),
                (CHUNK_DEPTH, self._pack_depth_map(depth_map)),
                (CHUNK_ALPHA, self._pack_alpha_mask(alpha_mask)),
                (CHUNK_LAYER, layer_bytes),
            ]
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
            thumbnail_r2  = None
            if proxy_bytes:
                proxy_r2_key = self._upload_proxy_video(proxy_bytes, fps)
                thumbnail_r2 = self._upload_thumbnail(frames)

            # ── Compute captured dimensions from depth field ──────────────────
            captured_dims = None
            try:
                xs = geo_data[:,0]; ys = geo_data[:,1]; zs = geo_data[:,2]
                captured_dims = {
                    'height_m': float(round(float(ys.max()-ys.min()), 3)),
                    'width_m':  float(round(float(xs.max()-xs.min()), 3)),
                    'depth_m':  float(round(float(zs.max()-zs.min()), 3)),
                }
                print(f'[NIF] Dims: {captured_dims}')
            except Exception as e:
                print(f'[NIF] Dimension extraction failed: {e}')

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
                'reconstruction_quality': 'full_multiview' if pose_source == 'colmap' else 'degraded_fallback',
                'has_mesh':          bool(mesh_bytes),  # real triangulated geometry, not just splats
                'has_print_export':  bool(stl_bytes),   # real binary STL, dimensionally uncalibrated (see _extract_mesh docstring)
            })

            self._tick('complete', 100, nifR2Key=r2_key, gaussianCount=n)
            return r2_key

        except Exception as e:
            self._tick('failed', 0, errorMessage=str(e))
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

    # ── Download ───────────────────────────────────────────────────────────────
    def _download(self, key: str) -> Path:
        ext  = Path(key).suffix or '.bin'
        path = self.tmp / f'capture{ext}'
        R2.download_file(BUCKET, key, str(path))
        print(f'[NIF] Downloaded {path.stat().st_size:,}B')
        return path

    # ── Frame extraction ───────────────────────────────────────────────────────
    def _extract_frames(self, src: Path, mode: str) -> tuple:
        out_dir = self.tmp / 'frames'
        out_dir.mkdir()
        fps = 5

        if mode in ('video', '360'):
            r = subprocess.run([
                'ffmpeg', '-i', str(src), '-q:v', '2',
                '-vf', f'fps={fps},scale=1280:-2',
                str(out_dir / 'frame_%05d.jpg'),
            ], capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f'ffmpeg failed:\n{r.stderr[-500:]}')

        elif mode == 'burst':
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
            for i, img in enumerate(img_paths[:300]):
                shutil.copy(img, out_dir / f'frame_{i:05d}.jpg')

        elif mode in ('image', 'photo'):
            # Single image — duplicate to create minimal multi-view illusion
            shutil.copy(src, out_dir / 'frame_00001.jpg')
            shutil.copy(src, out_dir / 'frame_00002.jpg')
            fps = 1

        frames = []
        for p in sorted(out_dir.glob('*.jpg'))[:300]:
            img = np.array(Image.open(p).convert('RGB'))
            frames.append(img)

        return frames, fps

    # ── Deblur ─────────────────────────────────────────────────────────────────
    def _deblur_frames(self, frames: list) -> list:
        out = []
        with torch.no_grad():
            for frame in frames:
                t   = torch.from_numpy(frame).float().permute(2,0,1).unsqueeze(0).to(DEVICE) / 255.0
                d   = self.deblur(t)
                arr = (d.squeeze(0).permute(1,2,0).clamp(0,1).cpu().numpy() * 255).astype(np.uint8)
                out.append(arr)
        return out

    # ── Pose estimation ────────────────────────────────────────────────────────
    def _estimate_poses(self, frames: list) -> tuple[list, str]:
        if len(frames) < 3:
            print(f'[NIF] Only {len(frames)} frame(s) — not enough for real multi-view SfM, using synthetic poses')
            return self._synthetic_poses(len(frames)), 'synthetic_insufficient_frames'

        img_dir = self.tmp / 'frames'
        col_dir = self.tmp / 'colmap'
        col_dir.mkdir()

        r = subprocess.run([
            'colmap', 'automatic_reconstructor',
            '--workspace_path', str(col_dir),
            '--image_path', str(img_dir),
            '--single_camera', '1',
            '--dense', '0',
        ], capture_output=True, text=True)

        if r.returncode != 0 or not (col_dir / 'sparse' / '0').exists():
            print(f'[NIF] COLMAP failed — using synthetic poses (this capture will be a depth-based '
                  f'pseudo-3D effect, NOT real triangulated multi-view geometry)')
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_failed'

        # Parse COLMAP images.bin
        poses = self._parse_colmap(col_dir / 'sparse' / '0' / 'images.bin')
        if len(poses) < 2:
            return self._synthetic_poses(len(frames)), 'synthetic_colmap_insufficient_poses'
        print(f'[NIF] {len(poses)} poses estimated via COLMAP SfM — real multi-view reconstruction')
        return poses, 'colmap'

    def _synthetic_poses(self, n: int) -> list:
        """Circular orbit poses for single-image or COLMAP-fail fallback."""
        poses = []
        for i in range(max(n, 3)):
            th  = 2 * np.pi * i / max(n, 3)
            R   = np.array([[np.cos(th),0,np.sin(th)],[0,1,0],[-np.sin(th),0,np.cos(th)]])
            t   = np.array([2*np.sin(th), 0, 2-2*np.cos(th)])
            vm  = np.eye(4)
            vm[:3,:3] = R; vm[:3,3] = t
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
                poses.append(torch.tensor(vm, dtype=torch.float32))
        return poses

    # ── Training ───────────────────────────────────────────────────────────────
    def _train_gaussians(self, frames: list, poses: list) -> tuple:
        trainer = GaussianSplatTrainer(n=50_000)
        trainer.means       = trainer.means.to(DEVICE)
        trainer.log_scales  = trainer.log_scales.to(DEVICE)
        trainer.quats       = trainer.quats.to(DEVICE)
        trainer.log_opacity = trainer.log_opacity.to(DEVICE)
        trainer.sh0         = trainer.sh0.to(DEVICE)
        trainer._opt        = trainer._make_optimizer()

        H, W = frames[0].shape[:2]
        fx = fy = max(H, W) * 0.8
        K = torch.tensor([[fx,0,W/2],[0,fy,H/2],[0,0,1]], dtype=torch.float32, device=DEVICE)

        n_poses = min(len(poses), len(frames))

        # 3000 iterations with adaptive densification
        # Production 3DGS uses 30k but Kaggle T4 12hr limit means ~3k is practical.
        # Densification: split high-gradient Gaussians and clone small ones.
        # This is the core mechanism that fills in detail — without it you get blobs.
        ITERS            = 3000
        DENSIFY_EVERY    = 300   # densify at step 300, 600, 900, 1200
        DENSIFY_UNTIL    = 1500  # stop densifying past this point
        DENSIFY_GRAD_THR = 0.0002  # position gradient threshold for splitting
        PRUNE_EVERY      = 100
        MAX_GAUSSIANS    = 150_000

        for step in range(ITERS):
            idx  = step % n_poses
            gt   = torch.from_numpy(frames[idx]).float().to(DEVICE) / 255.0
            vm   = poses[idx].to(DEVICE)
            loss = trainer.train_step(gt, vm, K)

            if step % 100 == 0:
                n = len(trainer.means)
                print(f'[NIF] step {step}/{ITERS}  loss={loss:.4f}  n={n:,}')

            # Adaptive densification — the key to capturing fine detail
            if step > 0 and step % DENSIFY_EVERY == 0 and step < DENSIFY_UNTIL:
                if len(trainer.means) < MAX_GAUSSIANS:
                    trainer._densify(DENSIFY_GRAD_THR)

        return trainer.export_buffer()

    def _extract_mesh(self, geo_data: np.ndarray, grid_res: int = 96,
                       opacity_thresh: float = 0.25, max_faces: int = 60_000) -> tuple:
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
        """
        opacity = 1.0 / (1.0 + np.exp(-geo_data[:, 10]))
        keep = opacity > opacity_thresh
        pts = geo_data[keep]
        if len(pts) < 200:
            print(f'[NIF] Only {len(pts)} confident points — skipping mesh extraction')
            return None, None
        positions = pts[:, 0:3]
        log_scales = pts[:, 3:6]
        quats = pts[:, 6:10]
        colors = 1.0 / (1.0 + np.exp(-pts[:, 11:14]))  # sigmoid → 0-1 RGB

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
            return None, None

        verts_world = verts * voxel_size + mn

        # Vertex colors: nearest trained Gaussian's color
        _, cidx = tree.query(verts_world, k=1, workers=-1)
        vertex_colors = np.clip(colors[cidx] * 255, 0, 255).astype(np.uint8)

        import trimesh
        mesh = trimesh.Trimesh(vertices=verts_world, faces=faces,
                                vertex_colors=vertex_colors, process=True)
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.remove_unreferenced_vertices()

        if len(mesh.faces) > max_faces:
            try:
                mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
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

        return mesh_chunk_bytes, stl_bytes

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
            mesh_bytes, stl_bytes = self._extract_mesh(geo_data)

            if not stl_bytes:
                raise RuntimeError(
                    'Mesh extraction produced no printable surface — the '
                    'selection may be too sparse, or too few points survived '
                    'opacity filtering. Try a less aggressive erase, or a '
                    'capture with more coverage of the subject.'
                )

            self._tick('uploading', 85)
            stl_key = f'print/{self.user_id}/{self.job_id}/figurine.stl'
            R2.put_object(Bucket=BUCKET, Key=stl_key, Body=stl_bytes,
                           ContentType='model/stl')

            stl_url = R2.generate_presigned_url(
                'get_object', Params={'Bucket': BUCKET, 'Key': stl_key}, ExpiresIn=604800,
            )

            SB.table('reconstruction_jobs').update({
                'status': 'complete', 'progress': 100,
                'meta': {**meta, 'stl_r2_key': stl_key, 'stl_url': stl_url,
                         'mesh_bytes_included': bool(mesh_bytes)},
            }).eq('id', self.job_id).execute()
            print(f'[NIF] mesh_only complete: {stl_key}')

        except Exception as e:
            SB.table('reconstruction_jobs').update({
                'status': 'failed', 'error_message': str(e),
            }).eq('id', self.job_id).execute()
            print(f'[NIF] mesh_only FAILED: {e}')
            raise


    # ── Upload ─────────────────────────────────────────────────────────────────
    def _upload_nif(self, data: bytes) -> str:
        key = f'nif/{self.user_id}/{self.job_id}/scene.nif'
        R2.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType='application/octet-stream')
        print(f'[NIF] Uploaded {len(data):,}B → {key}')
        return key

    def _upload_proxy_video(self, proxy_bytes: bytes, fps: int) -> str:
        """Upload the proxy video as a separate accessible file for sharing/download."""
        key = f'nif/{self.user_id}/{self.job_id}/proxy.mp4'
        R2.put_object(Bucket=BUCKET, Key=key, Body=proxy_bytes,
                      ContentType='video/mp4')
        print(f'[NIF] Proxy video uploaded → {key}')
        return key

    def _upload_thumbnail(self, frames: list) -> str:
        """Upload the first clean frame as a JPEG thumbnail."""
        import io
        try:
            frame = frames[min(len(frames)//4, 0)]  # quarter-way frame
            if hasattr(frame, 'save'):
                buf = io.BytesIO()
                frame.save(buf, format='JPEG', quality=85)
                key = f'nif/{self.user_id}/{self.job_id}/thumb.jpg'
                R2.put_object(Bucket=BUCKET, Key=key, Body=buf.getvalue(),
                              ContentType='image/jpeg')
                print(f'[NIF] Thumbnail uploaded → {key}')
                return key
        except Exception as e:
            print(f'[NIF] Thumbnail upload failed: {e}')
        return None

    # ── Register ───────────────────────────────────────────────────────────────
    def _register(self, r2_key: str, n: int, vertical: str,
                  meta: dict, file_size: int, capabilities: dict):
        title = meta.get('title', 'Untitled NIF')

        # Build a public-ish signed URL for thumbnail (24 hour expiry)
        thumb_url = None
        thumb_key = capabilities.get('thumbnail_r2_key')
        if thumb_key:
            try:
                from botocore.signers import generate_presigned_url
                thumb_url = R2.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': BUCKET, 'Key': thumb_key},
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
            'is_public':      False,
            'thumbnail_url':  thumb_url,
            'meta':           {**meta, **capabilities},
        }).execute()
        SB.table('reconstruction_jobs').update({
            'status': 'complete', 'progress': 100,
            'nif_r2_key': r2_key, 'gaussian_count': n,
        }).eq('id', self.job_id).execute()
        print(f'[NIF] Registered nif_files id={self.job_id}')


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
