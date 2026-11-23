# Manual Gaussian deformation authoring

The manual-first editor is implemented in:

- `engine-next/animation/NIFManualGaussianDeformAuthor.js`
- `engine-next/animation/NIFManualAnimationExport.js`
- `engine-next/editor/manual-gaussian-deformation-lab.html`
- `engine-next/editor/manual-gaussian-deformation-lab.js`

## Local preview

Serve the repository root and open:

`/engine-next/editor/manual-gaussian-deformation-lab.html`

Load an original NIF file. It does not need an animation chunk. The lab runs locally and does not upload, overwrite, or publish the source file.

## Manual editing workflow

1. Select all splats, a local-space box, a screen-space brush, or a screen-space lasso.
2. Use soft selection falloff for box and brush selections. Shift adds to the current selection; Alt subtracts from it.
3. Selected splats are tinted in the preview only; original colour and opacity remain unchanged in the authoring data.
4. Set a pivot and axis.
5. Apply fold/bend, rotation, twist, translation, inflate/deflate, or scale/compression.
6. Undo or redo edits. History is bounded by an approximate 96 MiB memory budget, with at least one history step retained.
7. Capture the selected Gaussian transforms at timeline times.
8. Scrub or play the authored animation in the local preview.
9. Export a JSON track file or export a new NIF 1.2 file. The NIF export preserves the original chunk payloads, replaces any prior Gaussian animation chunk, and reopens the output for structural and animation validation before download.

## Data and fidelity guarantees

- Selection and tracks address stable Gaussian IDs, not renderer depth-sort order.
- Deformations are recomputed from an immutable rest pose to avoid cumulative drift.
- Opacity and colour channels are not animated or modified by the deformation core.
- Gaussian position, log-scale, and quaternion are written to the native NIF Gaussian animation schema.
- Export never mutates the source byte array or writes to Supabase, R2, or production.

## Current scope and remaining acceptance work

- The preview has viewport brush/lasso selection, weighted selection tint, numerical pivot/axis controls, and named selection sets. A true 3D transform gizmo with draggable axis/plane handles is still outstanding.
- Named selection sets, invert, and selection management are exposed in the preview UI.
- The current native animation schema is linear interpolation for position/log-scale and quaternion interpolation for rotation. Per-key easing curves, grouped named animation layers, and clip blending need a schema/runtime extension before they can be honestly called supported.
- Undo/redo and local export are implemented in the editor core, but large-scene performance and memory behaviour still require profiling on real assets.
- Gaussian appearance channels are preserved, but realistic folding can still expose density gaps, overlaps, and covariance artefacts. This needs visual validation and further deformation-aware covariance/density work.
- A screen-space brush/lasso uses projected Gaussian centers; it is not depth-aware surface painting yet. Occlusion-aware selection, connected-component growth, semantic segmentation and selection masks are future improvements.
- FUMOCA Studio's production editor entry point is not yet wired to this lab. The standalone local lab is the current safe acceptance surface.
- No AI motion generation is used. AI integration is explicitly downstream of a tested manual workflow.
