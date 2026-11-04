# FUMOCA Interactive Reality Engine

Status: architecture specification and implementation direction  
Branch: `feature/interactive-reality-engine`

## Product north star

**Don't just reconstruct reality. Make reality interactive.**

FUMOCA is moving from 3D viewing to interactive world experiences. Every new architecture and product decision must be evaluated against these five non-negotiable principles:

1. **Enter, don't observe.** Users should feel physically present inside reconstructed environments.
2. **Move freely.** Do not depend on fixed viewpoints, orbit-only controls, or 360-degree camera rotation. Support first-person navigation through the environment.
3. **Interact naturally.** Users should be able to pick up, move, open, inspect, operate, and manipulate objects where the scene supports those actions.
4. **Preserve realism.** Gaussian splats remain central to the photorealistic environment. Do not sacrifice their rendering quality to add interaction.
5. **Make worlds playable.** Creators should be able to build interactive stories, simulations, advertisements, and experiences through no-code authoring tools.

The same foundation should support property, automotive, retail, tourism, mining, training, and entertainment. These are product verticals on a shared engine, not separate incompatible viewers.

## Product capabilities

FUMOCA has two complementary experience modes:

- **Explore mode:** enter and freely navigate an interactive reconstructed world.
- **SceneFlow mode:** watch a cinematic video, enter the corresponding interactive world at authored pause points, interact, and return to the story.

A user must never be forced into a conventional orbit viewer or a separate disconnected product viewer to complete these experiences.

## SceneFlow: cinematic-to-interactive orchestration

SceneFlow coordinates filmed video and a prepared interactive 3D scene. It is a first-class capability alongside free-roam exploration, not a replacement for the Interactive Reality Engine.

### Core sequence

1. Play the authored video normally, including its audio.
2. At a configured timeline cue, pause or transition out of the video.
3. Hand control to the spatially aligned interactive scene.
4. Allow first-person navigation and authored interactions.
5. When the user chooses to continue, or a configured completion condition is met, restore a defined return state.
6. Resume the video at its configured continuation timestamp and continue the story.

### SceneFlow cue data

Each cue should be declarative and versioned. Proposed fields include:

- stable cue ID and timeline timestamp or time range;
- entry transition style and duration;
- interactive scene/NIF reference;
- camera pose and coordinate-frame mapping at handover;
- video-to-scene alignment metadata and calibration confidence;
- entry and return states;
- exit policy: user-controlled, objective-completed, timeout only where appropriate;
- resume timestamp or authored continuation point;
- optional interaction completion conditions;
- fallback behaviour if the interactive scene or assets fail to load.

### Transition quality

Support at least two authored transition styles:

- **Direct handover:** freeze/cut at the video cue and enter the matched 3D scene.
- **Cinematic handover:** use a dissolve, camera move, foreground wipe, or other transition to conceal differences between filmed and reconstructed media.

The system must not promise a seamless match unless camera pose, timing, geometry, scale, lighting, and scene alignment have been validated. If exact alignment is unavailable, use an intentional transition rather than a visibly incorrect match.

### Media and state rules

- Preserve original video/audio timing and provide deterministic pause/resume behaviour.
- Keep user interaction state during the interactive interval.
- Make exit explicit and predictable; do not unexpectedly resume while the user is interacting.
- Handle loading delays, buffering, browser autoplay restrictions, tab suspension, and failed assets.
- Keep SceneFlow optional. Existing NIFs and ordinary video playback must continue to work without it.
- Store video references and approved asset keys, not arbitrary executable scripts or unrestricted remote requests.
- Provide web-link/embed delivery as the reliable interactive destination. Social platforms may host or distribute the teaser/video/link, but must not be assumed to support arbitrary embedded FUMOCA 3D runtime code inside native feed players.

## Non-negotiable compatibility rules

1. Do not replace, mutate, or reprocess the source Gaussian splat to animate an interactive prop.
2. Keep the current production viewer, Studio, reconstruction pipeline, NIF uploads, publishing flow, and existing share/showroom behaviour working.
3. Treat the environment splat as the visual backdrop. Interactive moving parts are separate scene objects (prefer glTF/GLB for articulated assets; simple primitives only for prototypes).
4. Keep all interaction content optional and versioned. A NIF without an interaction manifest must render exactly as it does today.
5. Do not claim physical accuracy from an uncalibrated splat. Interaction collision geometry must be authored or derived from an explicitly identified proxy/collision mesh.
6. No arbitrary executable JavaScript from uploaded scenes. Persist declarative, schema-validated actions and allowlisted action types only.
7. Do not regress the Gaussian renderer's visual fidelity, navigation freedom, or performance in order to add SceneFlow or interactions.

## Runtime architecture

### 1. Environment renderer adapter

The existing Spark viewer remains responsible for rendering the Gaussian environment. The interactive runtime attaches to the same Three.js scene/camera/render loop through a small adapter, or uses a synchronized transparent overlay scene if direct attachment is not supported by the current Spark version.

The adapter must expose:
- active camera and renderer dimensions;
- pointer/touch coordinates converted to normalized device coordinates;
- a raycast entry point;
- frame tick and resize hooks;
- scene teardown/disposal.

The adapter must not reach into private Spark internals. If a public scene/camera integration is unavailable, use a separate Three.js overlay renderer with a shared camera transform and depth/occlusion limitations documented.

### 2. Interactive object layer

Moving objects are separate Three.js objects loaded from GLB/glTF or generated primitives. Each object has:
- stable ID and semantic role (for example `key`, `door`, `lock`);
- transform and optional parent;
- interaction bounds / raycast targets;
- optional collision proxy;
- visibility and interaction-enabled state;
- declared animation clips or transform keyframes.

The static door visible in the splat may remain part of the environment. For a convincing opening interaction, the moving door leaf must be a separate captured/modelled asset aligned to the opening. Do not attempt to rotate the baked door pixels/Gaussians.

### 3. Interaction state machine

Initial supported states:
- `idle`
- `hovered`
- `picked_up`
- `target_valid`
- `animating`
- `completed`
- `cancelled`

Initial allowlisted events:
- `pointer_enter`, `pointer_leave`
- `tap`, `press_start`, `press_move`, `press_end`
- `object_picked_up`, `object_dropped`
- `entered_zone`, `left_zone`
- `animation_completed`
- `scene_transition_requested`

Initial allowlisted actions:
- `set_visibility`
- `set_transform`
- `play_animation`
- `set_state`
- `attach_to_hand`
- `release_object`
- `show_hint`
- `play_audio`
- `load_scene`

Actions are declarative JSON, validated against a versioned schema. Scene files cannot provide eval-able code, arbitrary URLs, or unrestricted network requests.

### 4. Input abstraction and locomotion

One input layer maps desktop and mobile gestures into the same semantic events:
- Desktop: mouse hover/click/drag; WASD + pointer-lock look as an optional navigation mode.
- Mobile: tap, long-press, drag, pinch zoom, and touch-based look/navigation where appropriate.
- Accessibility: keyboard focus, visible focus states, labels, and non-drag alternatives for essential actions.

Free-roam navigation is a core requirement, not an optional orbit-control variant. Provide collision-aware movement where valid collision proxies exist, sensible fallback movement where they do not, and clear handling of scene boundaries. The interaction system must not steal pointer events from existing viewer controls unless an interactive target has captured the gesture. Provide an explicit interaction/navigation mode policy.

### 5. Spatial alignment and physics

A scene manifest defines the relationship between the reconstructed environment coordinate frame and the prop coordinate frame. Include units, up-axis, origin, transform, and calibration status.

For the first milestone, use raycasting and trigger volumes rather than a full rigid-body simulation. Add physics only where required:
- collision proxies, not the Gaussian cloud itself;
- deterministic fixed-step updates;
- bounded object motion and safe fallback if collision data is absent;
- no assumption that splat-derived dimensions are metric unless calibrated.

### 6. Scene manifest (proposed v1)

The manifest is JSON data stored alongside the NIF/presentation record and references assets by approved storage keys.

Top-level fields:
- `schemaVersion`
- `sceneId`
- `environment` (NIF reference and coordinate metadata)
- `assets[]` (GLB references, hashes, MIME type)
- `objects[]` (IDs, asset refs, transforms, semantic tags, bounds)
- `zones[]` (target object, shape, transform, acceptance rules)
- `animations[]` (object ID, clip/keyframes, duration, easing)
- `interactions[]` (source, event, condition, allowlisted actions)
- `scenes[]` / `transitions[]`
- `sceneFlow` (optional video reference, timeline cues, alignment, entry/exit and resume policies)

Every referenced asset must be checked for ownership/access and content type before loading. Validate sizes and schema before runtime.

## First vertical slice: key unlocks house door

1. Load an existing published house splat unchanged.
2. Add a separate key GLB and a separate door-leaf GLB (or a clearly labelled proxy for initial testing).
3. Author a lock target zone and door hinge pivot.
4. Let desktop and mobile users pick up the key.
5. When the key enters the lock zone with the correct orientation, transition the lock state from locked to unlocked.
6. Play key-turn, handle-turn, and door-swing animations in sequence.
7. Reveal or load the next room/scene after the door reaches its open state.
8. Support reset/replay and a clear hint if the user cannot find the key.

## SceneFlow vertical slice: showroom car story

1. Play a short showroom video of a car entering and stopping.
2. At a defined cue, pause the video and enter a prepared, aligned showroom NIF scene.
3. Allow the user to walk freely around the car and interact with separately authored assets such as doors, handles, and interior controls.
4. Preserve interaction state and provide an explicit continue/exit action.
5. Return to a defined camera/continuation state and resume the video with the car leaving the showroom.
6. Test direct and cinematic handovers, including an intentionally imperfect-alignment fallback.

This slice validates the media timeline, scene alignment, free navigation, interaction runtime, and return-to-story experience together.

## Creator experience requirement

Creators must ultimately be able to build these experiences without writing code. The authoring workflow should provide:
- timeline with video preview and cue placement;
- scene/NIF assignment for each cue;
- camera/coordinate alignment tools and calibration status;
- drag-and-drop asset placement;
- object bounds, interaction zones, and animation configuration;
- visual event/condition/action connections using allowlisted blocks;
- preview as viewer and creator;
- validation, publish, versioning, and rollback.

No-code authoring is a product requirement, but the runtime schema remains declarative and secure. The first implementation may use developer-authored manifests while the creator UI is built in a later phase.

## Test and acceptance criteria

### Unit tests
- manifest schema rejects unknown action types and executable script fields;
- invalid/missing asset references fail safely;
- state machine only permits declared transitions;
- trigger zone matching is stable at boundary conditions;
- animation interpolation handles start, midpoint, completion, and cancellation;
- scene serialization round-trips without losing IDs or transforms;
- SceneFlow cue validation rejects invalid timestamps, missing scene refs, and invalid resume policies;
- media controller handles pause, entry, exit, and resume deterministically.

### Browser tests
- no interaction manifest: existing viewer behaviour is unchanged;
- interaction manifest: key can be picked up and released on desktop and touch;
- invalid drop does not unlock the door;
- valid drop triggers the animation sequence exactly once;
- camera navigation still works when not dragging an interactive object;
- SceneFlow pauses at its cue, enters the correct scene, exits on request, and resumes at the configured point;
- failed scene loading leaves the video recoverable and does not strand the user;
- resize, scene reload, and teardown do not leave listeners, render loops, or GPU assets behind;
- reduced-motion preference and keyboard alternatives are respected.

### Performance targets

- keep the existing Gaussian render path untouched;
- lazy-load interaction assets only when the experience starts;
- cap interactive asset texture sizes by device tier;
- avoid per-frame allocations in raycast/interaction hot paths;
- provide a reduced interaction mode for low-memory mobile devices;
- avoid loading interactive scenes before their timeline cues unless preloading is explicitly configured and memory permits.

## Delivery phases

A. Contract + manifest schema + validators + unit tests.  
B. Runtime adapter against the existing viewer without changing its render path.  
C. Pick-up/drop interaction with a primitive key and target zone.  
D. GLB key/door assets, hinge animation, audio and scene transition.  
E. SceneFlow timeline/cue contract and deterministic video pause/enter/exit/resume controller.  
F. Showroom car video-to-world-to-video vertical slice.  
G. Creator UI to place objects, define zones, connect events/actions, author SceneFlow cues, preview and publish.  
H. Mobile/desktop QA, accessibility, performance and backward-compatibility regression.

## Explicitly out of scope for the first slice

- animating arbitrary Gaussian splats as deformable meshes;
- general-purpose multiplayer;
- unrestricted user scripts;
- full game-engine physics;
- changing the reconstruction pipeline or the existing NIF format without a separate migration proposal.
