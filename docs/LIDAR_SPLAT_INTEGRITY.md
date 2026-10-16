# LiDAR + Gaussian Splat Integrity

## Current behaviour

The live browser LiDAR upload path in `js/modules/upload-page.js` imports LAS/XYZ/CSV/TXT/PLY point data, downsamples it for browser safety, encodes a PLY, preserves the original uploaded source, stores the converted point cloud, and opens it in Studio.

This path is a **point-cloud import**, not LiDAR-to-Gaussian registration or fusion. It does not train Gaussians from LiDAR, solve a LiDAR-to-camera transform, or validate survey accuracy. The saved metadata therefore records:

- `scene_representation: point_cloud`
- `fusion_status: not_performed`
- `gaussian_reconstruction_status: not_performed`
- `measurement_grade: false`
- unknown CRS/units unless separately verified

## Integrity fixes in this change

- LAS point-format minimum record lengths are checked before reading point records.
- LAS 1.4 point formats 6–10 use the correct classification byte offset (16, rather than legacy offset 15).
- Unsupported/reserved/compressed point-record flags are rejected instead of being interpreted as ordinary LAS records.
- Non-finite or zero coordinate scales and non-finite offsets are rejected.
- LAS scale/offset values are exposed as metadata. CRS VLR/WKT and units are not decoded by this browser parser, so they remain explicitly unknown.
- Coordinate metadata survives point-cloud downsampling.
- CI checks the syntax of the LiDAR importer and upload page.

## Important limitations

- LAS coordinates are converted to JavaScript `Float32Array` positions for browser rendering. Large projected coordinates can lose precision at this step; survey-grade workflows need local-origin handling with a preserved reversible transform or a higher-precision processing path.
- LAS CRS VLR/WKT is not parsed here. Do not assume the point coordinates are metres or in a particular CRS.
- LAZ is not supported in this browser path.
- This change does not implement registration, point-to-splat constraints, geometry fusion, or accuracy metrics.
- PLY is a viewer-friendly derivative; the original source upload remains the provenance anchor.

## Acceptance criteria for a real fusion stage

1. Preserve source files, source hashes, point attributes, coordinate metadata, and transform provenance.
2. Register scan and imagery/splats using explicit transforms and a reproducible method.
3. Report residual errors and coverage against independent checkpoints or a trusted reference.
4. Keep unobserved/inferred surfaces distinct from measured LiDAR returns.
5. Fail closed: if CRS, units, calibration, or registration is unresolved, label the output unverified rather than measurement-grade.
6. Test with real approved data and synthetic fixtures before connecting the new stage to the production reconstruction queue.
