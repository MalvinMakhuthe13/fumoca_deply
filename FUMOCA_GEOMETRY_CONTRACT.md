# FUMOCA Geometry Contract

## Goal

FUMOCA is not a general-purpose Blender replacement. Its job is to turn a real product capture into a **clean commercial 3D asset** with two coordinated representations:

- **Solid geometry** for editing, collision, measurement, animation and printing.
- **Gaussian splatting** for photorealistic web presentation.

Both representations must share the same reconstruction coordinate system, scale calibration and subject bounds. The server applies calibration to the solid mesh, while the viewer applies the same calibration factor to Gaussian positions and Gaussian scales before rendering.

## Canonical production flow

`capture → frame selection → segmentation → COLMAP poses → Gaussian training → surface samples → screened Poisson mesh → validation/repair → calibrated solid → web splat + NIF`

The solid mesh is **not** produced by simply making the splat look denser.

## Why Poisson is the production default

The old fallback path projected Gaussian normals into a signed-distance grid and ran Marching Cubes. That is useful as a dependency-light fallback, but its sign assumption becomes unreliable on concave or disconnected product geometry.

FUMOCA now prefers an oriented surface point cloud followed by screened Poisson reconstruction. This is consistent with established Gaussian-to-mesh work such as SuGaR and with Open3D's documented surface-reconstruction pipeline.

## Quality gates

A production asset must distinguish:

1. **Reconstruction valid** — real multi-view pose estimation succeeded.
2. **Mesh valid** — a non-empty triangle mesh was extracted.
3. **Solid valid** — mesh is watertight/manifold after conservative repair.
4. **Scale verified** — real-world scale has sufficient calibration confidence.
5. **Web ready** — splat has bounded scene scale, sane density and a valid camera framing.

A visually attractive splat does not automatically qualify as a printable solid.

## Fallbacks

The existing Marching Cubes/TSDF implementation remains available when Open3D is unavailable or Poisson reconstruction fails validation. Fallback output must still pass the same mesh sanity checks.

## Product principle

Do not silently hand a client a broken mesh.

Do not use convex-hull repair as the normal repair path: it can destroy cavities and product details such as vehicle interiors, door gaps, handles and bottle openings.

Do not call a renderer effect "solidification". A solidification action must invoke the actual mesh workflow.

## Web representation

The web viewer should prefer the Gaussian representation for appearance, while the mesh remains available as the structural representation. Interactive features (doors, lids, hotspots, sounds, animations, product parts) should be authored against the structural representation and mapped to the visual splat.

## Browser versus production

The browser mesh extractor is intentionally a quick local preview/export tool. The production reconstruction worker is the authoritative path for client-quality solid geometry.
