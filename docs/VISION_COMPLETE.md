# FUMOCA — Complete product vision (one system, not ten apps)

You are not overcomplicating this. These are **one interaction layer** on the same capture:

| Layer | What the user feels |
|-------|---------------------|
| **Look** | Rotate, zoom, explore — better than a 2D product photo |
| **Read** | Magazine / lock-screen words that sit *behind* the subject |
| **Hear** | Music bed + engine, door, ambient sounds on the scene |
| **Act** | Click → doors open, lights on, colour change, open link, play sound |
| **Present** | Slides + speaker notes for sales meetings |
| **Embed / Ad** | Same file on a site or in an ad — interactive product, not a flat image |
| **NIF** | One portable file that can carry all of the above |

## Money loop (GPU on your machine)

```
Interactive product embeds & ads
        ↓
  Attention + conversions
        ↓
  Revenue
        ↓
  Local GPU (not only Kaggle)
        ↓
  Faster NIF / mesh / print for clients
```

Ads and online product viewers are not a side quest — they fund the infrastructure that makes the format world-class.

## Interaction model (keep it simple)

Everything interactive is a **hotspot** or a **scene action**:

- **Hotspot** — pin on the 3D subject (door handle, headlight, price tag)
- **Action types** — already in `hotspot-actions.js`:
  - `audio` / `audio_stop`
  - `link`, `info`, `video`
  - `nested_splat` (e.g. interior)
  - `fly` (camera)
  - `state` (doors, lights, materials — configurator)
  - `multi` (sequence: sound + door + light)

**Doors / lights** = `state` actions the viewer understands:
`{ type: 'state', key: 'door_fl', value: 'open' }`  
`{ type: 'state', key: 'lights', value: 'on' }`

The renderer or a small animation layer listens for `fumoca:state` events. No separate “car app” required.

## Sound on NIF / splat

- **Scene bed** — optional loop (showroom music, ambient)
- **One-shots** — tied to hotspots (door, engine, click)
- Stored as URLs in metadata / NIF audio chunk; played in embed + present + viewer

## Magazine + melting words

Same depth trick as iPhone lock screen:
1. Draw large type
2. Draw subject with transparent background on top  
→ words sit *behind* the car / person / product  

Used in: Break the frame, magazine cover, lock-screen export, optional in-viewer title mode.

## What ships where

| Feature | Surface |
|---------|---------|
| Orbit / zoom product | Viewer, embed, present |
| Hotspots + doors/lights/sound | Viewer + embed |
| Scene music | Viewer + embed + present |
| Magazine / depth text | Studio export + magazine-cover |
| Speaker notes | `present.html` |
| Ads / interactive creative | `ad-studio`, embed player |
| Portable package | **NIF** |

## Rule against complexity

- One capture pipeline  
- One interaction schema (hotspots + state)  
- One social embed chrome  
- One presentation mode  
- One format (NIF)  

New ideas must attach to these, not invent a parallel product.


## Walkthroughs (vs Matterport)

- **Space graph**: exterior ↔ rooms or car cabin/boot  
- **Portals**: click “Enter” → fade → load interior capture  
- **Same interaction layer**: open doors, lights, sound *inside* each space  
- Module: `js/modules/walkthrough.js` · Doc: `docs/WALKTHROUGH.md`
