#!/usr/bin/env python3
"""Preflight a textured GLB before an optional FUMOCA mesh-to-splat experiment.

This script deliberately does NOT run Mesh2Splat. The upstream application currently
starts an interactive OpenGL/GLFW desktop window and has no documented CLI contract.
Run this on Kaggle before building a separate headless converter adapter.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def inspect_glb(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(f"Input GLB does not exist: {path}")
    if path.suffix.lower() != ".glb":
        raise ValueError("Mesh2Splat currently documents GLB input only.")
    if path.stat().st_size < 20:
        raise ValueError("Input file is too small to be a valid GLB.")
    with path.open("rb") as handle:
        header = handle.read(12)
    magic, version, declared_length = (
        header[:4], int.from_bytes(header[4:8], "little"),
        int.from_bytes(header[8:12], "little")
    )
    if magic != b"glTF":
        raise ValueError("Invalid GLB magic; expected 'glTF'.")
    if version != 2:
        raise ValueError(f"Unsupported GLB version {version}; expected 2.")
    if declared_length != path.stat().st_size:
        raise ValueError(
            f"GLB declared length ({declared_length}) does not match file size "
            f"({path.stat().st_size})."
        )

    try:
        import numpy as np
        import trimesh
    except ImportError as exc:
        raise RuntimeError(
            "Missing QA dependencies. Install with: pip install trimesh numpy"
        ) from exc

    loaded = trimesh.load(path, force="scene", process=False)
    if isinstance(loaded, trimesh.Trimesh):
        scene = trimesh.Scene(loaded)
    else:
        scene = loaded

    mesh_rows = []
    total_vertices = total_faces = 0
    textured_materials = 0
    material_count = 0
    all_bounds = []
    for name, geometry in scene.geometry.items():
        if not isinstance(geometry, trimesh.Trimesh):
            continue
        vertices = np.asarray(geometry.vertices)
        faces = np.asarray(geometry.faces)
        if vertices.ndim != 2 or vertices.shape[1] != 3 or not len(vertices):
            raise ValueError(f"Geometry '{name}' has no valid 3D vertices.")
        if not np.isfinite(vertices).all():
            raise ValueError(f"Geometry '{name}' contains NaN/Inf coordinates.")
        if faces.ndim != 2 or faces.shape[1] != 3 or not len(faces):
            raise ValueError(f"Geometry '{name}' has no triangle faces.")
        if faces.min() < 0 or faces.max() >= len(vertices):
            raise ValueError(f"Geometry '{name}' contains out-of-range face indices.")
        bounds = np.asarray(geometry.bounds, dtype=float)
        if bounds.shape != (2, 3) or not np.isfinite(bounds).all():
            raise ValueError(f"Geometry '{name}' has invalid bounds.")
        extents = (bounds[1] - bounds[0]).tolist()
        material = getattr(getattr(geometry, "visual", None), "material", None)
        has_texture = bool(
            material is not None and (
                getattr(material, "baseColorTexture", None) is not None
                or getattr(material, "metallicRoughnessTexture", None) is not None
                or getattr(material, "normalTexture", None) is not None
                or getattr(material, "image", None) is not None
            )
        )
        if material is not None:
            material_count += 1
        if has_texture:
            textured_materials += 1
        total_vertices += len(vertices)
        total_faces += len(faces)
        all_bounds.append(bounds)
        mesh_rows.append({
            "name": str(name),
            "vertices": int(len(vertices)),
            "triangles": int(len(faces)),
            "bounds": bounds.tolist(),
            "extents_scene_units": extents,
            "watertight": bool(geometry.is_watertight),
            "has_texture": has_texture,
            "material_type": type(material).__name__ if material is not None else None,
        })

    if not mesh_rows:
        raise ValueError("No triangle mesh geometry found in the GLB.")
    if not total_faces:
        raise ValueError("GLB contains zero triangle faces.")

    stacked_bounds = np.stack(all_bounds, axis=0)  # (mesh_count, min/max, xyz)
    overall_bounds = [
        stacked_bounds[:, 0, :].min(axis=0).tolist(),
        stacked_bounds[:, 1, :].max(axis=0).tolist(),
    ]
    return {
        "schema": "fumoca.mesh2splat.preflight.v1",
        "status": "preflight_passed_conversion_not_run",
        "input": {
            "path": str(path.resolve()),
            "file_size_bytes": path.stat().st_size,
            "glb_version": version,
            "declared_length_bytes": declared_length,
        },
        "geometry": {
            "mesh_count": len(mesh_rows),
            "vertices": total_vertices,
            "triangles": total_faces,
            "bounds": overall_bounds,
            "extents_scene_units": (np.asarray(overall_bounds[1]) - np.asarray(overall_bounds[0])).tolist(),
            "meshes": mesh_rows,
        },
        "materials": {
            "material_count": material_count,
            "materials_with_detected_texture_maps": textured_materials,
            "texture_presence_is_not_a_guarantee_of_visual_fidelity": True,
        },
        "gates": {
            "glb_binary_header_valid": True,
            "finite_vertices": True,
            "triangle_mesh_present": True,
            "texture_maps_detected": textured_materials > 0,
            "metric_scale_verified": False,
            "mesh2splat_conversion_run": False,
            "viewer_compatibility_verified": False,
        },
        "next_steps": [
            "Review mesh bounds and texture/material report.",
            "Confirm physical scale independently if dimensions matter.",
            "Build and test a headless Mesh2Splat adapter; upstream main.cpp starts a GLFW window.",
            "Validate the actual converter output format and render it in FUMOCA before publishing.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", type=Path, help="Path to a textured GLB file")
    parser.add_argument("--report", type=Path, help="Optional JSON report output path")
    args = parser.parse_args()
    try:
        report = inspect_glb(args.glb)
    except Exception as exc:
        error = {
            "schema": "fumoca.mesh2splat.preflight.v1",
            "status": "preflight_failed",
            "error": str(exc),
            "conversion_run": False,
        }
        rendered = json.dumps(error, indent=2)
        print(rendered, file=sys.stderr)
        if args.report:
            args.report.write_text(rendered + "\n", encoding="utf-8")
        return 2

    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
