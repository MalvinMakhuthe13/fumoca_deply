"""
Tests for engine-next/reconstruction/verify.py — product verification (ICP
alignment + per-vertex deviation + tolerance pass/fail).

This module had ZERO test coverage before this file. Writing synthetic-mesh
tests against it immediately caught two real bugs that had been sitting in
unexecuted code:

  1. trimesh.registration.icp()'s return-tuple arity differs across trimesh
     versions ((matrix, cost) vs (matrix, transformed, cost)) — the old code
     hardcoded a 2-tuple unpack, so every single call to verify_against_
     reference() failed immediately with a generic "meshes too dissimilar"
     error, even for two literally identical meshes.

  2. trimesh's icp() calls procrustes() with scale=True, reflection=True by
     default. That means ICP was silently RESIZING the candidate mesh to
     fit the reference before measuring deviation — for product
     verification specifically, that hides the exact defect (wrong size)
     this feature exists to catch. A 20%-oversized synthetic test part
     registered as a near-perfect match until this was locked down with
     scale=False, reflection=False in verify.py's _run_icp().

  3. (Found during the same pass) Deviation was measured as nearest-VERTEX
     distance via a raw cKDTree on reference_mesh.vertices, not nearest-
     SURFACE distance. For any low-poly mesh this wildly overstates
     deviation — an identical cube compared to itself (rotated/translated)
     reported 15.7mm "deviation" purely because candidate points landing
     mid-face were far from the nearest corner vertex. Fixed to use
     reference_mesh.nearest.on_surface().

Run directly: python3 tests/verify.test.py  (needs numpy, trimesh, scipy —
same runtime deps as reconstruction/pipeline.py and verify.py themselves.)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'reconstruction'))

import numpy as np
import trimesh
from verify import verify_against_reference

pass_count = 0
fail_count = 0


def check(name, cond, detail=''):
    global pass_count, fail_count
    if cond:
        pass_count += 1
        print('PASS:', name)
    else:
        fail_count += 1
        print('FAIL:', name, detail)


# --- TEST 1: identical mesh vs itself — should pass, ~zero deviation ---
ref = trimesh.creation.box(extents=[0.1, 0.1, 0.1])  # 100mm cube, metres scale
cand_identical = ref.copy()
r1 = verify_against_reference(cand_identical, ref, tolerance_mm=2.0,
                               candidate_calibrated=True, reference_calibrated=True)
check('identical mesh: pass=True', r1.get('pass') is True, r1)
check('identical mesh: dimensionally_trustworthy=True', r1.get('dimensionally_trustworthy') is True, r1)
check('identical mesh: mean_deviation < 0.5mm', r1.get('mean_deviation', 999) < 0.5, r1)

# --- TEST 2: candidate offset + rotated, same shape — ICP should still find
# a good alignment and pass. This is the case that exposed the nearest-
# VERTEX-distance bug (previously reported 15.7mm on an identical shape). ---
cand_moved = ref.copy()
cand_moved.apply_translation([0.05, 0.02, -0.01])
cand_moved.apply_transform(trimesh.transformations.rotation_matrix(0.3, [0, 0, 1]))
r2 = verify_against_reference(cand_moved, ref, tolerance_mm=2.0,
                               candidate_calibrated=True, reference_calibrated=True)
check('offset+rotated identical shape: pass=True after ICP', r2.get('pass') is True, r2)
check('offset+rotated identical shape: mean_deviation < 1.0mm (surface distance, not vertex distance)',
      r2.get('mean_deviation', 999) < 1.0, r2)

# --- TEST 3: candidate genuinely 20% oversized — must FAIL. This is the
# case that exposed the ICP scale=True bug (previously silently rescaled
# the candidate to fit and reported a near-perfect match). ---
cand_oversized = trimesh.creation.box(extents=[0.12, 0.12, 0.12])  # 120mm vs 100mm ref
r3 = verify_against_reference(cand_oversized, ref, tolerance_mm=2.0,
                               candidate_calibrated=True, reference_calibrated=True)
check('20% oversized cube: pass=False (scale must not be silently corrected by ICP)',
      r3.get('pass') is False, r3)
check('20% oversized cube: mean_deviation > 10mm (a real, reported defect, not hidden)',
      r3.get('mean_deviation', 0) > 10, r3)

# --- TEST 4: uncalibrated candidate — dimensionally_trustworthy must be
# False regardless of geometric fit, and pass must be None (not True/False,
# since a pass/fail claim with no real-world scale would be meaningless). ---
r4 = verify_against_reference(ref.copy(), ref, tolerance_mm=2.0,
                               candidate_calibrated=False, reference_calibrated=True)
check('uncalibrated candidate: dimensionally_trustworthy=False', r4.get('dimensionally_trustworthy') is False, r4)
check('uncalibrated candidate: pass=None (not a real pass/fail claim)', r4.get('pass') is None, r4)

# --- TEST 5: empty mesh — graceful error dict, not a crash ---
empty = trimesh.Trimesh(vertices=[], faces=[])
r5 = verify_against_reference(empty, ref)
check('empty mesh: returns error dict, does not crash', r5.get('error') == 'empty_mesh', r5)

print(f'\n{pass_count} passed, {fail_count} failed')
sys.exit(1 if fail_count else 0)
