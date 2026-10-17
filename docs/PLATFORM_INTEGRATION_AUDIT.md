# FUMOCA Whole-Platform Integration Audit

**Status:** engineering audit and implementation plan; not a claim that every feature is connected or production-ready.

## Objective

Make the complete FUMOCA journey coherent: capture → upload → queue → reconstruct → validate artifacts → open in Studio/viewer → edit → save/publish → embed/share/export. Keep GPU-dependent and high-risk actions behind preflight and explicit status, and make operations observable and reversible where practical.

## Reference projects reviewed

- [Image2Splat](https://github.com/romanpillai/Image2Splat) (MIT): staged image-to-splat workflow, camera orbit authored once and reused for control render/COLMAP poses, approval before paid generation, preserved author datasets and logs.
- [NaviGS](https://github.com/ZJ-Humanoid/NaviGS): data organization that keeps RGB, depth, LiDAR, poses, 3DGS, meshes and semantic scene graphs tied to the same scene. Treat as a dataset/benchmark reference, not an implementation library.
- [KIRI 3DGS Render for Blender](https://github.com/Kiri-Innovation/3dgs-render-blender-addon) (GPL-2.0): splat import/edit/render, mesh-oriented hybrid workflows, modifiers, animation and export. Borrow workflow ideas; do not copy its code into FUMOCA without a licensing decision.
- [LichtFeld Studio](https://github.com/MrNeRF/LichtFeld-Studio) (GPL-3.0): native training, inspectable operations, history/undo, export, plugins and MCP automation. Its native C++/CUDA engine is not a drop-in browser module.

Image2Splat's MIT licence is recorded in its repository. NaviGS is a dataset repo and no root LICENSE file was found during this review; dataset/image/data reuse rights must be verified separately. This audit adopts workflow ideas, not source code or model weights.

## FUMOCA's current integration risks

FUMOCA_BIBLE.md documents parallel/partly divergent persistence paths: production NIF flow uses nif_files and reconstruction_jobs, while older modules still query splats and/or processing_jobs. It also flags UI/database wiring gaps, a segmentation endpoint that does not exist, isolated NIF/audio/physics capabilities, unverified full GPU execution and production storage binding, and broad gaps in page-level UI tests. Treat those claims as audit starting points and verify each against the current deployment before modifying production.

The repository also says the advanced engine/backend is partly isolated and the static HTML/ES-module frontend is the actual main application. Keep changes additive and isolated until the end-to-end contract is proven.

## Cross-reference matrix

| FUMOCA subsystem | External reference | FUMOCA work needed | Acceptance gate |
|---|---|---|---|
| Capture + upload | Image2Splat | Validate file count/type/size; give capture coverage feedback; use one job contract; persist source manifest and capture provenance | Real video and 3+ photo uploads each create a valid job and durable source asset |
| Camera + pose handling | Image2Splat | Keep one canonical camera model/pose set across control renders, COLMAP export and derived assets; stamp input/settings and mark outputs stale when inputs change | Fixtures verify consistent pose/intrinsics between render and dataset; real capture records pose provenance |
| Dataset + semantic scene | NaviGS | Link frames, depth/masks, poses, raw LiDAR, splat, mesh, labels, CRS/units and derived files through stable IDs | Manifest integrity tests; missing layers explicitly marked rather than fabricated |
| Reconstruction worker | Image2Splat + LichtFeld | Typed job states, environment preflight, heartbeat, cancellation/retry, phase progress and artifact manifest; distinguish solved poses from fallback poses | GPU smoke run with real capture; fallback/missing dependency produces explicit reduced-quality status |
| Studio editing | KIRI + LichtFeld | Consistent point/splat/mesh layer model; working crop/select/transform; undo/redo; save state and honest enabled/disabled controls | Browser tests exercise control families, failure states, reload persistence and undo/redo |
| Mesh + physical export | KIRI + NaviGS | Keep splat preview separate from mesh topology; report holes/non-manifold/watertight state; require scale calibration for dimensional claims | Geometry fixtures plus reference-measured object; no dimensional-accuracy badge without calibration |
| Viewer + public sharing + embed | KIRI + LichtFeld | One artifact resolver/metadata contract; versioned format support; show interactions/audio/CTA only when supported by loaded artifact | Public URL and token embed tested from a clean browser context with access policy checks |
| Format interoperability | FUMOC/NIF specs + KIRI | Format registry and capability matrix; round-trip supported attributes, transforms and metadata; disclose unsupported-data loss | Golden files for each supported format; import → export → reimport comparisons |
| Jobs + AI-assisted maintenance | LichtFeld | Inspect live app/job/schema state before mutations; make actions discoverable; typed operation contracts, logs, cancellation and reversible edits | State-transition tests for action availability, idempotence, errors and retries |
| Persistence + security | FUMOCA Bible + schema files | Resolve legacy vs NIF tables deliberately; central DB adapter; verify RLS, storage URL resolution and server-only secrets | Schema/API contract tests + authenticated/unauthenticated checks + R2 probe |
| Packaging + delivery | Image2Splat + KIRI | Preserve original captures; track derivative parent IDs, versions, hashes and conversion outcomes; make exports usable outside Studio | Cross-format artifact tests and real exported asset opened in another viewer |
| Benchmark + quality | NaviGS | Build held-out calibrated capture set across vehicle/object/property, including RGB, poses, depth/LiDAR where available and measured references | Compare against frozen baseline using coverage, pose success, reprojection error when ground truth exists, surface error, mesh completeness and runtime |

## Processing routes: avoid GPU work when it is not needed

Classify jobs by operation, not just by file extension:

| Operation | Preferred execution | GPU required? | Output/quality rule |
|---|---|---|---|
| Existing binary `.splat` → NIF | Browser/CPU encoder in `js/modules/nif-format.js` | No | Preserve source bytes as a separate R2 object; register NIF derivative with source key, output key, conversion metadata and Gaussian count; round-trip through `decodeNif` |
| Gaussian PLY → NIF | Browser/CPU attribute adapter | No | Preserve anisotropic scales, quaternion, opacity and DC colour where supported; disclose discarded higher-order SH fields if present |
| Ordinary point-cloud PLY → NIF | Browser/CPU encoder | No | Encode as isotropic points; explicitly do not claim Gaussian fidelity or mesh topology |
| Existing NIF import, metadata edits, thumbnails, publish/share and format checks | Browser/CPU + storage/API | No | No reconstruction job should be queued just to repackage or publish an existing artifact |
| Mesh extraction from an existing splat | CPU when size/algorithm permits; GPU optional only if a selected method requires it | Not inherently | Record mesh method, runtime, topology checks and calibration; never label watertight without testing |
| Video/photo → reconstructed Gaussian scene | Kaggle GPU worker when neural depth/training is selected | Usually for current full path | Record pose/depth fallbacks and quality flags; do not silently send expensive jobs to CPU |
| LiDAR parsing, CRS/units checks, geometry preflight | Browser/CPU | No | Preserve raw measurements and source CRS/units; conversion is not reconstruction |

The UI and worker should expose an operation capability/preflight result (`cpu_supported`, `gpu_required`, `gpu_optional`, input limit, expected outputs) before work begins. Kaggle remains the current replaceable GPU target; do not move paid processing to another service without an explicit decision. Browser conversion must have memory/size limits and preserve original source assets.

### P0 — Establish one working truth
1. Inventory every database query in root HTML and js/modules; tag each as current NIF schema, legacy schema or unknown.
2. Compare checked-in SQL with an explicit production schema inventory. Do not infer live schema from repository SQL alone.
3. Define one tested adapter for job creation/status, file lookup, public URL resolution and metadata updates. Do not silently map unsupported social/motion fields to unrelated columns.
4. Verify secret placement, R2 bucket/binding names, public URL formation and storage permissions with non-destructive health probes.
5. Build an end-to-end smoke path: create job → upload source manifest → worker completion → register result → resolve stored artifact → load viewer.

### P1 — Every visible control has a real contract
For every button, selector and toolbar action in Capture, Upload, Studio, Viewer, Feed, Publish/Embed, Export and Mesh & Print, record prerequisites, handler, service/API/DB dependency, success signal, failure surface and undo/retry support. Disable unavailable controls with an explanation; hide/remove dead paths instead of presenting them as working. Add browser tests for core clicks, auth states, invalid inputs and backend failures.

### P2 — Reproducible reconstruction and provenance
Persist input hashes, selected frames, capture metadata, pose source, depth model/version, masks, LiDAR/CRS/units, reconstruction parameters, engine/software versions and artifact hashes/storage keys. Reuse the same camera/pose representation downstream. Any fallback (monocular depth, synthetic poses, missing mask or unsupported input) must create a structured quality flag visible in the job and artifact details.

### P3 — Editing, save and export interoperability
Create a format registry for actual supported versions of NIF, Gaussian PLY, point-cloud PLY, SPLAT, FUMOC v2 and mesh formats. Keep original uploads immutable; converted data is a derivative with a parent ID and report. All edit sessions should have change history/safe restore. Export sidecar provenance when a format cannot hold CRS, units or scene metadata.

### P4 — Learn from measured benchmarks
Create frozen test sets for calibrated vehicle, object and scene captures. NaviGS provides a useful multimodal organization model but not a guarantee of accuracy. Record scene coverage, pose-solve success, reprojection error where ground truth exists, point-to-surface error, mesh watertightness, memory and runtime. Compare every meaningful pipeline change against a frozen baseline and retain rollback.

## Acceptance gates for a clean release

1. A clean environment loads every intended entry point with no missing module imports or unhandled startup errors.
2. Capture/upload creates correct persisted job records and leaves all source assets addressable.
3. Every job reaches a valid terminal state (done/failed/cancelled); no permanent silent hang.
4. A completed job's artifact resolves from its persisted record and opens in Studio and public viewer.
5. Studio edit → save → reload preserves expected edits and metadata; undo restores the previous state.
6. Publish/embed token/CTA routes resolve correctly and enforce access/origin policy.
7. Export/import round trips preserve supported data and disclose losses for unsupported fields.
8. Worker records pose source and quality flags; synthetic pose fallback is never labelled equivalent to a successful multiview solve.
9. Mesh/print dimensional claims stay unverified until independently calibrated.
10. CI covers syntax, unit tests, schema/API contracts, page-level E2E and a separate GPU smoke run with a known reference capture.

## QA/QC execution log — 2026-10-17

**Scope:** repository-backed static checks and targeted Studio persistence hardening. This is not a production sign-off.

### Verified in GitHub Actions

- Latest completed baseline workflow on `main` passed syntax checks for Studio, viewer and persistence-sensitive modules; inline Studio script checks; regression guards for layer transforms and subject selection; PLY fidelity metadata tests; CPU-only SPLAT→NIF smoke test; and the tiny GLB preflight fixture.
- Run: https://github.com/MalvinMakhuthe13/fumoca_deply/actions/runs/39038435877
- The earlier failures in the inline-script check were caused by the QA extractor treating an import map JSON block as JavaScript. The extractor now excludes import maps/JSON blocks; the corrected run passed.
- A dedicated branch, `qa-qc-full-platform-2026-10-17`, contains additional NIF Studio layer-manifest persistence changes and regression guards. Its own CI result must pass before those changes are considered validated.

### Findings addressed in the QA branch

- NIF export and save now attach a versioned `editor_scene` manifest containing compact point-index membership, layer IDs/names, visibility, opacity and active layer.
- NIF load restores valid layer masks from that manifest and bounds-checks every saved point index.
- Opening a different asset clears prior NIF metadata and thumbnail state, preventing a previous file's layer manifest from leaking into a later non-NIF import.
- Save metadata includes the same scene manifest so the database record and exported NIF can agree on the current editor scene.

### Remaining release blockers / evidence still required

| Gate | Current status | Evidence needed |
|---|---|---|
| Object-layer save/reopen | Code change in QA branch; pending branch CI and runtime test | Browser test with two subjects, distinct colours, transforms, export, reload and membership comparison |
| Gaussian PLY higher-order SH preservation | Known loss in 32-byte SPLAT/NIF adapter; disclosure exists | Decide on a native SH-preserving NIF representation or keep an explicit lossy-conversion warning |
| PLY save with object-layer manifest | Not proven round-trip | Store/read scene manifest alongside PLY and verify viewer/editor consumes it, or disable the claim of persistence for that path |
| Real R2/Supabase write and read | Not verified by CI | Authenticated, non-destructive staging probe with actual storage key and record lookup |
| Worker job lifecycle | Static contract checks only | Queue a known test capture and verify queued → processing → terminal state plus artifact resolution |
| Browser-level interaction | Not covered by current CI | Automated browser E2E for selection, transform, undo/redo, save/reload, errors and responsive layout |
| GPU reconstruction and physical dimensions | Not verified by this run | Known capture with calibration/reference dimensions; report fallback models and mesh topology truthfully |

**Release decision:** do not mark FUMOCA production-ready based only on repository CI. Keep release blocked until browser E2E, staging storage/API round-trip and one reference GPU reconstruction have recorded evidence. Do not run destructive migrations or paid GPU jobs as part of this QA pass.

## Licensing and scope boundaries

- No copy/paste of external GPL-2.0 KIRI Blender add-on code or GPL-3.0 LichtFeld code into this app in this pass.
- Do not describe FUMOCA as “best” or “at the pinnacle” until it is measured against a fixed benchmark.
- Do not switch the engine stack or run migrations against production before schema, licensing and rollback review.
- This audit branch documents the integration plan; production code and deployed services remain unchanged.
