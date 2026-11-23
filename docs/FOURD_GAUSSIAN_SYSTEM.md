# FUMOCA 4D Gaussian Capture & Playback — implementation plan

## Product target

A FUMOCA 4D asset is a time-varying Gaussian reconstruction, not a static splat with a camera move, a colour effect, or a GLB placed over it. The output must preserve the Gaussian representation at every time and play the captured subject motion in the viewer.

## Existing code found during implementation

- `js/modules/fourd-capture.js` already provides a video-analysis UI with Analyze, Moments, Track, Multi-cam, and Pipeline tabs.
- `motion-analyzer.js`, `subject-isolator.js`, `motion-states.js`, and `motion-tracking.js` provide parts of a video-analysis / motion-state workflow.
- `js/modules/4d-engine.js` is an older camera-pose / viewport-anchor player. It can interpolate camera poses and optional numeric `pose_data`; it is not a dynamic Gaussian reconstruction engine.
- `js/modules/splat-capture.js` records the rendered canvas with MediaRecorder. That is a video recording of the view, not a time-varying Gaussian asset.
- `anim-author.js` and the GLB articulation path animate mesh components. They do not deform a captured Gaussian scene.
- The current Studio viewer can render Gaussian data, but no verified adapter currently loads and swaps a time-indexed sequence of Gaussian frames in that renderer.

## Architecture

### Capture and reconstruction

1. Capture synchronized video from one or more cameras. Record timestamps, camera identity, intrinsics, extrinsics/calibration, frame rate, dropped-frame information, and subject/session metadata.
2. Extract synchronized frames and masks. Keep the original video and calibration as immutable source artifacts.
3. Reconstruct time-indexed Gaussian frames. The reconstruction worker must retain the full Gaussian attributes required by the renderer: position, anisotropic scale, quaternion rotation, opacity, colour, and spherical-harmonic coefficients when present.
4. Store each reconstructed frame as an independently addressable artifact plus a versioned manifest. A frame sequence is the first interoperable delivery mode; canonical-Gaussian deformation fields can be added as a later, more compact representation.
5. Validate frame count, attribute schema, coordinate system, topology identity, timestamps, checksums, and storage ownership before publishing the sequence.

### Playback

- A single playback clock drives sequence time.
- The renderer adapter decodes/uploads the selected Gaussian frame and presents it.
- Hold/nearest-frame playback is the safe default when Gaussian topology/order changes between frames.
- Per-Gaussian interpolation is permitted only when adjacent frames prove identical topology and Gaussian ordering and the renderer supports interpolating position, scale, quaternion, opacity, colour, and SH attributes.
- Never linearly blend arbitrary flattened arrays from unrelated reconstructions; that produces ghosting and invalid covariance.
- Playback supports play, pause, seek, speed, loop, frame prefetch, cancellation, and GPU resource disposal.

### Studio and viewer integration

- Capture panel: live capture session, synchronized cameras, calibration status, masks, frame extraction, reconstruction job progress, and quality diagnostics.
- 4D timeline: frame strip, playhead, scrub, playback speed, loop, in/out range, and frame-level warnings.
- Viewer: load a published 4D manifest and use the same renderer adapter as Studio.
- GLB articulation remains a separate layer for semantic parts, not a substitute for captured motion.

## Data contract v1

The first playback contract is `fumoca.4d.sequence` version 1:

- `duration` and `frameRate` are seconds and frames per second.
- Each frame has an increasing `time`, safe asset `url`, `format` (`ply`, `splat`, or `nif`), positive `gaussianCount`, and `topologyId`.
- Optional `byteLength` and `sha256` support integrity checks.
- `interpolation: "hold"` is the safe default. `linear` is rejected unless adjacent frames have matching topology identifiers and counts.

The manifest deliberately does not pretend that topology equality has already been proven by matching counts alone. The reconstruction stage must assign a stable topology identity only when Gaussian ordering is actually consistent.

## Implementation status on this branch

### Phase 1 — foundation

- Added `js/modules/fourd-sequence.js`: manifest validation, timestamp-to-frame lookup, one playback clock, seek/play/pause/speed/loop, prefetch cache, adapter lifecycle, and cleanup.
- Added `tests/fourd-sequence.test.mjs` and included it in `scripts/run-anim-tests.mjs`.
- The playback core is renderer-adapter based. It does not yet decode PLY/SPLAT/NIF frames or update the live Spark/Three renderer.
- No capture pipeline, multi-camera calibration, dynamic Gaussian reconstruction, upload format, database migration, or public viewer integration is claimed complete.

## Delivery phases

1. **Sequence contract + deterministic player** — completed in this branch as a first code slice; tests must pass in CI.
2. **Gaussian frame adapter** — parse supported frame formats, validate full Gaussian attributes, upload to the actual Studio renderer, and dispose GPU resources safely.
3. **Capture session** — timestamped multi-camera capture, calibration and synchronization checks, frame extraction, segmentation/masks, and durable source upload.
4. **4D reconstruction worker** — GPU pipeline produces time-indexed Gaussian frames with stable identity metadata; establish quality/performance thresholds on real footage.
5. **Studio timeline** — connect capture, jobs, preview, frame selection, playback and save/publish.
6. **Viewer and NIF delivery** — publish manifest + immutable frame artifacts, load anonymously according to asset policy, and run end-to-end tests on desktop and physical phones.

## Acceptance gates

- A real moving subject is reconstructed from source video into at least 2 timestamped Gaussian frames.
- Each frame contains real Gaussian attributes, not a rendered MP4 or a mesh-only proxy.
- The viewer visibly changes the subject's pose/shape over time while preserving Gaussian appearance.
- Seek, pause, loop, speed changes, and reload are deterministic.
- Static splat fallback remains intact for assets without a 4D manifest.
- Memory use is bounded: only active and prefetched frames remain resident.
- No production deployment or database migration until preview acceptance passes.
