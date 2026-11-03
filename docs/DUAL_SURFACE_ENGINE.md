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
- Studio records a deterministic source signature when the mesh is loaded or extracted. NIF export and combined scene save fail closed if Gaussian positions, alive mask, scales, rotations, opacity, or source/paint colours have changed since extraction. Re-extract the mesh to restore a verified pair.

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


## Gaussian surface reconstruction v2 work

The follow-up reconstruction branch improves two mathematical inputs to the
surface field without changing the dual-representation product contract:

- Source quaternions are normalized before rotating sample offsets into each
  Gaussian's local covariance frame. Non-unit quaternions must not distort the
  reconstructed ellipsoid.
- Automatic isosurface selection now uses a bounded quantile of occupied
  density voxels, clamped to 12–38% of peak density. This avoids the previous
  histogram-gradient heuristic selecting a low-density tail and producing an
  excessively inflated shell.

These are targeted reconstruction-quality corrections, not a claim that the
density-field method now reproduces every physical surface. The result still
requires visual comparison on real scans at several threshold values and
resolutions. The original Gaussian layer remains untouched.


### Renderer-aligned Gaussian covariance

The reconstruction density evaluates offsets in Gaussian-local coordinates using
the inverse of the normalized source quaternion. This matches the renderer's
world covariance convention (R * diag(scale²) * Rᵀ). Applying the forward
quaternion to world offsets would mirror general 3D orientations and make the
extracted mesh disagree with the visible Gaussian ellipsoids. A regression test
uses a non-axis-aligned 3D quaternion and verifies that the density's major axis
follows the renderer orientation.


## Local density continuity regularization

The density field now uses a directionally constrained cavity-bridging pass
before automatic thresholding and Marching Cubes. A candidate low-density voxel
is filled only when it has support from at least three independent opposing
neighbour directions, and the paired support values are sufficiently similar.
A lone opposing pair is deliberately insufficient, reducing the risk of
bridging two nearby but separate sheets. The operation is non-destructive and
reports the number of voxels it changed. The Studio control exposes 0–3 passes.

This is a conservative local continuity repair, not semantic segmentation,
normal-aware reconstruction, or recovery of unobserved geometry. It is
specifically intended for small enclosed density cavities. Larger open seams,
thin structures, and missing scan regions still require better capture coverage
or a dedicated reconstruction/repair operation. Regression tests cover
enclosed-cavity bridging, rejection of a simple two-sheet gap, constant-field
preservation, pass bounds, and source immutability.

A second continuity safeguard removes tiny disconnected triangle islands during
normal extraction using the Studio's `Remove islands smaller than` face cutoff
(default 32). The largest component is always retained. This only removes
small detached fragments; it does not fuse separated major shells or perform
object-aware segmentation. The cutoff can be set to zero to retain all islands.


## Depth-aware Studio object selection

Studio lasso and box selection now use a screen-space depth pass. For each
small screen cell, the selector records the nearest live Gaussian centre and
only adds points close to that visible depth. This prevents most points on a
support plane or background behind the visible object from being selected
through the front surface. Selection is additive across gestures, so the user
can rotate the object and select additional visible sides.

This is a point-centre visibility approximation, not a full per-pixel Gaussian
ellipsoid depth buffer. Very thin or interleaved geometry may still need manual
selection cleanup. Mesh extraction reports whether it used selected-only or
all-live points and records the source-point counts in the in-memory NIF
metadata. A successful selection test does not establish mesh continuity or
watertightness; those remain measured from the extracted geometry.

## Oriented-surfel reconstruction foundation (2026-11-02)

The production worker now has an initial local oriented-surfel stage:

- The shortest Gaussian covariance axis supplies an unoriented surface-normal line.
- Normal signs are propagated over a local k-nearest-neighbour graph. Spatially disconnected graph components are oriented independently; no single scene-wide centroid is used. This avoids the known failure for concave scenes and mixed full-scene captures.
- Each Gaussian receives a TSDF confidence weight from learned opacity and covariance flatness. Near-isotropic Gaussians contribute less than clearly flattened, surface-like Gaussians.
- Each voxel aggregates signed-distance samples from the nearest Gaussian's local graph component only. This reduces cancellation between nearby disconnected sheets, such as an object and a separate support surface.
- The original Gaussian geometry is not modified.

### Current limits — do not overstate this stage

This is a foundation, not the completed reconstruction system. A local normal graph component is not a semantic object ID: nearby coplanar objects may remain connected, and one physical object can contain disconnected observed patches. The component labels currently guide TSDF aggregation; they are not yet serialized as separately editable NIF mesh objects. The browser Studio extractor still uses its Gaussian-density/Marching-Cubes path and has not yet been ported to this oriented-surfel method.

The global sign of each graph component is intentionally left arbitrary. A consistent sign is sufficient for a zero-level surface, but reliable inside/outside classification and watertight closure require additional evidence. Unsupported regions must remain open rather than being filled by assumption.

Regression coverage is added in engine-next/tests/oriented_surfel_reconstruction.test.py for alternating normal signs, disconnected spatial patches, and empty/single-point inputs. CI runs this test with NumPy and SciPy installed.
## Supported oriented-surfel TSDF follow-up (2026-11-02)

The worker TSDF now has an explicit support mask:

- Signed distances are truncated to a local band and weighted by Gaussian confidence.
- A voxel is considered observed only when it lies within a local support radius of nearby surfels and has nonzero same-component weight.
- Marching Cubes receives the observed mask. Unsupported space is not assigned an artificial outside value, so the extracted surface can retain open boundaries where capture evidence ends.
- The previous implicit `manifold3d` conversion was removed from this extraction stage. It could change or close geometry without an explicit user repair action; reconstruction now reports the observed topology instead.
- Worker diagnostics include TSDF coverage, observed voxel count, normal-graph component count, mean surfel confidence, connected mesh components, boundary edges, non-manifold edges, and watertight status.

Regression cases now include a nearby supported plane, a distant unsupported query voxel, and two close parallel sheets assigned to separate components. These tests check that the TSDF does not average the two sheets into a phantom middle surface.

### Remaining implementation work

This remains worker-side. Studio still uses the browser density/Marching-Cubes extractor. Graph components are local normal-consistency regions, not semantic objects; the current NIF KEYFRAME_MESH encoding still carries one mesh payload, so per-object mesh visibility/editing and stable component identity require a versioned component-aware NIF representation and Studio/viewer integration. Support-plane semantic separation, concave-surface validation, and conservative user-directed repair remain outstanding. No real-scene quality claim is made until the user's complete scan is processed and visually inspected.
### Sparse-support and normal-graph safeguards

The worker's support-band calculation now handles one-surfel and empty-input cases explicitly. An isolated surfel receives a finite local support radius based on the voxel size; a missing second-neighbour distance can no longer become infinite support for the whole volume. Empty surfel sets and mismatched per-surfel arrays fail with a clear validation error.

Normal-orientation graph edges are now inserted in both directions before propagation. This makes connected-component traversal independent of asymmetric k-nearest-neighbour relationships and avoids seed-order-dependent sign propagation.

Latest regression coverage includes finite support for a single surfel, rejection of an empty surfel set, supported versus distant query voxels, and separation of nearby parallel sheets. These safeguards are worker-side; they do not yet port oriented-surfel fusion into the browser Studio extractor.
### Anisotropic Gaussian surfel footprints in TSDF fusion

The oriented-surfel worker now passes each Gaussian's two non-normal rotation axes and their corresponding linear scales into TSDF fusion. Candidate support is evaluated in the Gaussian tangent frame using a 2D Mahalanobis footprint, while signed distance is measured along the component-oriented normal. The two tangent radii remain independent: a broad axis cannot widen a narrow edge in the perpendicular tangent direction.

Support is still confidence-weighted and restricted to the nearest normal-graph component. The observed mask is true only when at least one same-component surfel supports the query inside its tangent footprint and truncation band. The tangent-scale floor is 0.1 voxel to avoid replacing genuine anisotropy with an artificially isotropic footprint. Missing or degenerate tangent frames are rejected.

This improves worker-side surface evidence; it is not yet the browser Studio extraction path, semantic object segmentation, or a guarantee of closed geometry.
### Independently addressable NIF mesh components

NIF chunk `0x001A` (`MESH_COMPONENTS`, version 1) stores connected reconstructed surfaces separately. Each record carries an ID, measured watertight flag, visibility flag, vertex positions, RGB colors and local triangle indices. The existing `KEYFRAME_MESH` chunk remains as a combined compatibility fallback for older viewers.

The reconstruction worker writes each connected mesh surface as a separate component while retaining the combined mesh. Studio decodes the component records into independent scene objects and exposes per-component visibility, selection/highlighting, isolation and deletion. Deleting a component rebuilds the legacy combined mesh from the remaining components on export; the original Gaussian source remains a separate layer.

The public NIF viewer renders the component records as separate meshes and exposes component visibility controls. The component IDs currently identify connected geometric surfaces, not semantic object identities. If two physical objects touch and become one connected surface, they may still require manual separation or a future semantic/support-plane segmentation pass.

Visibility and watertightness are independent flags. An open component is not discarded or relabelled as printable. This chunk does not claim semantic segmentation, support-plane classification, or automatic repair.
### Support-surface candidate classification

During worker mesh-component packing, each disconnected component is checked for PCA planarity, alignment of its plane normal with the Studio Y-up axis, position within the lower scene band, and share of total mesh faces. A sufficiently broad, nearly horizontal lower component is flagged as `support_surface` candidate and receives a confidence score. The original vertices/faces are not removed, flattened, capped, or merged.

This is intentionally a candidate label rather than automatic support-plane truth. A flat product base can also satisfy some of these geometric tests. The user must review the label before treating a component as a platform or excluding it from an object export. Connected object/platform geometry is still one connected component and requires a later dedicated separation pass.
### Studio worker handoff

Mesh & Print now exposes a full-scene oriented-surfel reconstruction action. It uploads the current live Gaussian geometry using the existing `mesh_only` worker queue, explicitly preserves scene coordinates (does not apply the print-height scaling), and asks the worker for the oriented Gaussian normal + anisotropic tangent-footprint + confidence-weighted TSDF path. The worker returns a complete NIF containing the original Gaussian geometry, combined mesh fallback, and `MESH_COMPONENTS` chunk. Studio downloads and decodes that NIF, verifies the Gaussian source signature has not changed while the job ran, and then replaces only the reconstructed mesh layer.

The local browser density/Marching-Cubes extractor remains available as a separate fallback. The worker handoff is the oriented-surfel path; it requires the configured reconstruction worker, R2 and Supabase job queue to be running. This repository CI validates code contracts and serialization, not a live GPU job or a visual capture result.
### Confidence-aware surface repair

The worker now examines closed, unbranched mesh boundary loops up to 48 edges. It will cap a loop only when the loop is sufficiently planar and convex, high-confidence surfels cover at least 80% of interior probes, their normal lines agree with the candidate cap plane, and the selected support point projects inside the loop. The cap center is taken from observed surfel evidence rather than guessed from an arbitrary geometric fill.

A boundary rim with no interior surfel support is rejected and remains open. Branched boundaries, non-convex loops, non-planar loops and oversized loops are left unchanged. Repair counts (candidate, filled and rejected loops) are retained in mesh diagnostics and shown in Studio. This is intentionally conservative: it will leave genuine openings alone even when that means the mesh remains non-watertight.
### Independent component transforms

Studio's component panel now supports per-component translation (X/Y/Z), rotation about Y, uniform scaling, one-step transform undo, isolation, visibility and deletion. These operations modify only the selected reconstructed component's vertex buffer. They do not mutate Gaussian positions, scales, rotations or opacity. On NIF export, the component chunk stores the transformed geometry and the legacy combined mesh is rebuilt from the remaining components if needed.

Transform undo is an in-session one-step operation; it is not yet a persistent multi-step edit history. Semantic object recognition and arbitrary-axis transform gizmos remain future work.
### Manual support-plane/object separation

Studio also provides an explicit horizontal Y-plane split for a selected reconstructed component. It clips existing triangles into above/below meshes, interpolates vertex colors at the cut, and preserves both sides as independent components. The new cut remains open; no cap is generated. The lower side is marked as a support-surface candidate for review, not automatically removed.

This gives the user a controlled way to separate a touching platform from an object when connected-component analysis alone returns one surface. The plane offset is in scene coordinates and must be chosen by inspecting the scan. A poor plane choice can cut through the subject. Plane splits do not yet have an in-session undo operation, so save a duplicate/original NIF before applying one; the one-step transform undo does not undo plane splits.