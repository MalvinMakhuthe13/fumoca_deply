# FUMOCA Whole-Platform Integration Audit
**Status: source review / proposed acceptance contract — not a claim that every workflow is currently passing.**
**Scope:** app pages, frontend modules, Supabase records, R2 assets, Kaggle worker, NIF pipeline, Studio, public viewer/embed, mesh/print, motion, commerce, and delivery.
**References reviewed:** Image2Splat, NaviGS, KIRI 3DGS Render for Blender, LichtFeld Studio.

## Executive finding

FUMOCA's biggest risk is not one missing feature. It is **contract fragmentation**: overlapping legacy and NIF-generation pathways, feature modules with different assumptions about data schemas, processing workers and URLs, plus buttons whose visible presence does not prove their target action completes and persists.

The current production contract described in the repository is `nif_files` + `reconstruction_jobs` with R2 object keys. Other parts still contain legacy `splats` + `processing_jobs` calls. This audit does **not** assume those are universally broken: validate each actual production path against the deployed schema and deployed migrations before touching it. Never run destructive SQL automatically.

## Reference crosswalk

### 1. Image2Splat — explicit, deterministic capture-to-dataset pipeline
Reference: https://github.com/romanpillai/Image2Splat
The upstream project authors a camera orbit first, renders control frames from those exact poses, sends a control video for generation only after explicit user approval, and exports a dataset containing frames, masks/mattes, poses and an initial cloud. It also surfaces progress/errors, logs paths and keeps training in Brush.

**Bring into FUMOCA**
- Make pipeline stages and artifacts explicit: Source → Validate → Reconstruct → Review → Publish.
- Store pose/capture metadata with the job, and verify frame/pose counts and ordering before reconstruction.
- Show busy, success, warning and failure states on the exact operation; expose an event/file log users can inspect.
- Require explicit consent before sending media to external paid AI inference; list what will be uploaded and the provider.
- Keep depth estimates, generated imagery, observed frames and trained splats distinguishable by provenance.
- Preserve resumable stage artifacts, so a failed final stage does not require restarting capture/depth.

**Do not copy blindly:** single-photo video generation produces plausible content, not newly observed hidden surfaces or survey-grade geometry; generated frames may hallucinate detail. External inference has privacy, cost and model-license implications. The Image2Splat repository's own MIT license does not change licenses of its models/dependencies.

### 2. NaviGS — aligned, multimodal scene evidence
Reference: https://github.com/ZJ-Humanoid/NaviGS
The dataset organizes RGB, depth, LiDAR, camera poses, 3DGS, mesh and semantic scene graphs per scene.

**Bring into FUMOCA**
- Use one scene manifest that references the source images/video, depth, camera poses, LiDAR, splat, mesh and semantic annotations where available.
- Record capture source, calibration/CRS/units, transforms and confidence for each representation.
- Represent which data are observed versus inferred/AI-generated.
- Define validation for cross-artifact counts, coordinate frames, timestamps, units and object identities.
- Add optional floor/room/object scene graph and semantic part labels as first-class metadata; do not claim they exist when absent.

**Boundary:** NaviGS is principally a research dataset, not a ready-made application engine. Use its data organization as a reference; assess dataset and annotation licensing before redistributing its data.

### 3. KIRI 3DGS Render for Blender — clean editing/rendering interop
Reference: https://github.com/Kiri-Innovation/3dgs-render-blender-addon
The addon separates editable selections/modifier workflows from its render mode and connects splats to Blender scene composition. Some mesh-shadow, animation and lighting features are explicitly experimental.

**Bring into FUMOCA**
- Separate authoring/selection from final-quality viewer rendering; don't make editing buffers and delivery assets silently share semantics.
- Build reversible operations and preserve source versions; export an unmodified original as a recovery path.
- Explicitly label approximate shadows, inferred meshes, relighting and baked animation as experimental until validated.
- Define an interoperability matrix for PLY/3DGS PLY, SOG/SPZ (if implemented), NIF, mesh/GLB/OBJ/STL and animated sequences. Fail loudly for unsupported formats.
- For every exporter, validate output by re-importing or round-tripping it; include origin/units, color/SH, opacity, scale/rotation, cameras and metadata where the format supports them.

**Boundary:** treat upstream release notes and Blender/version support as the compatibility source; don't port addon code without understanding its LICENSE and dependencies. KIRI's README says release builds may lag main.

### 4. LichtFeld Studio — inspectable operations and automated workflows
Reference: https://github.com/MrNeRF/LichtFeld-Studio
LichtFeld offers training and checkpoint workflows, selection/transforms with history, export, plugins, Python automation and MCP state/tools/jobs APIs.

**Bring into FUMOCA**
- Inspect state before mutating; define operation contracts, visible capability/availability, input schema, validation, expected effects and error recovery.
- One job model for long-running reconstruction/export/print tasks with progress, cancel/retry where safe, idempotency and structured errors.
- Undo/redo for scene edits via reversible transactions, not just UI toolbar state.
- Registry-based UI actions and integration tests that prove the visible button calls the intended operation.
- Plugin/automation contracts only after APIs are stable and permission-scoped.
- Track GPU idle/usage, worker health, model versions and resource limits.

**License boundary:** LichtFeld Studio is GPL-3.0. This audit extracts architectural ideas only; no LichtFeld source code is ported. Seek legal review before any code reuse or derivative distribution.

## FUMOCA platform graph — target contract

```text
Capture / file import
  -> input validation + consent + source hash
  -> immutable source asset in R2
  -> reconstruction_jobs (one canonical job ID/state machine)
  -> worker claims job atomically on Kaggle
  -> staged artifacts + logs + progress + error details
  -> validated NIF or explicit point-cloud / mesh / image-depth result
  -> nif_files or a deliberately modeled asset-type table
  -> shared asset resolver (R2 key -> authorized URL)
  -> Studio editor / public viewer / embed / presentation / feed
  -> export / print / analytics / commerce actions
  -> operation and asset provenance retained end-to-end
```

The flow above is the *target contract*, not a claim that the deployed app already conforms to every arrow. The canonical output should explicitly declare its representation type, e.g. `gaussian_splat`, `point_cloud`, `mesh`, `image_depth_preview`, or `nif_bundle`. No consumer should infer that a .ply is necessarily a Gaussian splat.

## Integration domains and acceptance criteria

### A. Configuration, identity, database and security
- A single runtime config and shared data-access/asset resolver are used on every page.
- Live schema is inspected against migration files; each migration is versioned, ordered, idempotent where practical and non-destructive.
- Stop introducing new writes to legacy tables unless there is an explicit approved compatibility layer.
- Every user-owned write is protected by RLS; privileged worker keys are never exposed to the browser.
- R2 object keys, buckets, MIME types, TTLs and authorization are consistent between uploader, worker, API, viewer and embed.
- No secrets, access tokens or secret headers in committed files/docs/logs. Scan repo history for exposed secrets and rotate any live values found; don't echo secret values into docs.

**Pass:** a single integration test can sign in as user A, upload a tiny fixture, verify authorization boundaries for user B, finish a job, resolve the artifact URL, open the asset, update metadata, and delete it according to retention rules.

### B. Shared asset/job contracts
Each job must expose: id, owner, capture_mode, representation intent, status, integer progress 0-100, created/started/finished timestamps, attempt count, stage, artifact keys, warnings, structured error code/message, and correlation ID. Treat the actual database schema as source of truth; add fields via migration only after review.
- Canonical statuses: `queued`, `processing`, `succeeded`, `failed`, `cancelled` (map legacy values at boundary rather than mix spellings).
- Worker claims must be atomic and concurrency-safe; duplicate deliveries should be idempotent.
- File writes use temporary keys then publish final keys only after validation; no partial file is shown as completed.
- Retry only retryable errors and limit attempts; stale jobs are recoverable and observable.
- User-facing progress is stage-based and truthful, never an invented percentage.

**Pass:** tests cover duplicate claim, worker restart, stale lease, retry, malformed input, failure callback and completed asset retrieval.

### C. Capture and ingestion
- Vehicle, generic video, multi-photo, direct PLY/splat, LiDAR LAS/XYZ/CSV and single-image depth all state exactly what they produce.
- Camera/motion sensor permissions happen within browser gesture requirements; unsupported sensors gracefully degrade.
- Validate file size/type/codec, minimum image count, readable frames and source hash before queuing.
- Capture guide and worker agree on the same capture_mode, file layout, FPS/timestamps and poses.
- Original uploaded input remains immutable and downloadable to authorized users.

**Pass:** browser smoke tests for each mode plus worker fixture tests with expected artifacts and explicit no-GPU/mock outcomes.

### D. Reconstruction and worker
- Pipeline stages are typed and observable: decode/extract frames, camera solve/poses, depth/mattes if requested, reconstruction/training, export, artifact validation, registration.
- Every model/dependency has pinned version and license metadata; optional models fail with an actionable message.
- CUDA/COLMAP/ffmpeg/model availability is preflighted before expensive work; CPU fallbacks explicitly warn about quality/runtime effects.
- Camera poses, image frames and masks remain indexed/synchronized; dataset completeness is checked before training.
- GPU memory, frame count, point count, timeouts and scratch storage have guardrails; cleanup is guaranteed.
- Worker logs include correlation/job IDs and redacted paths; never log secrets.
- The worker runs only in the intended Kaggle environment. Kaggle's interrupted sessions require lease recovery/checkpointed resumable stages.

**Pass:** one small known scene processed end-to-end in Kaggle; artifacts decoded by independent reader and visually reviewed. Then test one representative vehicle capture with reference dimensions/checkpoints.

### E. Asset manifest and semantic provenance
For each asset/representation: asset ID, source capture/job, representation type, file hash, parent/derived-from links, source frame IDs, camera poses, processing recipe, model versions, transforms, units/CRS, calibration/reference data, downsampling, observed/inferred/AI-generated coverage, supported attributes and validation level.
- Never mark metric-grade if calibration, units, registration or independent reference is absent.
- NIF bundle should contain/resolve its manifest and parts consistently; define behavior for missing/unknown chunks and version compatibility.
- Provide forward/backward compatibility policy and fixture per supported NIF version.

**Pass:** export → fresh session import → metadata/attribute hash comparison; unknown chunks are handled safely.

### F. Studio UI/action wiring
- Every button/selector has a capability contract and observable result, disabled/reason state, loading/success/failure state and testable handler.
- Start with visible button inventory and link it to module, action, state dependencies, API call, DB/R2 effects and test.
- No fake buttons; if not implemented, show `Coming later` or hide it.
- Undo/redo tracks scene operations and persists/rolls back transactionally when appropriate.
- Editor uses non-destructive edits and explicit version/dirty state. Save and publish are different operations.
- Startup state, empty state, errors, small screens, keyboard/accessibility, focus and resize are tested.

**Pass:** automated browser test activates every interactive control in core workflows, checks whether it becomes enabled, verifies intended state change/persistence, and checks console/network errors. Not just static ID checks.

### G. Viewer, embed, feed, presentation, commerce
- All viewers use a common asset resolver and type-aware renderer; PLY point-cloud rendering must not assume Gaussian semantics.
- Same asset opens consistently via internal viewer, embed link, public URL, presentation and social feed.
- Public sharing is token/origin scoped, with minimal metadata and revocation/expiry where relevant; validate postMessage origin and URL parameters.
- Hotspots, camera paths, part IDs, alternate states, music/teasers and CTAs persist in a canonical asset metadata format and survive republishing.
- Interactions and purchases are auditable but user data are minimized; click-out CTAs do not claim native checkout.
- Feed/profile/social buttons use actual deployed tables and show errors instead of swallowing them.

**Pass:** create an asset, publish, open on another browser/incognito, use hotspots, share/embed, register analytics event, and revoke access; unauthorized user cannot access private assets.

### H. Mesh, print, and measurement
- Separate true observed geometry, inferred geometry and cosmetic Gaussian display.
- Every conversion reports units, reference scale, watertightness, normals, holes, manifoldness, bounds, triangle count, and decimation/voxel settings.
- Scale calibration requires a verified dimension/reference and shows error bounds; uncalibrated models are shape-only.
- Separate edit, render, and print mesh profiles. Shadow proxies/lighting/rig animation are approximate unless independently validated.

**Pass:** manufactured test part or surveyed fixture, compare dimensions/volume and mesh defects against independent reference.

### I. Export/interoperability
- Maintain an explicit supported-format matrix by version and asset representation.
- Use roundtrip/fixture tests and third-party validation tool where possible; preserve metadata/attributes rather than only visual appearance.
- Validate NIF, PLY, GLB, STL and any SOG/SPZ support individually. Never silently rename/box a file and call it a converter.
- Keep original source/version snapshots; export errors leave the editable source untouched.

### J. Operations, QA and observability
- CI runs syntax, unit, contract, schema drift, security checks and minimal browser tests.
- Scheduled/dispatchable integration test in Kaggle runs only on safe sample assets with explicit compute budget.
- Health dashboard reports R2 connectivity, Supabase schema/version, last successful jobs, queue age, worker heartbeat, failed rates, storage/VRAM usage and dependency fingerprints.
- Logs and diagnostic bundles include version/commit, job ID, environment (without secrets), source hash, stage, timings, GPU/CUDA/driver, dependency versions, output sizes and test reproduction steps.
- Every user-visible feature needs release notes, rollback plan, owner, tests and status label.

## Prioritized execution plan

### P0 — Restore one truthful end-to-end core
1. Capture a fresh production schema snapshot (all table names/columns, functions, RLS policies, migrations applied) without exposing credentials.
2. Inventory all frontend database calls and classify each against deployed schema; migrate one coherent vertical at a time: upload/capture → job → worker → asset → viewer.
3. Standardize shared job status and R2 asset URL resolution; fix duplicate/legacy flow only after test and rollback are ready.
4. Add core browser tests for upload/capture, job progress/error, output load and save/publish. Block release on failure.
5. Verify worker R2 bucket and key paths match viewer resolution; test one tiny known artifact.
6. Scan config/docs/history for leaked secrets; rotate any active secret that has been committed.

### P1 — Connect the major experiences
7. Studio command/handler inventory; connect every shown control to real capability and a test.
8. Common asset manifest + representation type + resolver.
9. Fix persistence for editor changes, hotspots/parts, transforms, camera paths, variants/motion, sound, publish/share/embed.
10. Feed/profile/notifications and commerce actions against the deployed social schema only after verifying migrations/RLS.
11. Mesh/print quality gates and measurement calibration policy.
12. Type-aware renderer and full format round-trip suite.

### P2 — Quality and competitive differentiation
13. Pose-synchronized image/video/depth capture stages and resumable dataset preparation inspired by Image2Splat.
14. Multi-modal scene manifest and semantic scene graph inspired by NaviGS.
15. Separately optimized edit and render paths, approximate shadow/animation labelling, and Blender interoperability inspired by KIRI.
16. Inspectable jobs, action registry, transaction-based history and optional scoped automation/plugin APIs inspired by LichtFeld.
17. Benchmark against fixed datasets/reference objects: completeness, reprojection/registration error, geometric error, visual fidelity, file size, rendering latency, VRAM, job reliability and recovery time.

## Reference test set
Build a small, licensed internal benchmark set with:
- a simple textured object photographed all around with ground-truth dimensions,
- a real vehicle capture with front/side/rear/roof/interior coverage,
- a calibrated LiDAR scan plus camera imagery and reference checkpoints,
- a low-texture/repetitive scene to reveal camera-solve failure,
- a moving/reflective/transparent example where limitations must be explicit,
- malformed/oversized input fixtures for robustness.

Track the same metrics and exact settings across FUMOCA and external tools. Do not publish blanket superiority claims without comparable tests.

## Release gate — definition of “clean run”
A release may be called clean only when all P0 and P1 core checks pass on the intended deployed build, the Kaggle worker completes the test job, every deliverable loads through Studio and public viewer/embed, changes persist, errors are surfaced, permissions are correct, output roundtrips, and benchmark results have been recorded. Tests cannot establish that FUMOCA is the pinnacle in every capability; benchmark outcomes should determine where it wins and where upstream tools remain stronger.

## Licensing and attribution notes
- Image2Splat: repository README identifies project code as MIT; AI models and external service remain separately licensed/billed.
- NaviGS: research dataset; review dataset terms before using or distributing assets.
- KIRI 3DGS Render: consult its current LICENSE and dependency terms before incorporating code. This plan references documented concepts only.
- LichtFeld Studio: GPL-3.0; this audit contains no ported source implementation.
- All model weights, codecs, embedded viewer libraries, and formats keep their own licenses. Record exact source/version/license/SBOM for shipped components.
