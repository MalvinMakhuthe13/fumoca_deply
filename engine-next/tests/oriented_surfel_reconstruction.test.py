"""
Regression tests for the oriented Gaussian-surfel normal and confidence path.
Run: python3 engine-next/tests/oriented_surfel_reconstruction.test.py

The helper is extracted from pipeline.py so these tests do not import the
worker's GPU/cloud dependencies. Requires numpy and scipy.
"""
import sys
import ast
from pathlib import Path
import numpy as np

pipeline = Path(__file__).resolve().parents[1] / 'reconstruction' / 'pipeline.py'
source = pipeline.read_text()
start = source.index('def _orient_normals_consistently(')
end = source.index('\n\nclass ReconstructionWorker:', start)
namespace = {'np': np}
exec(source[start:end], namespace)
orient = namespace['_orient_normals_consistently']

passed = 0
failed = 0


def check(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        print('PASS:', name)
    else:
        failed += 1
        print('FAIL:', name, detail)


# Two spatially separated planar patches, with every second normal reversed.
plane = np.array([[x * 0.1, y * 0.1, 0.0]
                  for x in range(4) for y in range(4)], dtype=float)
other = np.array([[5.0 + x * 0.1, y * 0.1, 0.0]
                  for x in range(4) for y in range(4)], dtype=float)
positions = np.vstack([plane, other])
normals = np.tile([0.0, 0.0, 1.0], (len(positions), 1))
normals[::2] *= -1
oriented, labels, info = orient(positions, normals, neighbors=6)

# Local sign consistency: all points in each planar patch must align.
for component in np.unique(labels):
    group = oriented[labels == component]
    mean_normal = group.mean(axis=0)
    agreement = np.abs(group @ (mean_normal / np.linalg.norm(mean_normal)))
    check(f'component {component}: local normal signs are consistent',
          bool(np.all(agreement > 0.99)), agreement.min())

check('spatially separated patches remain separate normal components',
      len(np.unique(labels)) == 2, np.unique(labels))
check('diagnostics report all input points',
      info['oriented_points'] == len(positions), info)

# A single point and an empty input are valid edge cases.
single_n, single_labels, single_info = orient(
    np.array([[1.0, 2.0, 3.0]]), np.array([[0.0, 0.0, -2.0]]))
check('single point is normalized and assigned a component',
      np.allclose(single_n, [[0.0, 0.0, -1.0]]) and single_labels.tolist() == [0],
      (single_n, single_labels))
empty_n, empty_labels, empty_info = orient(np.empty((0, 3)), np.empty((0, 3)))
check('empty input returns empty arrays without error',
      empty_n.shape == (0, 3) and empty_labels.shape == (0,),
      (empty_n.shape, empty_labels.shape))


# Confidence-weighted TSDF must not invent a field in unsupported space.
fuse = namespace['_confidence_weighted_tsdf']
surf = np.array([[x * 0.1, y * 0.1, 0.0]
                 for x in range(5) for y in range(5)], dtype=float)
surf_normals = np.tile([0.0, 0.0, 1.0], (len(surf), 1))
surf_components = np.zeros(len(surf), dtype=np.int32)
surf_confidence = np.ones(len(surf), dtype=float)
queries = np.array([[0.2, 0.2, 0.0], [0.2, 0.2, 4.0]], dtype=float)
field, observed, support = fuse(
    queries, surf, surf_normals, surf_components, surf_confidence, 0.1
)
check('near-surface voxels receive TSDF support',
      bool(observed[0]) and abs(float(field[0])) < 1e-8,
      (field, observed, support))
check('unsupported distant voxels remain masked',
      not bool(observed[1]), (field, observed, support))

# Two close parallel sheets must not average into a false middle surface.
lower = np.array([[x * 0.1, y * 0.1, 0.0]
                  for x in range(5) for y in range(5)], dtype=float)
upper = lower.copy()
upper[:, 2] = 0.5
two_sheets = np.vstack([lower, upper])
two_normals = np.tile([0.0, 0.0, 1.0], (len(two_sheets), 1))
two_components = np.r_[np.zeros(len(lower), dtype=np.int32),
                       np.ones(len(upper), dtype=np.int32)]
two_confidence = np.ones(len(two_sheets), dtype=float)
middle_query = np.array([[0.2, 0.2, 0.2]], dtype=float)
middle_field, middle_mask, _ = fuse(
    middle_query, two_sheets, two_normals, two_components, two_confidence, 0.1
)
check('nearest component controls signed distance between separate sheets',
      bool(middle_mask[0]) and abs(float(middle_field[0]) - 0.2) < 1e-6,
      (middle_field, middle_mask))


# A one-surfel scene must have a finite, local support radius. It must not
# turn infinity (the missing second-neighbour distance) into global support.
single_field, single_mask, single_support = fuse(
    np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 10.0]]),
    np.array([[0.0, 0.0, 0.0]]),
    np.array([[0.0, 0.0, 1.0]]),
    np.array([0], dtype=np.int32),
    np.array([1.0]),
    0.1,
)
check('single surfel supports only a finite local band',
      bool(single_mask[0]) and not bool(single_mask[1])
      and np.isfinite(single_field).all()
      and single_support['coverage_ratio'] == 0.5,
      (single_field, single_mask, single_support))

empty_rejected = False
try:
    fuse(np.zeros((1, 3)), np.empty((0, 3)), np.empty((0, 3)),
         np.empty((0,), dtype=np.int32), np.empty((0,)), 0.1)
except ValueError:
    empty_rejected = True
check('empty surfel input fails clearly instead of indexing invalid neighbors',
      empty_rejected)


# Gaussian tangent scales must constrain support anisotropically. A narrow
# tangent axis must not inherit the broad radius of the other tangent axis.
anisotropic_field, anisotropic_mask, anisotropic_stats = fuse(
    np.array([[0.01, 0.0, 0.0], [0.10, 0.0, 0.0]], dtype=float),
    np.array([[0.0, 0.0, 0.0]], dtype=float),
    np.array([[0.0, 0.0, 1.0]], dtype=float),
    np.array([0], dtype=np.int32),
    np.array([1.0], dtype=float),
    0.1,
    tangent_axes=np.array([[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]]),
    tangent_scales=np.array([[0.02, 0.20]], dtype=float),
)
check('anisotropic tangent footprint accepts samples along its narrow axis',
      bool(anisotropic_mask[0]) and not bool(anisotropic_mask[1]),
      (anisotropic_field, anisotropic_mask, anisotropic_stats))

bad_axes_rejected = False
try:
    fuse(np.zeros((1, 3)), np.zeros((1, 3)), np.array([[0.0, 0.0, 1.0]]),
         np.array([0], dtype=np.int32), np.array([1.0]), 0.1,
         tangent_axes=np.zeros((1, 2, 3)), tangent_scales=np.ones((1, 2)))
except ValueError:
    bad_axes_rejected = True
check('degenerate Gaussian tangent axes are rejected', bad_axes_rejected)


# A large lower horizontal mesh component is only flagged as a support
# candidate. Its geometry is retained; vertical planes are not mislabeled.
class MeshFixture:
    def __init__(self, vertices, faces):
        self.vertices = np.asarray(vertices, dtype=float)
        self.faces = np.asarray(faces, dtype=np.int32)

classify_surface = namespace['_classify_mesh_surface_role']
plane_vertices = np.array([[x * 0.1, 0.0, z * 0.1]
                           for x in range(5) for z in range(5)], dtype=float)
plane_faces = []
for x in range(4):
    for z in range(4):
        a = x * 5 + z
        plane_faces.extend([[a, a + 1, a + 5], [a + 1, a + 6, a + 5]])
plane_role = classify_surface(MeshFixture(plane_vertices, plane_faces), 0.0, 1.0, 50)
check('large lower horizontal component is flagged as support candidate',
      plane_role['role_candidate'] == 'support_surface'
      and plane_role['support_plane_confidence'] > 0.5,
      plane_role)

vertical_vertices = np.array([[0.0, y * 0.1, z * 0.1]
                               for y in range(5) for z in range(5)], dtype=float)
vertical_role = classify_surface(MeshFixture(vertical_vertices, plane_faces), 0.0, 1.0, 50)
check('vertical planar wall is not mislabeled as a horizontal support plane',
      vertical_role['role_candidate'] == 'surface'
      and vertical_role['support_plane_confidence'] == 0.0,
      vertical_role)


# Chunked fusion must be numerically identical to a single larger batch.
batch_queries = np.array([[0.01, 0.0, 0.0], [0.10, 0.0, 0.0],
                          [0.0, 0.0, 0.02], [0.0, 0.0, 2.0]], dtype=float)
batch_args = (
    np.array([[0.0, 0.0, 0.0]], dtype=float),
    np.array([[0.0, 0.0, 1.0]], dtype=float),
    np.array([0], dtype=np.int32),
    np.array([1.0], dtype=float),
    0.1,
)
large_field, large_mask, _ = fuse(
    batch_queries, *batch_args,
    tangent_axes=np.array([[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]]),
    tangent_scales=np.array([[0.02, 0.20]], dtype=float),
    batch_size=100,
)
small_field, small_mask, small_stats = fuse(
    batch_queries, *batch_args,
    tangent_axes=np.array([[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]]),
    tangent_scales=np.array([[0.02, 0.20]], dtype=float),
    batch_size=1,
)
check('chunked TSDF fusion matches large-batch results',
      np.allclose(large_field, small_field) and np.array_equal(large_mask, small_mask)
      and small_stats['fusion_batches'] == len(batch_queries),
      (large_field, small_field, large_mask, small_mask, small_stats))


# A small convex boundary may be repaired only when confident surfels cover
# its interior and agree with the candidate cap normal.
evaluate_loop = namespace['_evaluate_supported_boundary_loop']
square_loop = np.array([
    [-1.0, 0.0, -1.0], [1.0, 0.0, -1.0],
    [1.0, 0.0, 1.0], [-1.0, 0.0, 1.0],
], dtype=float)
interior_support = np.array([[x * 0.1, 0.0, z * 0.1]
                             for x in range(-10, 11) for z in range(-10, 11)], dtype=float)
interior_normals = np.tile([0.0, 1.0, 0.0], (len(interior_support), 1))
interior_confidence = np.ones(len(interior_support), dtype=float)
supported_repair = evaluate_loop(
    square_loop, interior_support, interior_normals, interior_confidence, 0.2
)
check('supported convex boundary loop qualifies for conservative repair',
      supported_repair['supported'] and supported_repair['coverage'] >= 0.8,
      supported_repair)

rim_only = square_loop.copy()
rim_only[:, 1] = 0.0
rim_normals = np.tile([0.0, 1.0, 0.0], (len(rim_only), 1))
unsupported_repair = evaluate_loop(
    square_loop, rim_only, rim_normals, np.ones(len(rim_only)), 0.2
)
check('a genuine opening with evidence only at its rim remains open',
      not unsupported_repair['supported']
      and unsupported_repair['reason'] == 'insufficient_interior_evidence',
      unsupported_repair)


# Boundary traversal returns closed unbranched loops only.
class EdgeFixture:
    def __init__(self, edges):
        self.edges_sorted = np.asarray(edges, dtype=np.int32)

find_loops = namespace['_boundary_edge_loops']
closed_loop = find_loops(EdgeFixture([[0, 1], [1, 2], [2, 3], [3, 0]]))
check('closed boundary edge cycle is found as one loop',
      len(closed_loop) == 1 and len(closed_loop[0]) == 4,
      closed_loop)
branched_loop = find_loops(EdgeFixture([[0, 1], [1, 2], [1, 3], [3, 0]]))
check('branched boundary graph is not treated as a repairable loop',
      len(branched_loop) == 0,
      branched_loop)


# Every _extract_mesh return path must preserve the four-value contract used
# by both ReconstructionWorker.run() and run_mesh_only().
module_ast = ast.parse(source)
worker_class = next(node for node in module_ast.body
                    if isinstance(node, ast.ClassDef) and node.name == 'ReconstructionWorker')
extract_method = next(node for node in worker_class.body
                      if isinstance(node, ast.FunctionDef) and node.name == '_extract_mesh')
return_shapes = []
for node in ast.walk(extract_method):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node is not extract_method:
        continue
    if isinstance(node, ast.Return):
        value = node.value
        return_shapes.append(len(value.elts) if isinstance(value, ast.Tuple) else 1)
check('all mesh extraction return paths preserve four-value caller contract',
      bool(return_shapes) and all(size == 4 for size in return_shapes),
      return_shapes)

# A lower horizontal candidate is not enough by itself: elevated horizontal
# surfaces and sloped support surfaces must remain ordinary scene geometry.
upper_vertices = plane_vertices.copy()
upper_vertices[:, 1] = 0.9
upper_role = classify_surface(MeshFixture(upper_vertices, plane_faces), 0.0, 1.0, 50)
check('elevated horizontal component is not labeled as support plane',
      upper_role['role_candidate'] == 'surface',
      upper_role)

sloped_vertices = plane_vertices.copy()
sloped_vertices[:, 1] = sloped_vertices[:, 0] * 0.5
sloped_role = classify_surface(MeshFixture(sloped_vertices, plane_faces), 0.0, 1.0, 50)
check('sloped lower component is not labeled as horizontal support plane',
      sloped_role['role_candidate'] == 'surface',
      sloped_role)


# Support-plane suggestions are non-destructive and require a broad lower
# horizontal band with Gaussian normals aligned to world up.
detect_support = namespace['_detect_support_plane_candidate']
platform = np.array([[x * 0.1, 0.0, z * 0.1]
                     for x in range(21) for z in range(21)], dtype=float)
object_points = np.array([[0.4 + x * 0.02, 0.2 + y * 0.04, 0.4 + z * 0.02]
                          for x in range(11) for y in range(11) for z in range(11)], dtype=float)
support_scene = np.vstack([platform, object_points])
support_normals = np.vstack([
    np.tile([0.0, 1.0, 0.0], (len(platform), 1)),
    np.tile([0.0, 0.0, 1.0], (len(object_points), 1)),
])
support_confidence = np.ones(len(support_scene), dtype=float)
support_suggestion = detect_support(support_scene, support_normals, support_confidence, 0.01)
check('broad lower horizontal platform produces a non-destructive split suggestion',
      support_suggestion['detected']
      and abs(support_suggestion['y']) < 1e-8
      and support_suggestion['confidence'] >= 0.5,
      support_suggestion)

wall_points = np.array([[0.0, y * 0.1, z * 0.1]
                        for y in range(21) for z in range(21)], dtype=float)
wall_suggestion = detect_support(
    wall_points, np.tile([1.0, 0.0, 0.0], (len(wall_points), 1)),
    np.ones(len(wall_points)), 0.01,
)
check('vertical wall does not produce a horizontal support-plane suggestion',
      not wall_suggestion['detected'], wall_suggestion)

sloped_points = platform.copy()
sloped_points[:, 1] = sloped_points[:, 0] * 0.5
sloped_normals = np.tile([-0.4472136, 0.8944272, 0.0], (len(sloped_points), 1))
sloped_suggestion = detect_support(
    sloped_points, sloped_normals, np.ones(len(sloped_points)), 0.01,
)
check('sloped lower surface does not produce a horizontal support-plane suggestion',
      not sloped_suggestion['detected'], sloped_suggestion)


# The primary NIF META payload must carry diagnostics and the proposed support
# plane so the public viewer and an offline downloaded NIF see the same context.
build_meta = namespace['_build_nif_meta_payload']
meta_diagnostics = {
    'n_connected_components': 2,
    'support_plane_candidate': {'detected': True, 'y': -0.125, 'confidence': 0.82},
    'mesh_components': [{'id': 'object-1'}, {'id': 'support-1'}],
}
meta_payload = build_meta(
    'test-user', 'generic', {'title': 'Full scene', 'hotspots': []},
    meta_diagnostics, created_at='2026-11-03T00:00:00Z',
)
check('primary NIF metadata embeds component diagnostics and support-plane suggestion',
      meta_payload['surface_reconstruction'] == 'oriented-gaussian-surfel-tsdf'
      and meta_payload['mesh_component_count'] == 2
      and meta_payload['mesh_diagnostics']['support_plane_candidate']['y'] == -0.125
      and meta_payload['author'] == 'test-user',
      meta_payload)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
