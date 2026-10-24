"""
Extra side views from a thin set of photos.

A video that already walks around the subject is left alone. A handful of
stills, or one product photo, is depth-warped a few degrees left and right
so the trainer is not staring at the same pixels twice.

This is not a new camera and not COLMAP. Holes are filled from the original
photo. It only runs when the real view count is low, unless
FUMOCA_ANGLE_FILL=1 forces it or FUMOCA_ANGLE_FILL=0 turns it off.
"""

import os

import numpy as np


def warp_view(rgb: np.ndarray, depth: np.ndarray, shift_px: float) -> np.ndarray:
    """Slide nearer pixels sideways. Farther pixels stay put."""
    rgb = np.asarray(rgb)
    h, w = rgb.shape[:2]
    d = np.asarray(depth, dtype=np.float32)
    if d.shape != (h, w):
        # Nearest resize, no extra dependencies.
        ys = (np.linspace(0, d.shape[0] - 1, h)).astype(np.int32)
        xs = (np.linspace(0, d.shape[1] - 1, w)).astype(np.int32)
        d = d[ys][:, xs]
    lo, hi = np.percentile(d, 5), np.percentile(d, 95)
    norm = np.clip((d - lo) / (hi - lo + 1e-6), 0, 1)
    closer = 1.0 - norm
    disp = closer * float(shift_px)
    ys, xs = np.mgrid[0:h, 0:w]
    nx = np.clip(np.rint(xs + disp).astype(np.int32), 0, w - 1)
    dest = np.full((h, w), -1.0, np.float32)
    np.maximum.at(dest, (ys, nx), closer)
    wins = np.abs(dest[ys, nx] - closer) <= 1e-4
    out = np.zeros_like(rgb)
    out[ys[wins], nx[wins]] = rgb[ys[wins], xs[wins]]
    holes = out.sum(axis=2) == 0
    out[holes] = rgb[holes]
    return out


def fill_missing_angles(frames, depths, min_views: int = 36):
    mode = os.environ.get('FUMOCA_ANGLE_FILL', 'auto')
    n = len(frames)
    if mode == '0' or n == 0:
        return frames, depths
    if n >= min_views and mode != '1':
        print(f'[NIF] {n} views already cover the subject — not inventing extra angles')
        return frames, depths
    if len(depths) != n:
        print('[NIF] Angle fill skipped — depth count does not match frames')
        return frames, depths

    take = min(n, 8)
    if take == 1:
        idxs = [0]
    else:
        idxs = [int(round(i * (n - 1) / (take - 1))) for i in range(take)]
    shifts = (-36, -18, 18, 36)
    extra_f = []
    extra_d = []
    for i in idxs:
        w = frames[i].shape[1]
        scale = max(w / 1280.0, 0.4)
        for s in shifts:
            extra_f.append(warp_view(frames[i], depths[i], s * scale))
            extra_d.append(np.asarray(depths[i], dtype=np.float32))
    print(f'[NIF] Angle fill: {n} real view(s) + {len(extra_f)} side views from depth')
    return list(frames) + extra_f, list(depths) + extra_d
