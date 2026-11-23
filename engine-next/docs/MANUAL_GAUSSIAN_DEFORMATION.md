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

From Studio, load a NIF and use **Gaussian Lab** to open that active source NIF directly in the standalone manual editor. The handoff transfers a copy of the original NIF bytes; edits remain local to the lab until you export a new file.

## Manual editing workflow

1. Select all splats, a local-space box, a screen-space brush, or a screen-space lasso.
2. Use weighted falloff. Shift adds and Alt subtracts from the current viewport selection.
3. Enable front-surface-only selection to filter brush/lasso hits by camera-space depth. This is a centre-depth approximation, not a per-pixel depth-buffer or semantic surface test.
4. Grow a selection through nearby Gaussian centres using a spatial hash. The growth radius and falloff are adjustable in the authoring core.
5. Save and restore named selection sets for the current session.
6. Set a pivot and axis, or drag the XYZ translation gizmo in the viewport. A gizmo drag is grouped into one undoable edit.
7. Apply fold/bend, rotation, twist, translation, inflate/deflate, or non-uniform scale/compression.
8. Undo or redo edits. History is bounded by an approximate memory budget.
9. Create named animation layers, mute/unmute them, and choose the active layer.
10. Capture selected Gaussian transforms at timeline times. Delete or move keyframes and choose linear, ease-in, ease-out, or ease-in-out interpolation.
11. Scrub or play the manually authored animation in the local preview.
12. Export JSON tracks or a new NIF 1.2 file. The NIF export preserves original chunk payloads, replaces any prior Gaussian animation chunk, and reopens the output for structural and animation validation before download.

## Data and fidelity guarantees

- Selection and tracks address stable Gaussian IDs, not renderer depth-sort order. In this authoring path IDs are geometry indices, so keep the source geometry order unchanged.
- Deformations are recomputed from an immutable rest pose to avoid cumulative drift.
- Opacity and colour channels are preserved by the deformation core and are not animated by the current native track schema.
- Rotations update Gaussian orientation; non-uniform world-space scaling transforms the Gaussian covariance and decomposes it back into orientation and log-scales.
- Position, log-scale, and quaternion transforms are written to the native Gaussian animation chunk. Easing metadata is validated and evaluated by the native animator.
- Export never mutates the source byte array or writes to Supabase, R2, or production.
- The Studio handoff only opens the original NIF source. It does not import unsaved Studio edits back into the lab.

## Acceptance gates still required

- Browser acceptance on the Puma NIF and at least one larger real asset: load, select, gizmo drag, deform, undo/redo, capture, scrub, play, export, reopen, edit again, and re-export.
- Verify the gizmo remains aligned during orbit/zoom and that drag distance feels correct at different camera distances and aspect ratios.
- Profile brush/lasso projection and deformation on the Puma scene (23,485 splats) and larger scenes. Selection projection currently recomputes all projected centres for each brush update.
- Validate frontmost depth filtering on overlapping real surfaces; current depth range is a camera-space centre-depth heuristic.
- Visually inspect covariance decomposition and deformation density. Eigen-decomposition preserves each Gaussian's transformed covariance under the applied affine scale, but it cannot prevent all cloud-level gaps, overlaps, or fold self-intersections.
- Extend the gizmo beyond translation with rotation and scale handles, and provide a more complete Studio round-trip that can import unsaved Studio state.
- Verify CI and browser behaviour before considering this ready for user acceptance.

## Explicitly excluded

No AI motion generation, AI deformation, automatic motion extraction, or AI-assisted keyframing is included. AI remains out of scope until the manual workflow has passed acceptance testing.
