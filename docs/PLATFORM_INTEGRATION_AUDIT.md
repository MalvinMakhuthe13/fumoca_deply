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

### Follow-up QA/QC — PLY layer persistence

- Added a guarded restore path for SH-preserving edited PLY files: the editor only reapplies the database `editor_scene` manifest when the file is opened from a matching `nifId` record, the URL matches that record's current `r2_key`, and the manifest point count matches the loaded PLY.
- Found and corrected a separate reopen risk: the editor bootstrap previously preferred legacy URL columns even after Studio updated `nif_files.r2_key`. It now builds the current artifact URL from the latest R2 key first, so a save does not silently reopen an older URL-backed artifact. Static CI guards cover this preference.
- Added automated tests for compact index remapping, layer visibility/opacity, malformed indices, legacy files, and positive/negative PLY record matching.
- GitHub Actions caught a test-harness newline-joining error on the first run. The harness was corrected; the subsequent run passed: https://github.com/MalvinMakhuthe13/fumoca_deply/actions/runs/39040672368
- This is targeted regression evidence, not proof of a live browser/R2/Supabase round-trip. Signed URL formats and the deployed loader path still need an end-to-end staging test.

### Security QA/QC — R2 object deletion ownership

- Follow-up read/write audit found the multipart abort route was the one write-side path still missing a per-key ownership check. Added the same fail-closed `userMayWriteFileKey` guard before `resumeMultipartUpload(...).abort()` and a route-order regression assertion. This closes the route-level gap in code; CI and live staging verification are still required.

- Found a critical authorization gap in `cloudflare/workers/r2-storage.js`: the delete route authenticated a user but did not verify that the user owned the requested R2 key.
- The delete route now checks ownership before deleting. Keys under the authenticated user's own ID prefix are allowed; Studio-edited derivatives require a matching `nif_files` row owned by that user with the exact current `r2_key`. Trusted server-to-server calls retain their explicit server principal. Ownership lookup failures deny deletion.
- Added focused regression tests for user-prefixed keys, owned Studio derivatives, cross-user denial, trusted server principal handling and missing-token denial. The full validation workflow passed on commit `1db23307341a862162e568aa4d5628410347d715`: https://github.com/MalvinMakhuthe13/fumoca_deply/actions/runs/39042632575
- Extended the same ownership boundary to presigned upload URL issuance, direct PUT uploads, multipart create/part/complete/abort. New Studio derivative keys are accepted only when their parent `nif_files` record is owned by the authenticated user; a new derivative does not need to already equal the row's current `r2_key`. Keys outside the user's own prefix or owned Studio derivative pattern are denied. Regression tests cover cross-user write denial and fail-closed missing-token behavior.
- CI is repository-level regression evidence, not a live integration test. The changes are not deployed to the live Cloudflare Worker. The ownership lookup depends on the deployed Supabase table's `user_id` field and RLS behavior; verify with a staging account before deployment. Existing deployed worker behavior remains a release blocker until updated and tested.

### Viewer QA/QC — incorrect R2 bucket routing for thumbnails and cleanup

- Found that the viewer built `meta.thumbnail_r2_key` URLs using the `nif-files` bucket, while the feed resolves the same field from `thumbnails`. This could make a valid thumbnail fail to load from the viewer.
- Found that the viewer's delete cleanup sent the NIF output, source capture/video keys, and thumbnail keys all to `nif-files`. Objects in `nif-videos` and `thumbnails` would not be cleaned from their actual buckets, potentially leaving orphaned storage objects.
- Fixed on the QA branch: thumbnail URLs now use `thumbnails`; cleanup routes NIF output to `nif-files`, source keys to `nif-videos`, and thumbnail keys to `thumbnails`, de-duplicating by bucket + key.
- Added `tests/viewer-r2-bucket-routing.mjs` and wired it into CI. This is a source-contract regression test, not proof that deletion works against live R2. Existing worker authorization and record-deletion ordering still need staging verification; the record is deleted before object cleanup, so a cleanup failure can leave orphaned objects and should be handled with a retryable cleanup queue in a later pass.

### Security QA/QC — public R2 read route and visibility bypass
- Additional configuration drift: the checked-in `supabase_storage_policies.sql` defines legacy Supabase Storage buckets `splat-videos` and `splat-files`, while the current browser client and Cloudflare Worker use R2 bucket names `nif-videos` and `nif-files`. The SQL also marks legacy `splat-files`, `preview-videos`, `thumbnails`, and `avatars` buckets public. This script does not configure Cloudflare R2 bucket privacy, and its names do not match the current NIF buckets. Do not treat running this SQL as proof that current R2 access is secure. Before release, inventory actual Supabase Storage buckets and R2 bucket/custom-domain settings, identify legacy URLs still referenced by records, and either migrate/update the policy script or explicitly retire the legacy path.
- Scope clarification from the bucket resolver: the same unauthenticated GET handler accepts all five configured buckets (`nif-files`, `nif-videos`, `preview-videos`, `thumbnails`, `avatars`) via the `bucket` query parameter. Therefore the risk is not limited to canonical NIF outputs: any object in the source-video, preview-video, thumbnail or avatar buckets is also served without a Worker-level access decision. Public bucket bindings/CDN exposure may add another access path and must be checked separately.
- QA acceptance should be bucket-specific: published model output may be public; raw/source capture assets and private preview videos should default private; thumbnails/avatars need an explicit product visibility policy; any public sharing mechanism must be deliberate and revocable where supported. Test both the Worker URL and any direct R2/custom-domain URL from a clean unauthenticated browser context.

- Follow-up inspection found that `GET /file/:key` serves any existing object in any configured bucket without authentication or consulting `nif_files.visibility`. The response is cached with `Cache-Control: public` for up to seven days (thumbnails: one day). This means the app's `public` / `followers` visibility filter is not itself a storage access control: anyone who obtains or guesses an object URL can fetch the object directly. The URL is also returned by upload helpers as a public URL.
- This may be intentional for published viewer assets, thumbnails and embeds, so a blanket auth requirement could break public sharing. However, private captures, source video/ZIP/PLY files and derivatives must not be assumed private just because their database record is private.
- **Release blocker:** define and implement a storage-level read policy. At minimum, public published artifacts should be distinguishable from original/source assets; private assets must require an authenticated owner or a properly authorized share token; follower access must verify the relationship instead of treating `followers` as public. Avoid shared-cache responses for authenticated/private content, and add tests proving anonymous denial for private keys, owner access, authorized share access, and public viewer access for published assets.
- No read-policy behavior was changed in this pass because the correct published-vs-source policy and follower/share-token contract must be explicit first. No live bucket or CDN exposure was probed. Treat existing public URLs as potentially public until the policy is implemented and verified.

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
