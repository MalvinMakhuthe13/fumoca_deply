# FUMOCA AI Reconstruction Partner

**Status:** implementation design; not a claim that features are implemented or production-tested.  
**Scope:** photos, videos, Gaussian splats, point clouds, meshes, CAD/design files where supported, and existing NIF files.  
**Primary objective:** photorealistic appearance AND geometrically honest output.

## 1. Product contract

The AI partner is an orchestrator and QA layer around specialist engines, not one monolithic model. A user selects an intent (create, reconstruct, repair, convert, extend with new captures, animate, optimize, or verify). The system inspects the input, proposes a route, reports CPU/GPU requirements and expected outputs, then runs only the required operations.

Every job must produce:
- an immutable source manifest and hashes;
- an operation plan and capability/preflight report;
- structured progress, logs, cancellation/retry state and failure reason;
- versioned derivatives with parent IDs and settings/model versions;
- a quality report distinguishing observed, geometrically inferred, and AI-synthesized regions;
- an artifact manifest with format, units, calibration, provenance, storage keys and supported capabilities.

Never overwrite a user's original file or silently replace a better prior version.

## 2. Input and operation router

Classify by inspected content and file signature, not extension alone. Validate size, MIME/signature, decompression limits, file integrity and supported features before scheduling.

| Input | Default route | CPU/GPU policy | Main output |
|---|---|---|---|
| Photos / image sequence | image quality + coverage analysis → camera poses → depth/masks as available → Gaussian reconstruction → optional mesh | CPU preflight; GPU preferred for neural depth/training; no synthetic camera poses presented as solved poses | splat + optional mesh + NIF |
| Video | FFmpeg frame sampling → duplicate/blur filtering → same multi-view route | CPU decode/preflight; GPU for selected neural stages | splat + optional mesh + NIF |
| Existing Gaussian PLY / SPLAT / supported splat binary | parse attributes → normalize supported representation → QA → optional optimization/repair | CPU/browser first; GPU only for supported expensive operations | preserved source + converted derivative/NIF |
| Ordinary point-cloud PLY / LAS / LAZ | parse points, preserve CRS/units and attributes → point QA; mesh only when explicitly requested | CPU by default; optional GPU for large supported jobs | point field and/or derived mesh + NIF when supported |
| Mesh (OBJ/STL/glTF/GLB and other registered formats) | validate topology/materials/transforms → repair only with explicit policy → optimize/export | CPU for validation and many mesh operations; GPU not inherently required | preserved mesh + optimized derivative + optional NIF |
| CAD / parametric design | use a dedicated CAD importer/kernel when available; preserve feature tree and units if possible | CPU geometry kernel first | native CAD remains authoritative; mesh preview/export as derivative |
| Existing NIF | inspect header/chunks/CRC → capabilities report → requested operation only | CPU/browser for inspection, metadata, preview and supported repackaging | new version only when modified |
| Additional captures for an existing scene | match scene/project → verify coordinate frame and camera compatibility → register new views → incremental retrain or rebuild | CPU alignment checks; GPU usually preferred for retraining | new immutable scene version, with rollback |

Unsupported inputs should fail with a useful explanation and supported export suggestions, not be accepted and silently corrupted. The format registry must distinguish Gaussian splats, ordinary point clouds, surface meshes, CAD solids, rigged characters, animation and volumetric data; these are not interchangeable representations.

## 3. Pipeline integration

Keep the current engine-next/reconstruction/pipeline.py worker as the established photo/video path while adding a small orchestration layer around it. Do not rewrite the working path or move all operations into a new service before its contracts are tested.

Proposed modules (inspect the repository first and reuse existing utilities):
- engine-next/reconstruction/ai_partner/intent.py — normalize user intent and input manifest.
- engine-next/reconstruction/ai_partner/preflight.py — file validation, dependency checks, estimated memory, CPU/GPU capability and user-visible warnings.
- engine-next/reconstruction/ai_partner/router.py — choose a typed operation graph; no hidden expensive fallback.
- engine-next/reconstruction/ai_partner/quality.py — geometry, appearance, coverage, calibration and artifact checks.
- engine-next/reconstruction/ai_partner/manifest.py — provenance, hashes, parent/version links and output manifest.
- engine-next/reconstruction/ai_partner/incremental.py — scene identity, pose-frame validation and incremental capture merge.
- engine-next/reconstruction/ai_partner/operations/ — adapters for the existing pipeline, NIF conversion, mesh validation/repair and optional model services.
- tests/ai_partner/ — unit, fixture, integration and regression tests.

### Job contract

Use the existing reconstruction_jobs queue and nif_files result registration path unless a verified schema audit proves otherwise. Do not revive legacy processing_jobs/splats paths as a shortcut. First inspect the actual checked-in and deployed schema; never assume a column exists.

A job should carry (using existing columns or a deliberate migration):
- job_type, input_manifest, operation_plan, requested_outputs;
- status, phase, progress, heartbeat_at, attempt, cancel_requested;
- quality_flags, error_code, error_detail;
- parent_asset_id, scene_id, source_hashes, settings_hash;
- worker_class (cpu, gpu_optional, gpu_required) and preflight result.

Do not write these fields to production until the DB adapter and migration are tested against the actual schema. If the current schema cannot represent them, store a versioned job manifest in a documented JSON field or add a reviewed migration with RLS tests.

## 4. Geometry and appearance are separate quality tracks

### Geometry track
- Camera pose success, reprojection error when measurable, coverage, depth consistency and scale provenance.
- Mesh topology: boundary edges, non-manifold edges, connected components, self-intersections where available, normals, degenerate faces and watertightness.
- Calibration: method, known reference measurement, scale factor, confidence and units.
- Alignment of new captures to the existing scene coordinate frame.
- Reference-mesh deviation only when reference and candidate coordinate/scale assumptions are valid.

### Appearance track
- sharpness/blur, exposure, color consistency, holes in rendered views, floaters and visual artifacts.
- Rendered held-out views compared with real held-out captures when available.
- Material/texture continuity and temporal consistency for videos/animations.
- Human review/feedback for ambiguous repairs.

### Region provenance

Every repair decision should be labeled internally as:
1. observed — supported directly by capture data;
2. geometry_inferred — estimated from multi-view evidence or a geometry algorithm;
3. ai_synthesized — plausible appearance/shape generated where evidence is missing;
4. unknown — provenance unavailable.

Do not claim dimensional accuracy from monocular depth, synthetic poses, or an uncalibrated COLMAP reconstruction. A visually filled hole is not proof of a physically correct surface. Do not use AI-synthesized areas for engineering/manufacturing approval unless independently measured and validated.

## 5. Repair strategy

Use the least expensive method that addresses the diagnosed issue:
1. deterministic cleanup (outlier filtering, normal correction, duplicate removal, mesh validation);
2. re-optimization from original captures when evidence exists;
3. geometric completion from valid neighboring surfaces and calibrated constraints;
4. generative view/texture completion for appearance-only gaps, clearly marked as synthesized;
5. request more captures when missing geometry materially affects correctness.

Do not automatically smooth away real edges, erase thin structures, or close every mesh hole. Repair operations must support preview, operation logs, undo/rollback and a before/after quality report.

## 6. Incremental uploads and persistent scenes

Each scene has a stable scene_id; each capture session has its own ID and immutable manifest. An incoming session must pass:
- content/duplicate detection;
- scene identity confirmation (user confirms when ambiguous);
- camera pose and coordinate-frame registration;
- conflict detection for moved objects or changed environments;
- compatibility checks for lens, scale, orientation and capture time.

If new views align, create a new scene version and refine/retrain using prior state only when the chosen engine supports it. Otherwise schedule a deterministic rebuild from all retained captures. Never merge incompatible camera poses blindly. Keep prior versions available for rollback, and show what changed between versions.

## 7. Affordable CPU/GPU policy

- CPU/browser: file validation, hashes, metadata, NIF chunk inspection, supported NIF repackaging, many mesh checks/repairs, thumbnail creation, queue planning and artifact verification.
- GPU optional: large mesh/splat optimization, selected segmentation/depth models, high-quality rendering and supported acceleration paths.
- GPU preferred/required for current quality target: neural depth and Gaussian training for many photo/video reconstructions. If unavailable, run only an explicitly supported reduced-quality route or queue the job for a GPU worker.
- No silent downgrade: if Depth Anything or SAM 2 is missing, write a structured fallback flag and report its impact. If COLMAP fails, do not treat synthetic poses as equivalent to solved camera poses.
- Budget controls: preflight frame count/resolution/estimated VRAM; allow draft vs quality; sample frames adaptively; deduplicate near-identical frames; stop jobs on budget/time limit; persist checkpoints where supported; never start paid GPU work without clear user intent.

Keep Kaggle or another worker replaceable behind the same worker contract. RunPod or local NVIDIA hardware should be configured as an explicit worker target, not hard-coded into the orchestrator.

## 8. NIF compatibility

Continue to use the canonical engine-next/format/NIFSpec.js and existing Python NIF encoder. Do not invent a second codec or silently change existing chunk layouts.

Use existing chunks where documented semantics fit: META, geometry, mesh, cameras, depth, alpha/layers, thumbnail, calibration, verification and edit history where implemented. Before adding a new chunk, review docs/NIF.md, engine-next/format/NIFSpec.js, Python pack/unpack code and browser readers. Unknown chunks must remain forward-compatible.

NIF should carry or reference a versioned provenance/quality manifest containing:
- source asset IDs/hashes and parent version;
- operation graph, software/model versions and parameters;
- observed/inferred/synthesized provenance;
- camera/pose source, depth method, calibration method/confidence and units;
- mesh topology and quality checks;
- supported capabilities and any conversion losses.

Prefer a documented existing JSON chunk or a versioned extension only after verifying reader compatibility. Avoid embedding secrets or private source URLs in public NIFs. Preserve unsupported source attributes in the original asset and disclose any data loss in a conversion report.

## 9. Delivery stages and acceptance gates

### Stage 0 — baseline and contracts
- Inventory existing codecs, routes, job schema, worker invocation and NIF readers/writers.
- Add fixtures for known-good and intentionally degraded files.
- Record baseline output, time, memory and quality flags for the current pipeline.
- No production schema changes yet.

### Stage 1 — safe intake and CPU preflight
- Build manifest, signature validation, limits and route/cost preview.
- Support existing NIF, mesh and supported splat conversion without reconstruction.
- Test corrupted files, unsupported chunks, huge inputs, cancellation and retry.

### Stage 2 — geometry/appearance QA
- Add separate quality reports, calibration provenance and topology checks.
- Ensure reduced-quality fallbacks are visible and persisted.
- Add regression tests for no false metric-scale claims and no false watertight claims.

### Stage 3 — reconstruction repair
- Route diagnosed issues to deterministic cleanup or evidence-based reconstruction first.
- Add generative completion only behind explicit provenance labels.
- Compare held-out views and reference geometry when available.

### Stage 4 — incremental scenes
- Stable scene/session/version IDs, pose registration, change detection and rollback.
- Test added views, unrelated scenes, changed objects, inconsistent scale and failed registration.

### Stage 5 — model improvement and wider 3D design
- Add specialist adapters for CAD, rigging/animation, point clouds and design formats one family at a time.
- Train/fine-tune only with properly licensed and consented data and an evaluation set.
- Keep native source formats authoritative; NIF is a delivery/container format, not a replacement for every design tool.

## 10. Definition of done

A feature is not done merely because it imports or renders once. Require:
- unit tests and golden-file format round trips;
- CPU smoke tests and GPU smoke tests where relevant;
- end-to-end upload → job → worker → artifact → viewer tests;
- browser checks for user-facing progress, failures, cancellation and retry;
- source/derivative hashes and rollback;
- truthful calibration/provenance and no fabricated geometry claims;
- measured runtime/memory and documented hardware limits;
- no regressions to existing upload, viewer, NIF decode, embed and publishing paths.

**First implementation slice:** Stage 0 plus Stage 1. This unlocks a useful AI partner foundation at low cost without pretending all 3D disciplines or all reconstruction repairs are already solved.
