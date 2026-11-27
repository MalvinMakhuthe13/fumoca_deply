# FUMOCA Interactive Product Assets — NIF extension v1

Status: first format-layer implementation; runtime integration is not yet complete.

## Goal

Allow a published NIF to carry a versioned, declarative description of interactive product props without modifying the source Gaussian environment. The Gaussian scene remains the photorealistic backdrop. Moving product parts are separate GLB/glTF scene objects with explicit transforms, bounds, collision proxies, animations, and allowlisted interaction rules.

This is the foundation for product experiences such as opening a bottle, lifting a lid, pouring liquid, inspecting shoe construction, or exploring a retail product.

## Compatibility and wire format

- Uses the already-reserved `CHUNK.INTERACTION` ID (`0x0600`).
- Payload is UTF-8 JSON in a RAW NIF chunk for the first implementation.
- Manifest schema version is `1`, independent of the NIF container version.
- NIF files without an INTERACTION chunk remain unchanged.
- Existing readers that ignore unknown chunk IDs can continue reading the visual NIF.
- The helper lives in `engine-next/format/NIFInteractiveSpec.js`; it does not modify `NIFSpec.js` or the production `js/modules/nif-format.js` decoder.

## Manifest shape

```json
{
  "schemaVersion": 1,
  "sceneId": "cola-demo",
  "coordinateSystem": {
    "units": "unknown",
    "upAxis": "Y",
    "handedness": "right",
    "calibrationStatus": "unknown"
  },
  "assets": [
    {
      "id": "cola-product",
      "storageKey": "interactive/cola/product.glb",
      "mimeType": "model/gltf-binary"
    },
    {
      "id": "cap-audio",
      "storageKey": "interactive/cola/cap-open.ogg",
      "mimeType": "audio/ogg"
    }
  ],
  "objects": [
    {
      "id": "bottle",
      "assetId": "cola-product",
      "nodePath": "Bottle",
      "role": "bottle",
      "transform": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "collision": { "type": "mesh" }
    },
    {
      "id": "cap",
      "assetId": "cola-product",
      "nodePath": "Cap",
      "parentObjectId": "bottle",
      "role": "bottle-cap",
      "transform": {
        "position": [0, 0.12, 0],
        "rotation": [0, 0, 0, 1],
        "scale": [1, 1, 1]
      },
      "collision": { "type": "capsule" }
    }
  ],
  "zones": [
    {
      "id": "cap-grip",
      "shape": "sphere",
      "objectId": "cap",
      "transform": { "position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1] },
      "radius": 0.04
    }
  ],
  "animations": [
    {
      "id": "unscrew-cap",
      "objectId": "cap",
      "kind": "gltf_clip",
      "clipName": "UnscrewCap",
      "durationMs": 900
    }
  ],
  "interactions": [
    {
      "id": "open-bottle",
      "sourceObjectId": "cap",
      "event": "tap",
      "targetZoneId": "cap-grip",
      "actions": [
        { "type": "play_animation", "animationId": "unscrew-cap" },
        { "type": "play_audio", "assetId": "cap-audio", "volume": 0.7 }
      ]
    }
  ]
}
```

The example is a schema illustration, not a supplied or dimensionally validated Coca-Cola model. The coordinate system deliberately says `unknown`; no metric scale should be inferred until calibration is verified.

## Supported v1 data

- Coordinate frame: units, up-axis, handedness, calibration status.
- Assets: approved relative storage keys, GLB/glTF and audio MIME types, optional SHA-256 and byte length.
- Objects: stable IDs, semantic roles, glTF node paths, parent relationships, transforms and collision proxy declarations.
- Zones: box/sphere trigger regions.
- Animations: glTF clips or transform animations.
- Events: tap, press, drag, pickup/drop, zone entry/exit, animation completion.
- Conditions: object state, zone containment, all/any combinations.
- Actions: play animation, visibility, transform, state, attach/release, hint, audio and scene load.

## Security and validation

`validateInteractiveManifest()` rejects unsupported schema versions, unknown fields, duplicate IDs, unresolved references, unsafe asset paths, unsupported MIME types, invalid transforms, invalid event/action types, and invalid action references.

No uploaded manifest can contain executable JavaScript, callbacks, arbitrary URLs, or unrestricted network requests. Asset keys must be resolved by the application through its own authenticated storage layer.

The encoder enforces a 2 MiB manifest limit. The decoder validates the chunk type, parses JSON, and validates the resulting manifest before returning it.

## Important implementation boundary

This commit adds the format-layer encoder, decoder, and validator only. It does **not** yet:
- add INTERACTION chunk extraction to the production NIF loader;
- resolve storage keys into authenticated asset URLs;
- load GLB assets into the production Spark/Three.js viewer;
- add picking, grabbing, physics, or product animation playback;
- write edited manifests back through the production publish flow.

Those are subsequent integration steps. The first runtime should use a separate Three.js prop layer synchronized with the production viewer camera; it must not mutate the environment splat. The current engine-next hinge/slide animator remains a prototype and must not be treated as the production product-animation runtime.
