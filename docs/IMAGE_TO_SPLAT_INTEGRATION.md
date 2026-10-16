# Image-to-Splat integration plan

Status: **Phase 1 project-preparation workflow**. This page does not run Image2Splat or claim to generate a splat. It previews user-selected local images and exports a ZIP containing the originals plus camera-plan JSON.

## Why integrate instead of rebuilding

Upstream: https://github.com/romanpillai/Image2Splat

The upstream README describes a local Windows web app that:
1. Lifts one source photo into a point cloud using MoGe-2 or a supported depth model.
2. Lets the user author a camera orbit.
3. Renders a control video from the authored camera path.
4. Optionally sends the reference image and control video to a selected fal.ai video model after explicit approval.
5. Prepares frames, mattes, authored poses and an initial point cloud as a dataset for Brush Gaussian-splat training.

The upstream application is a separate Python/FastAPI process and is not currently an API service integrated with FUMOCA. Its README documents an NVIDIA GPU (12 GB VRAM recommended), Python 3.12, Brush, and a fal.ai key for the remote video-generation path. Do not represent the upstream tool as serverless or free to run.

## Phase 1 — isolated FUMOCA entry point

Implemented on this branch:
- A dedicated `image-to-splat.html` Studio page linked from the shared navigation.
- Multi-image selection and local previews; images are not uploaded by this page.
- User-controlled camera count, sweep, relative radius, elevation and field of view.
- Export of a ZIP project package containing selected original images, `fumoca-project.json`, and a README, with camera-plan metadata and provenance.
- A separate JSON-only camera-plan export.
- Explicit accuracy/provenance fields: planned poses are synthetic; radius is not metric scale; generated views are not independent observations; AI inference is opt-in.
- ZIP generation is initiated by the user and runs in the browser; this page does not upload source images to a server.
- Responsive layout using a dedicated stylesheet so existing capture/viewer paths are not changed.

The ZIP is a **handoff package**, not a dataset accepted by Image2Splat. No processing job is queued, no AI provider is called, and no splat is produced yet.

## Phase 2 — connect an isolated engine adapter

Do not import the upstream 181 KB `steps.py` or `falclient.py` into FUMOCA's existing reconstruction worker as a quick patch. Keep the upstream engine isolated until the contract and runtime are tested.

Proposed adapter boundary:
- FUMOCA creates a project and transfers user-authorised image files to an isolated worker.
- Worker stores each project in a unique directory and returns a job ID.
- Worker exposes health, create-job, job-status, cancel, result-manifest and artifact-download endpoints.
- FUMOCA stores status/artifact references through the existing job/storage architecture only after schema mapping is confirmed.
- Export the resulting splat through the current FUMOCA publishing path; investigate NIF conversion as a separate validated step.
- Never pass service secrets or fal.ai keys to browser code. Require authentication, job ownership checks, file-size limits, allow-listed file types, rate limits and signed artifact URLs.
- Use explicit user approval before any source image or control video is sent to an external inference provider. Display provider and expected cost where available.
- Add cancellation, timeouts, progress, retry behavior, disk cleanup and GPU-memory safeguards.

## Phase 3 — validation gates

Before enabling production processing:
- Test one photo, then multiple genuine photos, with the same target object.
- Verify camera pose order and frame-to-pose correspondence.
- Compare source pixels against generated views; record visible, reprojected, inferred and unknown regions separately.
- Do not call synthetic views real observations or claim metric accuracy without calibration/reference measurements.
- Measure end-to-end runtime, GPU VRAM, system RAM, disk use, external inference cost and splat quality.
- Ensure a failed experimental job cannot modify or block the existing video/multi-photo reconstruction path.
- Run model/dependency licence review before commercial deployment.

## Licensing and ownership

The upstream repository code declares the MIT licence. That licence applies to the upstream project's own code; it does **not** automatically relicense every downloaded model, dependency, generated output or hosted service. Review each model and service's terms for intended commercial use. Keep third-party notices and record exact versions/commits. FUMOCA-specific UI, adapter, quality evaluation, NIF integration and future model training can remain separately developed proprietary components, subject to applicable third-party licences.

## Product rule

Default to source-preserving depth/reprojection. AI video synthesis is a separate, explicitly selected stage. Every result should retain provenance and disclose that generated views are synthetic; geometry and dimensions are measurement-grade only when independently calibrated and validated.
