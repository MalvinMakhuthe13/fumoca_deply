# Manual Gaussian deformation authoring

The manual-first authoring core lives in `engine-next/animation/NIFManualGaussianDeformAuthor.js`.

## Local preview

Serve the repository root and open:

`/engine-next/editor/manual-gaussian-deformation-lab.html`

Load an original NIF file; it does not need an animation chunk. The lab is local-only and never uploads or edits the source file.

## Workflow

1. Select all splats or select a local-space box with adjustable soft-edge falloff.
2. Set a pivot and axis.
3. Apply fold/bend, rotate, twist, or scale/compress.
4. Capture the current selected Gaussian transforms at a timeline time.
5. Export the authored native Gaussian track JSON.

Selection is stored per stable Gaussian ID. Deformation is evaluated from the immutable rest pose on every operation to avoid cumulative drift. Opacity and colour channels are copied unchanged from the rest pose.

## Current scope and limitations

- The box selector and stable-ID selector are implemented. A screen-space paint brush, lasso, per-part semantic selection, and selection masking UI are not implemented yet.
- The preview exports track JSON; it does not yet package the edited animation into a new NIF file.
- The deformation core supports weighted fold/bend/rotate, twist, and scale/compress. Translation is available in the core API but not yet exposed in the preview UI.
- This is a manual authoring foundation, not AI motion generation. AI integration is explicitly downstream of the manual controls.
- Gaussian appearance channels are preserved, but high-quality shape folding still needs visual validation on representative assets and may require deformation-aware covariance updates and local density correction.
