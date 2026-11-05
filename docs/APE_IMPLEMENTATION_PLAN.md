# FUMOCA Adaptive Presentation Engine (APE)

Status: foundation in progress
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

## Required next integration steps

- Find and verify the production Spark bridge mount callsite; pass the published presentation settings into it.
- Define and validate a versioned presentation-settings schema in the publish metadata.
- Wire Studio controls for aspect ratio, default framing, initial zoom, zoom bounds, and interaction sensitivity.
- Ensure poster typography, hotspots, and interactive overlays share the same normalized composition coordinate system.
- Generate embed snippets with responsive width and an explicit aspect-ratio container; support a fixed-height option.
- Audit showroom and public viewer CSS for viewport-fixed assumptions and nested iframe overflow.
- Verify that the embed never changes the host page's scroll position or dimensions.

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
