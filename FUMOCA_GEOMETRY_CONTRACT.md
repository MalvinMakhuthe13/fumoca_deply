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


## Detail and depth policy

FUMOCA treats **appearance detail** and **geometric depth** as separate but coupled signals.

### Depth

DepthAnything output is now used in two places:

- real-world scale estimation/calibration;
- low-weight depth supervision during Gaussian training.

The training loss uses robust per-frame relative-depth normalization. This is deliberate: monocular depth may be metric or relative, and COLMAP reconstruction has its own scale ambiguity until calibration. The depth term therefore teaches the Gaussians the **shape/depth ordering** without pretending the raw depth map is already in metres.

### Detail

Production reconstruction exposes four quality tiers:

- **fast** — quick previews;
- **balanced** — normal production;
- **high** — default client-quality reconstruction;
- **ultra** — maximum detail for demanding products/print masters.

The high/ultra mesh path retains more surface samples, uses deeper Poisson octrees and trims less low-density surface. The solid face budget is deliberately much higher than the web preview budget.

Small geometry must be treated as real product information: handles, seams, badges, bottle threads, caps, door gaps, mirrors, trim and other thin features must not be erased merely to make a mesh smaller.

### Gaussian densification

The reconstruction worker's densification is gradient-driven rather than merely duplicating arbitrary Gaussians. This concentrates additional Gaussians where the rendered image is actually sensitive to geometry/appearance error.

Topology changes rebuild the optimizer so Adam state cannot become shape-incompatible after pruning or splitting.

### Surface normals

The production Poisson path derives normals from the learned Gaussian orientation and shortest Gaussian axis, then uses consistent tangent-plane propagation before reconstruction. This preserves the surface orientation information that a generic point-cloud normal estimation would otherwise discard.

Open3D's Poisson implementation requires oriented normals and its depth parameter controls the octree resolution; higher depth permits more reconstruction detail. FUMOCA therefore treats Poisson depth as a quality control rather than a fixed one-size-fits-all constant.


## Real-product encapsulation

**Encapsulation is a first-class FUMOCA requirement.**

FUMOCA must not merely create a visually convincing outer skin. The target is a digital representation that **encapsulates the real product**: its observed exterior, depth, boundaries, cavities, openings and physically meaningful parts wherever those surfaces are actually captured.

There is an important distinction:

- **Closed mesh** means the reconstructed triangle surface forms a valid solid.
- **Encapsulated product** means the evidence supports that the digital object represents the whole captured product rather than an invented or incomplete outer shell.

Therefore FUMOCA must never use "watertight" as proof that hidden geometry was recovered. Screened Poisson can bridge gaps or infer surfaces where observations are missing.

### Encapsulation rules

1. Preserve real openings and cavities whenever the capture shows them.
2. Do not blindly fill holes as a cleanup step. A hole may be a bottle opening, wheel arch, door gap, vent, handle recess, grille, cavity or other real product feature.
3. Interior surfaces must come from actual observations or explicitly authored geometry; they must not be fabricated merely to make the mesh closed.
4. Undersides, rear faces and occluded regions require capture coverage. If they were not observed, FUMOCA records that limitation rather than pretending they were recovered.
5. Exterior appearance and structural geometry must remain linked to the same coordinate system and scale.
6. A client-ready asset should be able to carry both the photorealistic appearance representation and the structural solid representation without either one being treated as the other.

The NIF file therefore carries an encapsulation record describing the evidence level. `unseen_geometry_claimed` must remain false unless a future explicitly authored/referenced geometry stage supplies that evidence.

### Capture implication

For a car, for example, the production capture should cover:

- front, rear, both sides and all corners;
- roof and lower body;
- wheels/arches and visible suspension openings;
- mirrors, handles, badges and trim;
- glass and visible interior;
- boot/bonnet/doors when those are intended to be interactive;
- underside or underside references when the product experience requires it.

A bottle, shoe, phone, appliance or skincare product follows the same principle: if a surface or moving part matters to the final experience, the capture must provide visual evidence for it.

The goal is **not** to make every object a generic watertight blob. The goal is to make the digital asset contain the real product's observed geometry, including the negative spaces that define the product.
