# LichtFeld-inspired clean-run workflow for FUMOCA

Reference reviewed: [MrNeRF/LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio). This is an independently implemented workflow design, not a copied code port.

LichtFeld's docs recommend discovering current runtime/UI/scene/selection/history state before mutations and using registered, inspectable operations rather than guessing tool identifiers. FUMOCA can apply that principle without adopting LichtFeld's native C++/CUDA engine.

## FUMOCA clean-run sequence

1. **Inspect input**: identify format, point count and source metadata before previewing.
2. **Report attributes**: explicitly list RGB, intensity, classification and return number when arrays are present and aligned; say when fields are missing.
3. **Validate coordinates**: block malformed/non-finite positions and reject local-coordinate data with a missing render origin.
4. **Show cautions before actions**: disclose downsampling, unknown CRS/units and unverified scale. These cautions do not stop visual inspection by themselves.
5. **Preview before merge**: render and align first; preserve the uploaded source and allow a reversible/undoable merge.
6. **Keep operation claims honest**: importing a point cloud does not imply registration, metric measurement, mesh reconstruction or Gaussian fusion.
7. **Test the gates**: use tiny deterministic fixtures for valid, incomplete, malformed and downsampled inputs before testing real vehicle scans.

## Code added with this workflow

- `js/modules/lidar-quality-report.mjs` creates a side-effect-free data quality report and explicit preview/merge/measurement/fusion gates.
- `tests/lidar-quality-report.test.mjs` covers attributes, non-finite positions, missing coordinate origin, downsampling and unverified metric scale.

## Important boundaries

- This report does not parse CRS/WKT, recover a missing origin, register scans, establish calibration, or prove survey accuracy.
- `gaussianFusion` remains false until a real registration/fusion implementation and tests exist.
- LichtFeld Studio is GPL-3.0; do not transplant its code or depend on its internal APIs into FUMOCA without a separate licensing/architecture decision. See its [license](https://github.com/MrNeRF/LichtFeld-Studio/blob/master/LICENSE).
