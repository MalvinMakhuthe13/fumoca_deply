"""
NIF Product Verification — engine-next/reconstruction/verify.py
fumoca.co.za · © Fumoca Technologies

This did not exist anywhere in the codebase before this pass. "Product
verification" as a feature needs three things a capture-and-view pipeline
doesn't otherwise need: (1) a reference to compare against, (2) rigid
alignment between the candidate scan and that reference (they were never
captured from the same pose), and (3) a real geometric deviation measurement
with a pass/fail tolerance — not just "looks similar."

This module is intentionally standalone (pure functions, only trimesh/numpy/
scipy — the same dependencies pipeline.py already requires) so it can be:
  - called from pipeline.py's run() when a reference mesh is supplied
    (see CHUNK_VERIFY wiring in pipeline.py)
  - called offline/interactively for QA without spinning up a full
    reconstruction job
  - unit-tested on its own, the way format/NIFSpec.js and graph/NIFGraph.js
    already are per ROADMAP.md's Phase 1 — this has no test suite yet, and
    given the "evidentiary weight" framing product verification implies,
    it needs one before anyone relies on its output for a real decision.

IMPORTANT CAVEATS, stated up front rather than discovered later:
  - Alignment and deviation are only as trustworthy as the calibration on
    BOTH meshes. If the candidate NIF's CALIBRATION chunk shows confidence
    'none' or the reference mesh has no known real-world scale, every
    distance this module reports is shape-only, not dimensional — the
    report says so explicitly (see 'dimensionally_trustworthy' below).
  - ICP finds the best LOCAL alignment from an initial guess. For meshes
    that are already roughly aligned (same capture convention, similar
    up-axis) this converges reliably. For wildly different starting
    orientations it can converge to a wrong local minimum — this module
    does one axis-aligned bounding-box pre-alignment pass before ICP to
    reduce that risk, but does not do full global registration (e.g.
    RANSAC feature matching). Flagged as a known limitation, not silently
    assumed away.
"""

import numpy as np
import trimesh


def _run_icp(source_points, target, max_iterations, threshold=1e-8):
    """
    Thin wrapper around trimesh.registration.icp() that doesn't assume a
    fixed return arity, and locks down two Procrustes defaults that are
    wrong for product verification specifically:

      - scale=False: trimesh's icp()->procrustes() defaults to scale=True,
        meaning ICP will silently RESIZE the candidate to fit the reference
        before measuring deviation. For a "is this part the right size"
        check, that's not a minor inaccuracy — it actively hides the exact
        defect (wrong dimensions) this feature exists to catch. A 20%
        oversized part would ICP-shrink to a near-perfect match and get a
        false pass. Confirmed by direct test before this fix shipped.
      - reflection=False: defaults to True, meaning a mirror-image of a
        part (e.g. a left/right-handed component) can register as a match.
        Real manufactured parts are not interchangeable with their mirror
        image; verification should not treat them as equivalent.

    trimesh's icp() also returns a variable-length tuple depending on
    version — (matrix, cost) in some, (matrix, transformed, cost) in
    others. This always returns (matrix, cost).
    """
    result = trimesh.registration.icp(
        source_points, target, max_iterations=max_iterations, threshold=threshold,
        scale=False, reflection=False,
    )
    if len(result) == 2:
        matrix, cost = result
    elif len(result) == 3:
        matrix, _transformed, cost = result
    else:
        raise ValueError(f'Unexpected trimesh.registration.icp() return arity: {len(result)}')
    return matrix, cost


def _bbox_prealign(candidate: trimesh.Trimesh, reference: trimesh.Trimesh) -> np.ndarray:
    """Coarse alignment: centroid-to-centroid translation, no rotation guess.
    Gives ICP a reasonable starting point instead of raw (0,0,0)-centered
    meshes that may be offset by metres."""
    t = reference.vertices.mean(axis=0) - candidate.vertices.mean(axis=0)
    T = np.eye(4)
    T[:3, 3] = t
    return T


def verify_against_reference(candidate_mesh: trimesh.Trimesh, reference_mesh: trimesh.Trimesh,
                              tolerance_mm: float = 2.0,
                              candidate_calibrated: bool = False,
                              reference_calibrated: bool = True,
                              max_icp_iterations: int = 100) -> dict:
    """
    Align candidate_mesh to reference_mesh and report per-vertex deviation.

    Both meshes are expected in metres if calibrated=True for that mesh.
    Deviation values are always reported in millimetres for readability,
    but 'dimensionally_trustworthy' tells the caller whether those numbers
    mean anything beyond relative shape comparison.

    Returns a JSON-serializable dict — this is what gets embedded as the
    CHUNK_VERIFY payload.
    """
    if len(candidate_mesh.vertices) == 0 or len(reference_mesh.vertices) == 0:
        return {
            'aligned': False, 'error': 'empty_mesh',
            'note': 'Candidate or reference mesh has no vertices — cannot verify.',
        }

    pre_T = _bbox_prealign(candidate_mesh, reference_mesh)
    candidate_pre = candidate_mesh.copy()
    candidate_pre.apply_transform(pre_T)

    try:
        icp_T, cost = _run_icp(candidate_pre.vertices, reference_mesh, max_icp_iterations)
        full_T = icp_T @ pre_T
        aligned_verts = trimesh.transform_points(candidate_mesh.vertices, full_T)
        icp_converged = True
    except Exception as e:
        # ICP against a Trimesh target can fail on degenerate/non-manifold
        # inputs — fall back to point-cloud ICP against the reference's
        # vertices directly, which is more forgiving but less accurate for
        # meshes with very uneven vertex density.
        try:
            icp_T, cost = _run_icp(candidate_pre.vertices, reference_mesh.vertices, max_icp_iterations)
            full_T = icp_T @ pre_T
            aligned_verts = trimesh.transform_points(candidate_mesh.vertices, full_T)
            icp_converged = True
        except Exception as e2:
            return {
                'aligned': False, 'error': f'icp_failed: {e2}',
                'note': f'ICP registration failed against both mesh surface and '
                        f'raw vertices ({e}, {e2}). Meshes may be too dissimilar '
                        f'for local ICP — needs a manual/global pre-alignment.',
            }

    # ── Per-vertex deviation: nearest point on the reference SURFACE, not
    # nearest reference VERTEX. This distinction matters a lot for low-poly
    # meshes: a candidate point sitting dead-center on a large flat face of
    # the reference can be tens of millimetres from the nearest vertex while
    # being ~0mm from the actual surface. Confirmed directly — an identical
    # cube compared to a rotated/translated copy of itself previously
    # reported 15.7mm mean deviation using nearest-vertex distance; the true
    # nearest-surface distance for that same case is ~0.008mm. Nearest-
    # vertex distance would make coarse meshes (which is most reconstructed
    # geometry) fail verification even when the shapes actually match.
    _closest_pts, dists, _tri_ids = reference_mesh.nearest.on_surface(aligned_verts)

    dimensionally_trustworthy = bool(candidate_calibrated and reference_calibrated)
    unit_scale_mm = 1000.0 if dimensionally_trustworthy else None

    dists_mm = dists * unit_scale_mm if unit_scale_mm else dists  # else: unitless shape distance
    rmse = float(np.sqrt(np.mean(dists_mm**2)))
    mean_dev = float(np.mean(dists_mm))
    max_dev = float(np.max(dists_mm))
    p95_dev = float(np.percentile(dists_mm, 95))
    pct_within = float(np.mean(dists_mm <= tolerance_mm) * 100) if dimensionally_trustworthy else None
    passed = bool(pct_within is not None and pct_within >= 98.0 and max_dev <= tolerance_mm * 5)

    return {
        'aligned': True,
        'icp_converged': icp_converged,
        'icp_cost': float(cost),
        'dimensionally_trustworthy': dimensionally_trustworthy,
        'units': 'millimeters' if dimensionally_trustworthy else 'unitless_shape_distance',
        'rmse': rmse,
        'mean_deviation': mean_dev,
        'max_deviation': max_dev,
        'p95_deviation': p95_dev,
        'tolerance_mm': tolerance_mm if dimensionally_trustworthy else None,
        'pct_vertices_within_tolerance': pct_within,
        'pass': passed if dimensionally_trustworthy else None,
        'n_vertices_compared': int(len(aligned_verts)),
        'note': (
            'Pass/fail and tolerance-relative stats are only meaningful when '
            'both meshes carry real calibration — set dimensionally_trustworthy '
            'accordingly upstream (read from each NIF\'s CALIBRATION chunk).'
            if not dimensionally_trustworthy else
            f'{pct_within:.1f}% of candidate vertices within {tolerance_mm}mm '
            f'of the reference surface after ICP alignment.'
        ),
    }


def verify_nif_meshes(candidate_mesh_bytes: bytes, reference_mesh_bytes: bytes,
                       reference_format: str = 'stl', tolerance_mm: float = 2.0,
                       candidate_calibrated: bool = False) -> dict:
    """
    Convenience wrapper for pipeline.py: takes the raw KEYFRAME_MESH chunk
    payload (as packed by pipeline.py's _extract_mesh — [format_flag:u8]
    then either raw struct [n_verts:u32][n_faces:u32] + big-endian float32
    positions + uint8 colors + big-endian uint32 faces, or a Draco buffer —
    see the docstring on _extract_mesh for the full layout) and a reference
    mesh file's raw bytes (STL/OBJ/glTF — whatever trimesh can load), and
    returns the same report as verify_against_reference().
    """
    import struct
    import io

    format_flag = candidate_mesh_bytes[0]
    if format_flag == 0x01:
        # Draco-encoded — this is now the default path, since pipeline.py
        # sets ENABLE_DRACO_MESH=True and writes flag 0x01 for every mesh
        # that encodes successfully (see _extract_mesh's DracoPy.encode()
        # call). This wrapper previously hard-refused that case entirely,
        # which meant verify_nif_meshes() couldn't check ANY real capture
        # produced by this build — only the raw-struct fallback path (0x00),
        # which only fires when Draco encoding itself throws.
        #
        # Mirrors the encode call exactly: DracoPy.encode(vertices, faces,
        # colors=..., quantization_bits=14, compression_level=7). Decode
        # only needs positions + faces for geometry comparison; colors are
        # skipped below the same way the raw-struct branch already skips
        # them.
        #
        # CAVEAT: written against DracoPy's documented decode() API but not
        # executed against a real Draco buffer in this environment (no
        # network access here to install DracoPy/exercise it) — same
        # unverified-round-trip caveat pipeline.py's encode side already
        # flags for the browser/wasm decoder. Test against one real encoded
        # mesh before relying on this for pass/fail verification.
        try:
            import DracoPy
        except ImportError as e:
            raise RuntimeError(
                'Candidate mesh is Draco-encoded (format_flag=0x01) but the '
                'DracoPy package is not installed in this environment — '
                'pip install DracoPy to verify Draco-encoded meshes.'
            ) from e

        draco_buffer = bytes(candidate_mesh_bytes[1:])
        decoded = DracoPy.decode(draco_buffer)

        pos = np.asarray(decoded.points, dtype=np.float64)
        if pos.ndim == 1:
            pos = pos.reshape(-1, 3)
        faces = np.asarray(decoded.faces)
        if faces.ndim == 1:
            faces = faces.reshape(-1, 3)

        candidate_mesh = trimesh.Trimesh(vertices=pos, faces=faces, process=False)
    else:
        n_verts, n_faces = struct.unpack('>II', candidate_mesh_bytes[1:9])
        offset = 9
        pos = np.frombuffer(candidate_mesh_bytes, dtype='>f4', count=n_verts*3,
                             offset=offset).reshape(n_verts, 3).astype(np.float64)
        offset += n_verts * 12
        offset += n_verts * 3  # skip vertex colors (uint8 rgb) — not needed for geometry compare
        faces = np.frombuffer(candidate_mesh_bytes, dtype='>u4', count=n_faces*3,
                               offset=offset).reshape(n_faces, 3)
        candidate_mesh = trimesh.Trimesh(vertices=pos, faces=faces, process=False)

    reference_mesh = trimesh.load(io.BytesIO(reference_mesh_bytes), file_type=reference_format)
    if isinstance(reference_mesh, trimesh.Scene):
        reference_mesh = trimesh.util.concatenate(
            [g for g in reference_mesh.geometry.values()])

    return verify_against_reference(
        candidate_mesh, reference_mesh, tolerance_mm=tolerance_mm,
        candidate_calibrated=candidate_calibrated, reference_calibrated=True,
    )
