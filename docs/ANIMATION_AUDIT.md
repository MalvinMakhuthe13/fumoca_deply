# Animation audit (P0)

Audit date: 22 Nov 2026. No product code was changed for this document.

## Repository state at audit

| Check | Result |
| --- | --- |
| Branch at start | `feature/4d-camera-timeline-v1` |
| HEAD | `826d0d3f6c19900db67d0a8543dee196078242a9` (22 Nov 2026, "Upload ownership and published delivery boundary.") |
| Working tree | Clean |
| `main` | `5fb490c17a5a2335b9894f54214646ab59781bf3` — does not contain this animation work |
| Production | `fumoca.co.za` does not run this branch. Nothing here was deployed. |
| PR #32 | Not touched. |

This audit was committed on `cursor/anim-client-demo-c441`, cut from that tip. The pull request base is `feature/4d-camera-timeline-v1`, not `main`.

## What was inspected

Runtime modules: `js/modules/anim-joint-eval.js`, `anim-object.js`, `anim-master.js`, `anim-studio-init.js`, `anim-author.js`, `anim-glb-bind.js`, `anim-live.js`, `anim-afford.js`, `anim-prep.js`, `anim-scenes.js`, `anim-physics.js`, `anim-physics-boot.js`, `anim-timeline.js`, `anim-skeleton.js`, `anim-light.js`, `anim-interaction.js`, `anim-studio.js`, `anim-ai-assist.js`, `anim-video-annotator.js`.

Entry points: `edit.html` (import map, Animate button, Load GLB, auto cooler boot, publish panel), `viewer.html`, `js/modules/viewer.js`, `js/modules/publish-to-fumoca.js`, `js/modules/founder-gate.js`, `js/r2Client.js`.

Older generation (present, not what `viewer.html` loads): `engine-next/animation/NIFAnimator.js`, `NIFAnimationSequencer.js`, `NIFHingeAuthor.js`, `NIFHingeAuthorPanel.js`, `engine-next/viewer-src/NIFViewer.js`, `engine-next/format/NIFSpec.js` PHYSICS chunk.

Workers and policy: `cloudflare/workers/publish-auth.js` (`canPublish`), `founder-auth.js`, `upload-auth.js`, `r2-storage.js`, `engine-next/db-reference/storage-privacy-proposed.sql`.

Tests: every `tests/anim-*.test.mjs` and `cloudflare/tests/{founder-auth,delete-auth,upload-publish,auth}.test.mjs`. CI: `.github/workflows/fumoca-validation.yml`.

No `.ply`, `.glb`, or `.gltf` file is in the repo. No shoe asset is in the repo.

## Clock and transform ownership (as the code stands)

There is one intended playback clock: `FumocaMaster.play()` in `anim-master.js` is the only animation `requestAnimationFrame` that Studio starts for joints. `anim-timeline.js` defines a second clock (`FumocaTimeline.play`) but nothing imports it, so it does not start. Other `requestAnimationFrame` loops exist for splat rendering, camera damping, capture, and the Studio background grid. Those are not joint clocks.

`FumocaJointEval.evaluate` implements `world = parentWorld × pivot × jointTransform × inverse(pivot) × local`. Hinge values are radians. Prismatic and lift values are metres along a unit axis. `applyObject` writes `result.local` onto the bound node via `_applyJointLocal`. It does not assign `result.world` to the node.

Legacy tracks (no `animVersion === 1`) still apply Euler degrees from `rot`/`pos`. Schema migration in `anim-object.js` converts legacy degree limits on hinge/threaded joints to radians and records a warning.

Dynamic bodies: `applyObject` skips a component when `FumocaPhysics.isSimulationOwned(objectId, componentId)` is true (a bound collider with `bodyType === 'dynamic'`). After the master steps physics, `applyDynamicPoses` writes the body pose through `_toParentLocal` (parent `matrixWorld` inverse), which is the `worldToParentLocal` path. `stop()` seeks time 0 and does not reset physics. `reset()` does.

`registerArticulatedObject` checks that each `parentId` exists in the component id set. It does not check that `node.parent` is the node bound to that parent. A wrongly parented node still returns `ok: true` when every id is in the map.

`anim-studio-init.js` contains extra copies of `createDropDemo` nested inside `init`, `registerArticulatedObject`, and `createDemoCooler`. They are unused function declarations. `node --check` accepts the file. The exported `createDropDemo` is the one in the module return.

## Persistence

Authored joints live in `FumocaObjectAnim` and are copied onto the master with `addObject`. `FumocaMaster.persist(recordId)` reads `nif_files.meta`, writes `meta.anim_timeline` (schema version 1) plus `has_4d: true`, and bumps `revision`. It requires `window._fumocaSupabase` and an id. `FumocaAuthor.save` refuses with "Open a NIF first" when no id is open. This path was not executed against any database in this audit.

`FumocaPublish.publish` builds a NIF blob and updates `nif_files`, but it does not copy `FumocaMaster.serialize()` into `meta`. A publish of a splat therefore does not carry the authored timeline unless that timeline was already on the row.

The NIF binary has a separate PHYSICS chunk (`NIFSpec` 0x000C) written by `NIFHingeAuthor` when `window._fumocaAuthoredPhysicsChunk` is set. `publish-to-fumoca.js` splices that chunk into the exported file. `viewer.html` does not import `NIFViewer` or `NIFAnimator`, so that chunk is not played by the public viewer.

## Studio and viewer entry

`edit.html` loads the anim modules, pins `three@0.180.0` and `@dimforge/rapier3d-compat@0.21.0` in an import map, and wires `#authorBtn` to `FumocaAuthor.open()`. `#loadGlbBtn` calls `FumocaGLBBind.load(file)` and alerts the component count. It does not open the author panel or name a joint. The author panel can set kind (hinge/prismatic/lift/fixed) and a joint value, then keyframe. Pivot is not an input. Apply uses a default axis and a zero pivot. Press-to-open buttons come from `FumocaLive.bind`, which scene presets call. GLB load does not call `bind`.

On Studio boot, `bootArticulated()` always builds the procedural cooler and adds a Play/scrub bar. That is a fixture, not a loaded asset.

`viewer.html` and `js/modules/viewer.js` do not import `FumocaMaster`, `FumocaLive`, or `anim_timeline`. `fetchRecord()` loads `nif_files` by `nifId` from Supabase. There is no local mock record path. The visitor animation path is unproven because the code path does not exist.

`anim-studio.js` `playClip` toggles a named state and dispatches `fumoca:state`. It does not move a joint.

## Hotspots and physics ownership

`FumocaMaster.resolveAnchor` takes the component world position and adds `anchor.offset` in world space. Hotspot markers in `hotspot-pro.js` store `wx/wy/wz`. They are not parented to a moving component, so they do not follow a hinge.

Hinge motion and dynamic simulation are two writers. A dynamic collider that is simulation-owned is skipped by the joint writer. A hinged lid is not a dynamic body. Nothing in the author panel assigns a single owner when a hinged part and a dynamic body share a hierarchy. `registerHierarchy` only records parent ids. That coordination is not one story.

## Security (code only, not applied)

Studio calls `FumocaFounderGate.requireFounder()` on load. The allowlist is `window.FUMOCA_FOUNDER_EMAILS`. An empty list blocks the page in the browser. That is not the server check.

`canPublish` in `cloudflare/workers/publish-auth.js` allows publish only when `principal.id` is in `FUMOCA_FOUNDER_IDS`. Tests call it. `r2-storage.js` does not. The Publish button (`#pubBtn` → `FumocaPublish._handlePublishClick`) uploads and writes `nif_files` with no `canPublish` call. `GET /founder/me` uses `authorizeFounder`, which is the same id list, and the button does not call that route.

`POST /upload/presign` runs `assertUpload` (prefix bound to the caller). `PUT /upload/:key` and the multipart create/part/complete/abort routes authenticate the caller and then use the supplied key. They do not call `assertUpload`. `js/r2Client.js` states that browser uploads go through `PUT /upload/:key`.

`engine-next/db-reference/storage-privacy-proposed.sql` sets `splat-videos` and `splat-files` to private. The file says it has not been applied. This audit did not run it.

## Test evidence from this checkout

Command pattern: `node <file>`. Node v22.23.4. `three` and `@dimforge/rapier3d-compat` are declared in `package.json` and are not installed (`node_modules` absent). No browser was opened for this audit.

| Suite | This run | Notes |
| --- | --- | --- |
| `tests/anim-joint-eval.test.mjs` | 47 passed, 0 failed | Pure maths. No Three.js. |
| `tests/anim-schema-migration.test.mjs` | 43 passed, 0 failed | Legacy Euler degrees still migrate. |
| `tests/anim-articulated-pot.test.mjs` | 11 passed, 0 failed | Schema only. No scene. |
| `tests/anim-master.test.mjs` | 31 passed, 0 failed | Fake `THREE.Quaternion`. |
| `tests/anim-physics.test.mjs` | 15 passed, 0 failed | AABB query backend, not Rapier. |
| `tests/anim-physics-dynamic.test.mjs` | 8 passed, 0 failed | Reference backend. |
| `tests/anim-physics-transform.test.mjs` | 22 passed, 0 failed | Includes `worldToParentLocal` failure without Three. |
| `tests/anim-light.test.mjs` | 17 passed, 0 failed | Data model. |
| `cloudflare/tests/founder-auth.test.mjs` | 7 passed, 0 failed | |
| `cloudflare/tests/delete-auth.test.mjs` | 8 passed, 0 failed | |
| `cloudflare/tests/upload-publish.test.mjs` | 15 passed, 0 failed | Includes `canPublish` unit cases. |
| `cloudflare/tests/auth.test.mjs` | 6 passed, 0 failed | |

These failed before any assertion because the module path does not exist:

- `tests/anim-object3d.test.mjs`, `tests/anim-hardening.test.mjs`: `Cannot find package 'three'`.
- `tests/anim-studio-binding.test.mjs`, `anim-joint-integration.test.mjs`, `anim-live.test.mjs`, `anim-afford.test.mjs`, `anim-glb-bind.test.mjs`, `anim-glb-real.test.mjs`, `anim-scenes.test.mjs`, `anim-physics-binding.test.mjs`, `anim-physics-binding-lifecycle.test.mjs`, `anim-physics-parent-safety.test.mjs`, `anim-physics-restart.test.mjs`, `anim-physics-studio-integration.test.mjs`, `anim-master-ownership.test.mjs`, `anim-ownership-scrub.test.mjs`: `createRequire('/workspace/artifacts/package.json')` then `Cannot find module 'three'`.
- `tests/anim-light-master.test.mjs`: imports `/tmp/three.esm.js` and `/workspace/artifacts/js/modules/anim-master.js`. Neither path exists.
- `tests/anim-physics-rapier.test.mjs`, `anim-physics-rapier-real.test.mjs`, `anim-physics-rapier-dynamic.test.mjs`, `anim-physics-integrated.test.mjs`: `createRequire('/tmp/package.json')` then `Cannot find module '@dimforge/rapier3d-compat'`.

`node --check` succeeded for every `js/modules/anim-*.js`.

CI (`.github/workflows/fumoca-validation.yml`) runs on push to `main`, `feat/**`, and `platform-integration-audit`, and on pull requests into `main`. It syntax-checks selected modules and runs poster, viewport, and splat tests. It does not run `tests/anim-*.test.mjs`. A pull request into `feature/4d-camera-timeline-v1` does not match `pull_request.branches: [main]`, so this branch's PR will not run that workflow until the trigger list includes it.

`npm test` runs only live, glb-bind, joint-integration, and joint-eval. The first three cannot start on this checkout.

No browser test of the Animate button was run in this audit. Historical counts in the task brief match the suites that actually ran (joint-eval 47, schema 43, pot 11, master 31, physics 15, founder-auth 7, delete-auth 8, upload-publish 15). Suites that need Three.js or Rapier were not re-confirmed.

## Capability table

Status words mean only what this run and this reading established. "Unit-tested" means assertions passed in this checkout. "Missing" means the code path is absent. "Blocked" means the code exists but this environment could not execute it.

| Capability | Existing implementation | Test evidence | Actual status | Missing work |
| --- | --- | --- | --- | --- |
| Joint maths (fixed, hinge, prismatic, lift, pivot, hierarchy) | `anim-joint-eval.js`. Threaded and snap return `unsupported_joint`. | joint-eval 47/47 | Unit-tested | None for the pure contract. |
| Legacy Euler tracks | `anim-object.js` migration; `anim-master.js` non-v1 branch uses degrees. | schema-migration 43/43; master 31/31 | Unit-tested | Keep both paths when editing the evaluator. |
| One master clock | `FumocaMaster.play` is the joint RAF. `anim-timeline.js` is unused. | master 31/31 uses a fake RAF. | Unit-tested | Do not start `FumocaTimeline`. |
| Apply local, not world | `_applyJointLocal` writes `result.local`. | Covered inside joint-integration, which did not start (missing Three). joint-eval checks local and world numbers only. | Implemented. Integration-tested only in code that did not run here. | Re-run joint-integration after Three is installable from the repo. |
| Parent id exists | `registerArticulatedObject` rejects unknown `parentId`. | Not executed (studio-binding needs `/workspace/artifacts`). | Implemented | — |
| Parent node matches `parentId` | Not checked. Wrong Three parent returns `ok: true`. | None. | Missing | Reject `parent_mismatch` and test it. |
| Procedural cooler / car / house / bottle | `createDemoCooler`, `anim-scenes.js`. Studio auto-boots the cooler. | scenes and studio-binding tests did not start. | Implemented. Not browser-tested. | Browser proof. |
| GLB load and bind | `FumocaGLBBind.load` walks every Object3D, ids from `node.uuid` (new every load), pivot zero, all joints fixed. | glb-bind and glb-real did not start. | Implemented. Not real-asset-tested. | Stable ids, non-zero pivot, real licensed GLB, reload. |
| Name a part and keyframe it | Author panel selects a component and captures `jointValue`. No rename field. No pivot field. | None for the panel. | Implemented as a small panel. | Pivot, name, and a real asset through it. |
| Press to open / close | `FumocaLive.toggle` sets min/max, captures a keyframe at t=0 or t=2, evaluates once. | live and afford tests did not start. | Implemented. Not browser-tested. | Bind it after GLB prepare. Repeat-toggle drift check in a browser. |
| Affordance labels | `anim-afford.js` name rules. | afford test did not start. | Implemented | Re-run after path fix. |
| Animation save | `persist` writes `nif_files.meta.anim_timeline`. Needs an open id and Supabase. | Not run. No mock. | Implemented for Supabase. Not integration-tested. | Local mock save/reload without live Supabase. |
| Publish carries animation | Publish panel does not merge the master timeline. `canPublish` is not on the button. | canPublish unit cases 3 of the 15 upload-publish asserts. | Unit-tested function. Not wired. | Gate the button on the server check. Put the timeline in meta if that stays safe. |
| Visitor playback | `viewer.html` never reads `anim_timeline`. engine-next `NIFAnimator` is a second stack and is not loaded by `viewer.html`. | None. | Missing on the public viewer. | Local mock record, same evaluator, toggle in `viewer.html`. |
| Physics query (AABB) | `anim-physics.js` reference backend. | physics 15/15, dynamic 8/8, transform 22/22 | Unit-tested | — |
| Rapier 0.21 dynamic poses | `initRapier`, `step`, `applyDynamicPoses`. | Rapier tests did not start (`/tmp/package.json`). | Implemented. Blocked in this checkout. | Install the pinned package and point tests at it. |
| Hinge vs dynamic ownership | Simulation-owned dynamics are skipped by the joint writer. No shared owner for a hinged lid and a loose body. | ownership tests did not start. | Implemented as a skip, not one ownership story. | Coordinate after the browser path is green. |
| Hotspots follow moving parts | World position plus world-space offset. | None. | Missing | Local offset in the component frame, after P1. |
| Skeleton / character | `anim-skeleton.js`, `FumocaLive.addCharacter` builds capsules. | master skeleton cases in the 31. | Unit-tested data path. Not a real character. | Out of scope until P0–P2 are green. |
| Cloth / soft body | Comments and older engine-next notes. No live XPBD/FEM writer on the master clock. | None. | Missing | Do not start tonight unless P0–P2 are green. |
| AI motion | `anim-ai-assist.js` returns stubs. | None. | Implemented as a stub. | Do not present it as motion. |
| Video annotation | `anim-video-annotator.js` marks frames. | None. | Implemented as a prototype. | Not a client feature. |
| Shoe | No PLY or mesh in the repo. | None. | Missing | Classify by file contents if a file appears. A Gaussian PLY is not a rig. |
| Founder gate | Client email list on Studio. Server id list on `canPublish` and `GET /founder/me`. | founder-auth 7/7; canPublish unit cases. | Unit-tested. Client gate is not the server check. Production not verified. | Malvin must set both lists. Do not apply from here. |
| Source bucket privacy | Proposed SQL only. | Not applied. | Blocked (must not run against production). | Manual step for Malvin. |
| Upload prefix on PUT and multipart | `assertUpload` on presign only. | upload-publish tests cover `assertUpload`, not the PUT route. | Missing on PUT and multipart. | Prefix-bind those routes in a later change. Not done in this audit. |
| CI runs animation tests | Workflow syntax-checks other modules. Hard-coded `/tmp` and `/workspace/artifacts` paths. | This audit's re-run, not CI. | Missing | Fix paths, install pinned deps, call the suite from the workflow, include this branch's PR target. |

## What this audit does not claim

No browser, phone, physics-in-Rapier, cloth, commercial-asset, or production success. The Animate button was not clicked. No GLB was loaded. No Supabase, R2, DNS, or Cloudflare change was made.
