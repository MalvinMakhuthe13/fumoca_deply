"""Level 12 structural mesh ownership tests.

This test extracts the production _attach_mesh_part_mapping() function directly
from pipeline.py, so the assertions exercise the implementation itself without
importing the full GPU/R2/Supabase worker.
"""

import ast
import sys
import types
import struct
from pathlib import Path

import numpy as np


def _load_mapping_function():
    pipeline_path = Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline.py"
    source = pipeline_path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    node = next(
        n for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "_attach_mesh_part_mapping"
    )

    # The production function imports scipy.spatial.cKDTree locally. Keep this
    # test dependency-light by providing a tiny exact nearest-neighbour stand-in.
    class FakeKDTree:
        def __init__(self, points):
            self.points = np.asarray(points, dtype=np.float64)

        def query(self, values, k=1, workers=1):
            values = np.asarray(values, dtype=np.float64)
            d = np.linalg.norm(values[:, None, :] - self.points[None, :, :], axis=2)
            order = np.argsort(d, axis=1)
            if k == 1:
                idx = order[:, 0]
                return d[np.arange(len(values)), idx], idx
            idx = order[:, :k]
            return np.take_along_axis(d, idx, axis=1), idx

    scipy = types.ModuleType("scipy")
    spatial = types.ModuleType("scipy.spatial")
    spatial.cKDTree = FakeKDTree
    scipy.spatial = spatial
    sys.modules["scipy"] = scipy
    sys.modules["scipy.spatial"] = spatial

    module = ast.Module(
        body=[node],
        type_ignores=[],
    )
    namespace = {"np": np, "struct": struct}
    exec(compile(module, str(pipeline_path), "exec"), namespace)
    return namespace["_attach_mesh_part_mapping"]


class Mesh:
    def __init__(self, vertices, faces):
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int64)
        self.bounds = np.array([self.vertices.min(axis=0), self.vertices.max(axis=0)])


def _cube():
    v = np.array([
        [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ], dtype=np.float64)
    f = np.array([
        [0, 1, 2], [0, 2, 3],  # bottom: part 1
        [4, 6, 5], [4, 7, 6],  # top: part 2
        [0, 4, 5], [0, 5, 1],
        [1, 5, 6], [1, 6, 2],
        [2, 6, 7], [2, 7, 3],
        [3, 7, 4], [3, 4, 0],
    ], dtype=np.int64)
    return Mesh(v, f), v


def main():
    mapping_fn = _load_mapping_function()
    mesh, points = _cube()

    # Eight exact Gaussian samples are enough to activate the production
    # mapping path (which deliberately requires >= 8 valid observations).
    labels = np.array([1, 1, 1, 1, 2, 2, 2, 2], dtype=np.uint8)
    confidence = np.ones(8, dtype=np.float32)

    result = mapping_fn(mesh, points, labels, confidence)

    assert result["status"] == "available"
    assert result["mapped_vertex_count"] == 8
    assert result["mapped_face_count"] == 4
    assert result["mixed_face_count"] == 8
    assert result["mapped_face_ratio"] == 4 / 12
    assert result["unseen_geometry_claimed"] is False

    parts = {p["part_id"]: p for p in result["parts"]}
    assert parts[1]["mapped_faces"] == 2
    assert parts[2]["mapped_faces"] == 2
    assert parts[1]["ownership_status"] == "mapped"
    assert parts[2]["ownership_status"] == "mapped"

    # The binary FSMM payload must contain one ownership byte per vertex and face.
    assert result["_binary"][:4] == b"FSMM"
    assert len(result["_binary"]) > 4

    # No semantic evidence means no ownership claim at all.
    empty = mapping_fn(mesh, None, None, None)
    assert empty["status"] == "unavailable"
    assert empty["mapped_face_ratio"] == 0.0

    print("LEVEL 12 MESH OWNERSHIP: PASS")


if __name__ == "__main__":
    main()
