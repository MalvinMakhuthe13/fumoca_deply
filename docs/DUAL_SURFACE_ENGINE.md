# FUMOCA Dual Surface Engine

## Purpose

A FUMOCA scene retains two independent, co-registered representations:

1. **Gaussian layer** — the original photorealistic anisotropic Gaussian scene. This remains the visual source of truth and is never replaced by mesh extraction.
2. **Solid surface layer** — a triangle mesh reconstructed from the live Gaussian data. It is used for surface inspection, editing/repair, conventional geometry interchange, and print preparation.

The two layers are stored independently in NIF: KEYFRAME_GEO (Gaussian data) and KEYFRAME_MESH (triangle mesh). A NIF round-trip must preserve both layers and their coordinate values.

## Current implementation map

| Responsibility | Existing implementation |
|---|---|
| Browser Gaussian-to-density conversion | `js/modules/fumoc-mesh-extractor.js` |
| Browser isosurface extraction | `js/modules/fumoc-mesh-extractor.js` (Marching Cubes) |
| Browser mesh repair / validation / export | `js/modules/fumoc-mesh-extractor.js` |
| Studio extraction, preview and print controls | `js/modules/studio-mesh-print.js` |
| NIF Gaussian + mesh serialization | `js/modules/nif-format.js` |
| Scene mesh preview | `edit.html` — `window.previewSolidMesh` |
| Reconstruction-worker mesh extraction | `engine-next/reconstruction/pipeline.py` |
| Print-oriented density extraction and post-processing | `engine-next/print/NIFPrintPipeline.py` |

## Hybrid display contract

- Extracting a mesh must not disable, replace, rewrite, or discard the Gaussian layer.
- The mesh and Gaussian layer have independent visibility controls.
- Hybrid mode means both are visible in the same scene coordinate frame.
- Mesh opacity is adjustable so the Gaussian surface can be inspected through the reconstructed surface.
- An opacity of 1 uses an opaque, depth-writing mesh. Lower opacity enables transparent blending and disables mesh depth writes to reduce the mesh hiding the source splat.
- STL scaling is export-only. It must never mutate the scene mesh or the source Gaussian coordinates.
- Mesh repair changes only the mesh layer. It must not rewrite Gaussian attributes.

## Reconstruction behaviour and honest limits

The browser extractor builds an anisotropic Gaussian density field and extracts an isosurface. The production worker has a separate oriented-Gaussian reconstruction path. These are derived surfaces, not proof that every point of the physical object was observed.

- A watertight mesh is a topology result, not proof of dimensional accuracy.
- Metric dimensions require a valid calibration record.
- A scan cannot reliably reconstruct hidden surfaces, deep occlusions, or fine details absent from the capture.
- Closing every hole is not always correct: wheel wells, windows, undercuts, handles, and gaps between separate parts may be intentional openings.
- Mesh and splat are co-registered at extraction time. Any later destructive edit or transform to only one representation makes the pair stale; downstream save/publish paths must preserve or regenerate the pair rather than silently presenting them as synchronized.
- Surface smoothing, hole filling, component removal and decimation are mesh-only operations and must remain non-destructive to the Gaussian layer.

## Validation

The smoke test encodes a small synthetic scene with both Gaussian and mesh layers into NIF, decodes it, and checks that both layers and their geometry survive independently. The workflow also checks JavaScript syntax and Python reconstruction-worker syntax.

A passing smoke test does not replace a real capture test. Production readiness still requires a real PLY/NIF scan, visual inspection in Studio and the public viewer, geometry comparison, and a calibrated dimension check before print accuracy is claimed.
