"""
Tests for _build_physics_chunk() in engine-next/reconstruction/pipeline.py —
turns a real (calibrated, watertight) mesh volume into a physically-plausible
mass estimate instead of the permanently-empty {'bodies': [], 'constraints': []}
this used to hardcode unconditionally.

Extracts just the density tables + _build_physics_chunk from pipeline.py's
source rather than importing the module directly, since pipeline.py imports
torch/PIL/boto3 at module scope for the GPU reconstruction code this
function doesn't touch — no need for that dependency chain to unit-test a
pure-Python helper.

Run directly: python3 tests/physics.test.py
"""
import sys
from pathlib import Path

_PIPELINE_PATH = Path(__file__).resolve().parent.parent / 'reconstruction' / 'pipeline.py'
_src = _PIPELINE_PATH.read_text()
_start = _src.index('VERTICAL_DENSITY_KG_M3 = {')
_end = _src.index('def _compress(data: bytes)')
_ns = {}
exec(_src[_start:_end], _ns)

_build_physics_chunk = _ns['_build_physics_chunk']
VERTICAL_DENSITY_KG_M3 = _ns['VERTICAL_DENSITY_KG_M3']
DEFAULT_DENSITY_KG_M3 = _ns['DEFAULT_DENSITY_KG_M3']

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


# --- TEST 1: no mesh at all — same honest empty chunk as before this change ---
r1 = _build_physics_chunk(None, 'product', {'confidence': 'none'}, {})
check('no mesh: empty bodies list, unchanged behavior', r1 == {'bodies': [], 'constraints': []}, r1)

# --- TEST 2: watertight + calibrated — real mass = volume x density ---
# 0.002 m^3 is a real, independently-computed trimesh.volume() result for a
# comparable box (verified separately: trimesh.creation.box gives exact
# volumes for known extents), not an arbitrary made-up number.
mesh_info_solid = {'volume_m3': 0.002, 'is_watertight': True, 'n_verts': 500, 'n_faces': 900}
calib_high = {'confidence': 'high'}
r2 = _build_physics_chunk(mesh_info_solid, 'product', calib_high, {})
expected_mass = round(0.002 * VERTICAL_DENSITY_KG_M3['product'], 4)
check('watertight+calibrated: mass = volume * density', r2['bodies'][0]['mass'] == expected_mass, r2['bodies'][0])
check('watertight+calibrated: labeled geometry_volume_x_density_heuristic (not "measured")',
      r2['bodies'][0]['mass_estimation_method'] == 'geometry_volume_x_density_heuristic', r2['bodies'][0])

# --- TEST 3: not watertight — volume can't be trusted, must NOT produce a
# fake-precise number. This is the case that would otherwise silently claim
# false precision on every noisy/incomplete reconstruction. ---
mesh_info_open = {'volume_m3': None, 'is_watertight': False, 'n_verts': 500, 'n_faces': 900}
r3 = _build_physics_chunk(mesh_info_open, 'product', calib_high, {})
check('non-watertight: falls back to flagged placeholder mass', r3['bodies'][0]['mass'] == 1.0, r3['bodies'][0])
check('non-watertight: method explicitly flagged as placeholder',
      r3['bodies'][0]['mass_estimation_method'] == 'placeholder_uncalibrated', r3['bodies'][0])

# --- TEST 4: watertight but uncalibrated — volume is in reconstruction-space
# units, not real m^3, so a "kg" mass would be pure fiction. Must also fall
# back, even though the mesh geometry itself is fine. ---
r4 = _build_physics_chunk(mesh_info_solid, 'product', {'confidence': 'none'}, {})
check('watertight but uncalibrated: still falls back (volume units untrustworthy)',
      r4['bodies'][0]['mass'] == 1.0, r4['bodies'][0])

# --- TEST 5: architecture — a building/scene isn't a graspable "object";
# mass estimation should be explicitly skipped, not produce a multi-tonne
# nonsense figure. ---
r5 = _build_physics_chunk(mesh_info_solid, 'architecture', calib_high, {})
check('architecture vertical: mass=None, not_applicable (not a fake building mass)',
      r5['bodies'][0]['mass'] is None and r5['bodies'][0]['mass_estimation_method'] == 'not_applicable',
      r5['bodies'][0])

# --- TEST 6: unknown/unlisted vertical — must fall back to the documented
# default density rather than crashing on a missing dict key. ---
r6 = _build_physics_chunk(mesh_info_solid, 'totally_unknown_vertical', calib_high, {})
expected_default = round(0.002 * DEFAULT_DENSITY_KG_M3, 4)
check('unknown vertical: falls back to DEFAULT_DENSITY_KG_M3, does not crash',
      r6['bodies'][0]['mass'] == expected_default, r6['bodies'][0])

# --- TEST 7: collision shape always references the mesh chunk, matching
# NIFPhysics.js's schema ('box'|'sphere'|'mesh') and the actual geometry
# this pipeline extracts (not a bounding-box approximation). ---
check('collisionShape is "mesh" (uses real extracted geometry, not a box approximation)',
      r2['bodies'][0]['collisionShape'] == 'mesh', r2['bodies'][0])

print(f'\n{pass_count} passed, {fail_count} failed')
sys.exit(1 if fail_count else 0)
