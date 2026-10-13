# Walkthroughs — outside, inside, openable

## Goal
Match and beat Matterport-style tours for **property** and **vehicles**:

- Walk **outside** the building / car  
- **Enter** through a door (portal)  
- Explore **rooms** or **cabin / boot** as full spatial captures  
- **Open** doors, lights, storage via hotspots (same interaction layer)  
- Still embeddable, presentable, and ad-ready  

## How FUMOCA differs from Matterport

| | Typical Matterport | FUMOCA |
|--|-------------------|--------|
| Capture | Pro camera / specialized | Phone video → splat / NIF (+ optional LiDAR) |
| Look | Mesh dollhouse | Gaussian / NIF depth & realism |
| Inside car | Rare | First-class (exterior ↔ cabin ↔ boot) |
| Interactions | Limited | Doors, lights, sound, links, nested spaces |
| Format | Proprietary cloud | **NIF** portable + social embed |
| Commerce | Listing-oriented | Ads, product pages, presentations |

## Data: space graph

```json
{
  "walkthrough": {
    "start": "ext",
    "spaces": [
      { "id": "ext", "label": "Exterior", "splatId": "…", "kind": "exterior" },
      { "id": "living", "label": "Living", "splatId": "…", "kind": "room" }
    ],
    "portals": [
      { "id": "p1", "from": "ext", "to": "living", "label": "Enter home", "x": 48, "y": 52 }
    ]
  }
}
```

Module: `js/modules/walkthrough.js`  
Templates: `propertyWalkthroughTemplate`, `vehicleWalkthroughTemplate`

## Capture recipe

**House**
1. Exterior walk (full facade + entrance)  
2. Each important room as its own capture (or linked NIF later)  
3. Portal on the front door → living room splatId  
4. Exit portal back to exterior  

**Car**
1. Exterior orbit  
2. Cabin capture (seats, dash)  
3. Optional boot  
4. Portals: “Step inside” / “Open boot”  
5. Hotspots: door open sound + state, lights, engine  

## Viewer behaviour
1. Load graph from `metadata.walkthrough`  
2. Show enter/exit hotspots for current space  
3. On traverse: short fade → load target splat → fade in  
4. State interactions (doors/lights) still work *inside* each space  

## Studio
Seed graphs via templates; place portal pins; publish metadata with the listing.
