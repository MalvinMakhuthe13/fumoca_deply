"""python engine-next/reconstruction/test_angle_fill.py"""
import os
import numpy as np
from angle_fill import warp_view, fill_missing_angles

h, w = 32, 48
rgb = np.zeros((h, w, 3), np.uint8)
rgb[:, : w // 2] = (200, 40, 40)
rgb[:, w // 2 :] = (40, 40, 200)
depth = np.linspace(0, 1, w, dtype=np.float32)[None, :].repeat(h, axis=0)
out = warp_view(rgb, depth, 8)
assert out.shape == rgb.shape
assert out.sum() > 0

frames = [rgb, rgb]
depths = [depth, depth]
os.environ['FUMOCA_ANGLE_FILL'] = 'auto'
more_f, more_d = fill_missing_angles(frames, depths, min_views=36)
assert len(more_f) == 2 + 2 * 4
assert len(more_d) == len(more_f)

many = [rgb] * 40
many_d = [depth] * 40
same_f, same_d = fill_missing_angles(many, many_d, min_views=36)
assert len(same_f) == 40

os.environ['FUMOCA_ANGLE_FILL'] = '0'
off_f, _ = fill_missing_angles(frames, depths, min_views=36)
assert len(off_f) == 2
print('angle fill ok')
