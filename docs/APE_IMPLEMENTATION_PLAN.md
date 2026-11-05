# FUMOCA Adaptive Presentation Engine (APE)

Status: APE/UCE foundation and hotspot coordinate adapter integrated; browser/device QA pending
Branch: `ape-foundation-2026-11-05`

## Product contract

A published FUMOCA experience is authored once and presented consistently across desktop, tablet, mobile, and arbitrary website embed containers. The scene remains inside its allocated frame; camera interaction never moves or resizes the surrounding page.

## APE responsibilities

1. **Composition** — preserve authored poster aspect ratio, crop, subject placement, typography, and overlay positions.
2. **Container adaptation** — size the renderer from its actual host element, not only the browser viewport.
3. **Camera presets** — persist initial framing, target, orientation, zoom, and framing padding with the published experience.
4. **Interaction** — rotate, pan, and zoom within the scene viewport, with touch and pointer input behaving consistently.
5. **Embed isolation** — prevent overflow, accidental page scrolling, layout shifts, and controls escaping the embed frame.
6. **Device budgets** — adapt pixel ratio and rendering quality without changing the authored composition.

## Initial implementation

The Spark public-viewer bridge now accepts an optional `presentation` object:

| Setting | Meaning | Default |
|---|---|---:|
| `framePadding` | Camera framing margin multiplier | 1.55 |
| `initialZoom` | Initial zoom multiplier; values above 1 are closer | 1 |
| `minZoom` | Optional minimum zoom multiplier | unrestricted |
| `maxZoom` | Optional maximum zoom multiplier | unrestricted |
| `dampingFactor` | Orbit damping | 0.08 |
| `maxDpr` | Maximum device pixel ratio | 2 |

The bridge now fits against the narrower horizontal/vertical field of view, observes the actual host element with ResizeObserver, and re-fits only until the visitor begins changing the camera.

## Implemented in this branch

- Shared APE configuration reads validated URL preview overrides and persisted NIF metadata (`meta.presentation` or `meta.ape_presentation`).
- Public viewer applies host sizing and ResizeObserver updates to the Spark companion PLY, legacy PLY, solid mesh overlay, and the primary Gaussian viewer when its renderer/camera are exposed.
- Renderer pixel ratio is capped; camera aspect and drawing-buffer dimensions follow the actual host element.
- Camera framing/zoom settings and zoom bounds are applied to the Spark companion path; public API `window.FumocaAPE.getSettings()` exposes the active settings for integration/testing.
- Ad embed now defaults to responsive 100% width and 16:9 aspect ratio, accepts explicit aspect ratio or fixed height, and observes its host container for resizes.
- Publish panel exposes poster/embed ratio, initial zoom and frame-padding controls; publish persists the validated settings to `meta.presentation`.
- Ad Studio now has a responsive preview simulator with desktop/tablet/mobile width presets and 16:9, 1:1, 4:5, and 9:16 aspect ratios. It fits the selected frame inside the available preview area without distorting the ratio.
- UCE v1 now publishes a canonical normalized composition plane (top-left origin, safe area, contain fit, clipped overflow and responsive host sizing).
- APE Composition Layers supports adding and dragging text and local image artwork in the editor preview, with normalized x/y coordinates, selection/deletion, selected-layer width resizing, forward/backward stacking order, and editable text size, colour, and alignment.
- Publish uploads local image artwork through the existing `r2.from('nif-files').upload()` worker-backed client and stores durable asset references; Base64 data URLs are not persisted in NIF metadata. The data-URL MIME detector is syntax-corrected. Text typography settings are validated and persisted.
- Public viewer renders published text and image composition layers as display-only presentation overlays, including saved text size, colour, and alignment. Typography now scales against the composition container (not the browser viewport), so the same authored type proportions survive responsive embeds and device widths; Studio preview uses the same sizing rule.
- Composition overlays establish their own inline-size query container. Text sizes remain authored in the existing 12–72 design scale and are rendered proportionally at 0.1% of composition width, with a small-screen readability floor and a 72px ceiling. The Studio font-size slider reapplies this responsive rule immediately (rather than temporarily overriding it with fixed pixels); image artwork is capped to 80% of the composition height in both Studio and the public viewer.
- Hotspot Pro adds a versioned normalized `compositionAnchor` (`u`/`v`, top-left origin) while retaining legacy `x`/`y` percentages and all world-space anchor fields.
- Legacy screen-only hotspots are upgraded through an explicit adapter at load/render time; original percentage fields remain intact for older clients.
- Both Hotspot Pro and the fallback viewer hotspot renderer map normalized anchors through the actual viewer-stage rectangle into the overlay layer, avoiding viewport-vs-stage coordinate drift. In management mode, screen-anchored hotspots can be dragged directly on the stage and saved; world-anchored hotspots retain their 3D projection and are not silently converted to screen anchors.
- Main reconstruction editor (`edit.html`, Present tab) now exposes APE controls for aspect ratio, live camera zoom, and frame breathing room. The framing sliders update the active editor camera while preserving its look direction and target; changing aspect ratio does not snap or rotate the camera.
- The editor maintains a presentation draft on `window._fumocaApePresentationDraft`; the publish panel initializes from that draft and the publish module merges it into the saved `meta.presentation`.
- Viewer reads presentation presets from either the NIF `meta` or `metadata` JSON column shape.
- Embed Manager now generates a responsive wrapper/iframe snippet using the saved presentation aspect ratio, with optional fixed height.

## Required next integration steps

- Extend APE settings beyond the publish panel with live Studio preview and an update-existing-publication workflow.
- Add browser-level verification for durable R2 artwork upload, public-viewer layer rendering, layer resizing/order persistence, and failure/retry behavior.
- Add public-viewer editing only if a concrete creator workflow requires it; published layers are currently display-only.
- Add direct stage placement/editing for new screen-space hotspots and verify drag-save behaviour; world-space anchors must remain projected from 3D and must not be overwritten by screen coordinates.
- Add browser-level checks for responsive iframe snippets, host resizing, camera preservation and touch interactions.
- Audit showroom and public viewer CSS for viewport-fixed assumptions and nested iframe overflow.
- Verify all render paths in real browsers and devices; this branch has not yet undergone browser/device QA.

## Acceptance matrix

Test at minimum:

- 1440×900 desktop, 1024×768 tablet, 390×844 mobile.
- Wide (16:9), square (1:1), portrait (4:5 and 9:16) compositions.
- Full-page viewer, narrow 50%-width column, responsive iframe, and fixed-height iframe.
- Mouse drag, touch drag, pinch zoom, wheel zoom, keyboard focus, and hotspot interaction.
- Resize the host container without reloading; subject remains fully framed before user interaction.
- After user interaction, container resize must preserve the visitor's camera state.
- No horizontal/vertical page overflow, no unexpected layout shift, no controls clipped by the host.

## Non-goals for this phase

Animation authoring and timeline work remain paused. APE is a presentation and interaction layer, not a replacement renderer or a separate scene format.
