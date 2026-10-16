# LiDAR + Gaussian Splat Integrity

## Current behaviour

The live browser LiDAR upload path in `js/modules/upload-page.js` imports LAS/XYZ/CSV/TXT/PLY point data, downsamples it for browser safety, encodes a PLY, preserves the original uploaded source, stores the converted point cloud, and opens it in Studio.

This path is a **point-cloud import**, not LiDAR-to-Gaussian registration or fusion. It does not train Gaussians from LiDAR, solve a LiDAR-to-camera transform, or validate survey accuracy. The saved metadata therefore records:

- `scene_representation: point_cloud`
- `fusion_status: not_performed`
- `gaussian_reconstruction_status: not_performed`
- `measurement_grade: false`
- unknown CRS/units unless separately verified

## Intensity and point attributes

- Uncompressed LAS intensity is read as its original unsigned 16-bit sample and written to the PLY as `ushort intensity`; it is **not** silently substituted for RGB.
- Low raw LAS intensity values (including `1`) remain their original integer values on PLY export; they are not mistaken for normalized 0–1 display values.
- The viewer uses a separate percentile-stretched display buffer for contrast. This only changes rendered colours, not the stored intensity attribute.
- PLY intensity attributes are imported when present. LAS classification, return number, and RGB (where supported by the LAS point format) are carried as separate attributes.
- Downsampling must apply the same selected point indices to positions, intensity, RGB, classification, and return number so attributes never drift onto the wrong point.
- The viewer already has a LiDAR point-colour selector for intensity/classification/return data. Intensity display is a visualization, not calibrated reflectance: values can vary with sensor, range, angle, material, gain, and acquisition settings.
- Intensity normalization used for display must not overwrite the raw intensity values. Keep raw samples for export/analysis and derive a separate display buffer using a documented range (prefer robust percentiles for contrast, while retaining min/max and the chosen display range in metadata).
- A file with no intensity attribute must not be shown as if intensity were measured. Label missing data clearly; do not fabricate intensity values from RGB or geometry.
- XYZ/CSV columns are ambiguous without a header. Do not guess that an arbitrary fourth column is intensity or that columns 4–6 are RGB when a named header says otherwise. Header-aware parsing is a required next step.

## Integrity fixes in this change

- LAS point-format minimum record lengths are checked before reading point records.
- LAS parsing is isolated in a pure module and exercised by generated LAS 1.2 and LAS 1.4 binary fixtures.
- LAS version/header-size/point-offset combinations are checked; files declaring more points than complete records available are rejected instead of silently truncated.
- LAS 1.4 point formats 6–10 use the correct classification byte offset (16, rather than legacy offset 15).
- Unsupported/reserved/compressed point-record flags are rejected instead of being interpreted as ordinary LAS records.
- Non-finite or zero coordinate scales and non-finite offsets are rejected.
- LAS scale/offset values are exposed as metadata. CRS VLR/WKT and units are not decoded here, so they remain explicitly unknown.
- Coordinate metadata survives point-cloud downsampling.
- CI checks the syntax of the LiDAR importer and upload page and runs intensity, text-parser, and LAS parser regression tests.

## Important limitations

- LAS coordinates are converted to JavaScript `Float32Array` positions for browser rendering. Large projected coordinates can lose precision at this step; a reversible local-origin rendering transform is still needed before survey-grade use.
- LAS CRS VLR/WKT is not parsed here. Do not assume the point coordinates are metres or in a particular CRS.
- LAZ is not supported in this browser path.
- This change does not implement registration, point-to-splat constraints, geometry fusion, or accuracy metrics.
- PLY is a viewer-friendly derivative; the original source upload remains the provenance anchor.

## Acceptance criteria for a real LiDAR-to-splat workflow

1. Preserve original source files, source hashes, point attributes, coordinate metadata, and transform provenance.
2. Preserve raw intensity samples independently of any visualization normalization; test 0, maximum 16-bit values, constant-intensity scans, and sparse/outlier distributions.
3. Register scan and imagery/splats using explicit transforms and a reproducible method.
4. Report residual errors and coverage against independent checkpoints or a trusted reference.
5. Keep measured LiDAR returns, RGB/photo colour, intensity visualization, and unobserved/inferred surfaces distinguishable.
6. Fail closed: if CRS, units, calibration, or registration is unresolved, label output unverified rather than measurement-grade.
7. Test LAS point formats 0–10 where supported, malformed headers/record lengths, intensity preservation, attribute alignment through downsampling, and real approved data before connecting fusion to the production reconstruction queue.
