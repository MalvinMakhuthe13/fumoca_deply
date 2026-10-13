# FUMOCA Studio — Product Vision (Client-Ready)

**One sentence:**  
FUMOCA Studio is the place you clean, repair, mesh, path, and ship spatial captures — Gaussian splats, NIF, LiDAR, and print — without juggling five different apps.

---

## Why this exists

Clients (dealerships, property, events, inspection) need:

1. **Great results from imperfect capture** — limited photos/video, not a perfect 360 rig every time  
2. **Depth that feels real** — not flat “point cloud wallpaper”  
3. **Camera control** — fixed hero angles + guided capture paths  
4. **LiDAR when they have it** — not a separate pipeline  
5. **Print-ready meshes** — holes filled, watertight, detailed  
6. **One brandable format (NIF)** — portable, not locked to a single viewer  

We take inspiration from SuperSplat (cleanup), Kiri Engine (scan → useful asset), Blender (camera/path/authoring), and CloudCompare (point-cloud rigor) — but the product is **one calm studio**, not a pile of tools.

---

## Studio modes (mental model)

| Mode | Job | Feels like |
|------|-----|------------|
| **Navigate** | Orbit, pan, zoom, inspect | Viewer |
| **Select & Edit** | Box/lasso/brush, paint, transform | SuperSplat |
| **Clean & Repair** | Floaters, noise, gap/hole fill, sparse boost | CloudCompare + AI clean |
| **Mesh & Print** | Extract mesh, fill holes, hollow, STL/export | Kiri + print pipeline |
| **Present** | Camera bookmarks, paths, hotspots | Blender camera + share |
| **Capture Guide** | Custom angles for the next shoot | Capture UI |
| **Export** | .splat / .ply / .nif / print pack | Format layer |

Toolbar stays short. Heavy options live in the left panel for the **active mode only**.

---

## Differentiating capabilities

### 1. Limited imagery → strong depth
Sparse / short video still goes through:
- Subject isolation + floater removal  
- Gap fill (local density + neighbour propagation)  
- Optional depth-refine pass before NIF encode  

### 2. LiDAR-aware
Import PLY / XYZ / (worker) LAS·LAZ, align to existing splat, merge or replace density for solid surfaces.

### 3. Camera angles as first-class data
Named bookmarks + ordered paths:
- Drive the **viewer** (cinematic reveal)  
- Drive the **capture guide** (phone shows next angle)  
- Export with the asset (NIF presentation chunk)

### 4. Print with detail
Gaussian → density field → mesh → hole fill → smooth → hollow → STL, with quality presets (figurine / product / large).

### 5. NIF as the “PDF of space”
One file: visual field + optional mesh + paths + print pack. Readers free; encoder is the product.

---

## What we deliberately do *not* do

- Clone Blender’s full node graph in the browser  
- Promise photogrammetry miracles from 3 blurry photos  
- Ship every experimental `engine-next` flag into the live toolbar  

Ship **modes that work**, hide advanced until loaded.

---

## Implementation status

| Piece | Status |
|-------|--------|
| Core edit tools (select, brush, transform, clean) | Live in `edit.html` |
| Quality pipeline / gap filler / mesh UI modules | Present under `js/modules/` |
| Studio modes shell | `js/modules/studio-modes.js` |
| LiDAR import (PLY/XYZ) | `js/modules/lidar-import.js` |
| Camera paths / bookmarks | `js/modules/camera-paths.js` |
| Mesh & print prep panel logic | `js/modules/studio-mesh-print.js` |
| Sparse quality boost | `js/modules/sparse-quality.js` |
| NIF print pipeline (GPU) | `engine-next/print/` (worker) |
| Full LAS/LAZ in-browser | Later (worker or WASM) |

---

## Client pitch (short)

> “Shoot on a phone. Drop LiDAR if you have it. Clean, fill, mesh, set the hero angles, export NIF or print — one studio. Built for cars, property, and events in real markets, not demo reels only.”
