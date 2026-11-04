# FUMOCA Interactive Reality Engine

Status: architecture specification and isolated implementation plan  
Branch: `feature/interactive-reality-engine`

## Product goal

Turn a published FUMOCA reconstruction into a browser-playable interactive experience. A viewer must be able to explore a captured environment, pick up separate objects, use them on other objects, trigger animations, and move between scenes. Desktop and mobile are first-class inputs.

## Non-negotiable compatibility rules

1. Do not replace, mutate, or reprocess the source Gaussian splat to animate an interactive prop.
2. Keep the current production viewer, Studio, reconstruction pipeline, NIF uploads, publishing flow, and existing share/showroom behaviour working.
3. Treat the environment splat as the visual backdrop. Interactive moving parts are separate scene objects (prefer glTF/GLB for articulated assets; simple primitives only for prototypes).
4. Keep all interaction content optional and versioned. A NIF without an interaction manifest must render exactly as it does today.
5. Do not claim physical accuracy from an uncalibrated splat. Interaction collision geometry must be authored or derived from an explicitly identified proxy/collision mesh.
6. No arbitrary executable JavaScript from uploaded scenes. Persist declarative, schema-validated actions and allowlisted action types only.

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

### 4. Input abstraction

One input layer maps desktop and mobile gestures into the same semantic events:
- Desktop: mouse hover/click/drag; WASD + pointer-lock look as an optional navigation mode.
- Mobile: tap, long-press, drag, pinch zoom, and one-finger look/navigation where appropriate.
- Accessibility: keyboard focus, visible focus states, labels, and non-drag alternatives for essential actions.

The interaction system must not steal pointer events from existing viewer controls unless an interactive target has captured the gesture. Provide an explicit interaction/navigation mode policy.

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

## Test and acceptance criteria

### Unit tests
- manifest schema rejects unknown action types and executable script fields;
- invalid/missing asset references fail safely;
- state machine only permits declared transitions;
- trigger zone matching is stable at boundary conditions;
- animation interpolation handles start, midpoint, completion, and cancellation;
- scene serialization round-trips without losing IDs or transforms.

### Browser tests
- no interaction manifest: existing viewer behaviour is unchanged;
- interaction manifest: key can be picked up and released on desktop and touch;
- invalid drop does not unlock the door;
- valid drop triggers the animation sequence exactly once;
- camera navigation still works when not dragging an interactive object;
- resize, scene reload, and teardown do not leave listeners, render loops, or GPU assets behind;
- reduced-motion preference and keyboard alternatives are respected.

### Performance targets
- keep the existing Gaussian render path untouched;
- lazy-load interaction assets only when the experience starts;
- cap interactive asset texture sizes by device tier;
- avoid per-frame allocations in raycast/interaction hot paths;
- provide a reduced interaction mode for low-memory mobile devices.

## Delivery phases

A. Contract + manifest schema + validators + unit tests.  
B. Runtime adapter against the existing viewer without changing its render path.  
C. Pick-up/drop interaction with a primitive key and target zone.  
D. GLB key/door assets, hinge animation, audio and scene transition.  
E. Creator UI to place objects, define zones, connect events/actions, preview and publish.  
F. Mobile/desktop QA, accessibility, performance and backward-compatibility regression.

## Explicitly out of scope for the first slice

- animating arbitrary Gaussian splats as deformable meshes;
- general-purpose multiplayer;
- unrestricted user scripts;
- full game-engine physics;
- changing the reconstruction pipeline or the existing NIF format without a separate migration proposal.
