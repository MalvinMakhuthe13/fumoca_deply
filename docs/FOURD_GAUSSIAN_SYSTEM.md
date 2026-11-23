# FUMOCA 4D Capture, Motion Moments and Gaussian Playback

## Product definition

FUMOCA has several related but distinct systems:

- Static Gaussian capture and NIF reconstruction.
- Motion analysis and a set of timestamped reconstruction moments.
- GLB articulation and physics animation.
- Camera/tour animation and interactive viewer experiences.
- A future continuous, time-varying Gaussian sequence format and renderer.

These are not interchangeable. A camera move around a static splat is not captured subject motion. GLB joint animation is not Gaussian deformation. Multiple static reconstructions of different moments are useful motion-state capture, but are not yet a continuous dynamic Gaussian asset.

## Existing systems retained

- `fourd-capture.js`: Analyze, Moments, Track, Multi-cam and Pipeline UI.
- `motion-analyzer.js`: browser-side sharpness and frame-motion scoring, recommended reconstruction windows and moment selection.
- `subject-isolator.js`: client-side rough masks and optional server segmentation endpoint. The endpoint is not assumed to exist.
- `motion-tracking.js`: 2D centroid/step tracking and motion hints, not full 3D pose estimation.
- `motion-states.js`: separate splat/NIF moment references, transitions, tours and record metadata persistence.
- `4d-engine.js`: camera-pose interpolation and optional numeric pose-data interpolation. It reads the legacy `splat_motion_states` table and is not the new video-to-NIF job system.
- `anim-master.js`, `anim-author.js`, GLB binding, skeleton, object, light and Rapier physics modules: the established articulated animation stack.
- `engine-next/reconstruction/pipeline.py` and `kaggle/fumoca_nif_worker.py`: current NIF reconstruction worker path. The worker claims `reconstruction_jobs`, downloads from `nif-videos`, reconstructs and registers output in `nif_files`.
- `fourd-sequence.js`: renderer-adapter playback clock, seek/play/pause/speed/loop, prefetch and disposal. It does not itself decode NIF/PLY or mount frames in Spark.

## Capture-to-worker integration now implemented on this branch

### Single-camera motion capture

1. The browser analyses the selected video and creates one or more motion windows.
2. The original source video is uploaded once to the existing `nif-videos` R2 bucket under the authenticated user's 4D path.
3. A `reconstruction_jobs` row is created for each selected moment, using the production queue contract: `user_id`, `status`, `progress`, `vertical`, `capture_mode`, `raw_r2_key`, and `meta`.
4. Each job records a shared `motion_sequence_id`, state index/count/label/time, selected frame timestamps, motion class, and subject-tracking preference.
5. The NIF worker passes job metadata into frame extraction. The reconstruction pipeline extracts the selected timestamps from the original video instead of silently re-sampling the entire video at 5fps.
6. The NIF META payload and the `nif_files.meta` record preserve motion sequence provenance.

### Multi-camera capture

1. The browser loads at least two selected camera videos and checks readable duration.
2. It extracts matching relative timestamps from the common duration, encodes image frames and orders them by timestamp and camera.
3. It packages the frame set as a ZIP and uploads it to `nif-videos`.
4. It creates a `reconstruction_jobs` row with `capture_mode: 'burst'` and camera provenance.

**Synchronization limitation:** this browser implementation assumes the videos began together. It does not claim genlock, audio-clap synchronization, camera calibration, recovered extrinsics or a metrically aligned multi-camera rig. Those require explicit calibration/synchronization work and real multi-camera validation.

### Subject tracking

The checkbox controls cross-frame subject identity tracking in the worker (SAM 2 when available). Background removal still runs in the NIF pipeline; disabling tracking does not disable background removal. The browser's rough mask output is not currently uploaded as the authoritative reconstruction mask.

## Current output semantics and remaining gap

Each selected motion moment currently becomes an independent reconstruction job and, if successful, an independent NIF artifact. This is a useful multi-moment capture path. It is **not yet a single continuous 4D Gaussian sequence**:

- The current Python NIF encoder writes a single-frame header (`frameCount = 1`, duration 0).
- NIF `TIMELINE` chunk `0x0006` is reserved and has no encoder/decoder implementation.
- The current worker reconstructs each job independently. Stable Gaussian identity/order across separate jobs is not established.
- The viewer now queries completed sibling NIF records by `motion_sequence_id`, assembles a hold-only manifest, and drives the existing sequence clock through a NIF record loader. Playback swaps between independently reconstructed NIF moments; it is not continuous per-Gaussian deformation.
- The sequence clock is connected to the viewer's existing NIF load path. It is not a Spark per-frame Gaussian-attribute adapter and does not perform GPU-side interpolation.
- Sequence discovery obeys the existing `nif_files` row-access policy. A public viewer can only assemble/play moments it is authorized to read; publishing one moment does not automatically publish its siblings.
- The old `4d-engine.js` persistence path and the new NIF motion-sequence metadata are separate. Do not write new 4D capture jobs to the legacy `splats` / `processing_jobs` path.

## Playback safety rules

- Hold/nearest-frame playback is the safe default when independently reconstructed frames have different Gaussian topology or ordering.
- Never linearly blend flattened Gaussian arrays from independent reconstructions.
- Linear interpolation is permitted only after matching Gaussian identity, topology, ordering, coordinate system and complete attribute schema are proven.
- Any frame loader must cancel stale requests, prefetch a bounded number of frames and dispose GPU resources on replacement/unmount.

## Delivery phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Existing motion analysis, moment selection and capture UI | Existing |
| 2 | Upload source video to R2 and create production `reconstruction_jobs` | Implemented on this branch |
| 3 | Worker extracts selected timestamps and retains motion provenance in NIF metadata | Implemented on this branch |
| 4 | Multi-camera relative-time extraction, ZIP upload and burst job dispatch | Implemented on this branch; synchronization is assumed, not calibrated |
| 5 | Worker/GPU run against real footage, confirm job lifecycle and output artifacts | Requires live GPU-worker acceptance |
| 6 | Discover completed sibling NIF jobs and assemble a hold-only sequence manifest | Implemented on this branch |
| 7 | Connect the sequence clock to viewer NIF record loading and moment playback | Implemented on this branch; reload-based, not continuous |
| 8 | Spark/Studio per-frame Gaussian decoder and GPU resource adapter | Not implemented |
| 9 | True continuous dynamic Gaussian reconstruction with validated correspondence | Not implemented |


## Acceptance gates

- [ ] A real source video uploads to the user's `nif-videos` path.
- [ ] The job appears in `reconstruction_jobs` and is claimed by the NIF worker.
- [ ] Selected frame timestamps are extracted from the uploaded source.
- [ ] Each moment's NIF is registered with the correct `motion_sequence_id` and index.
- [ ] A multi-camera ZIP contains correctly ordered timestamp/camera frame names and produces a valid burst job.
- [ ] Failed uploads/jobs show actionable errors and do not report success.
- [ ] A sequence manifest can be assembled from completed NIF artifacts and reloaded.
- [ ] Viewer playback changes the actual reconstructed subject across frames.
- [ ] Static NIF assets continue to load unchanged.
- [ ] No production deployment or schema migration occurs before preview and real-worker acceptance.


## Proxy-driven Gaussian deformation (new development)

The Blender 3DGS Render and Houdini references demonstrate a second 4D route alongside video-derived motion moments:

1. Keep the captured Gaussian representation as the appearance source.
2. Create or derive a corresponding lower-complexity proxy surface.
3. Rig/skin/animate the proxy using conventional tools (armature/GLB, KineFX/APEX, or another animation system).
4. Bind Gaussian centres to the proxy surface in its rest pose.
5. Transfer each evaluated proxy deformation to Gaussian positions, orientations and scales.
6. Bake the resulting states as PLY/NIF frame data or stream evaluated poses to a compatible renderer.

### FUMOCA implementation started

- `engine-next/animation/NIFProxyDeformer.js` implements rest-pose binding using closest proxy triangles, barycentric surface coordinates and a local-frame offset per Gaussian. Runtime updates are O(Gaussians) after the bind.
- `NIFRenderer.bindProxyDeformation()` binds a proxy to the currently loaded Gaussian buffer.
- `NIFRenderer.updateProxyDeformation()` applies an evaluated proxy pose and wakes the existing renderer sort/upload path.
- `NIFRenderer.clearProxyDeformation()` can restore the original Gaussian buffer.
- `tests/nif-proxy-deformer.test.mjs` validates translated/non-uniformly scaled proxy deformation, attribute preservation, reset and invalid input handling.

### Explicit limitations

This is a first deformation-transfer bridge, not a complete Houdini/Blender replacement or a production character-rigging UI. The caller must supply a valid proxy rest mesh and evaluated vertex positions in the same coordinate space. Current binding is brute-force closest-triangle search and should be moved to a worker/spatial index for large assets. The initial transfer approximates scale using proxy frame edge/area ratios; complex shear, topology changes, cloth, remeshing and robust polar-decomposition of the full deformation gradient are not solved. The current renderer's Gaussian shader does not yet consume full anisotropic orientation/SH data in all paths, so orientation transfer must be visually validated before claiming fidelity.

The proxy deformation route should ultimately feed the NIF timeline/bake pipeline. It must not be confused with the independent-NIF moment sequence, which remains hold playback.
