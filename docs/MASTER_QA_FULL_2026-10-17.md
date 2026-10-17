# FUMOCA Master QA / QC — Full App (2026-10-17)

Scope: every major route, Studio tools, LiDAR, mesh/print, image→3D, frames, viewer interactions, social surfaces.  
Repo size sampled: **~308 tracked files**. Live extensionless routes mostly **200**.

Legend: **PASS** works as shipped · **PARTIAL** real UI/code but limited · **STUB** honest scaffold · **GAP** missing for “client-ready” claim

---

## 1. App shell & routes

| Route | Live | Role | Verdict |
|-------|------|------|---------|
| `/` index | 308→site | Marketing / CTA | PASS (footer Privacy/Terms/Investors marked unavailable — correct honesty) |
| `/edit` | 200 | Main Studio | PASS core; see §2 |
| `/viewer` | 200 | Product viewer + interactions | PASS core |
| `/viewer-core` | 200 | Lean share viewer | PASS |
| `/present` | 200 | Presentation mode | PARTIAL (needs splatId/nifId) |
| `/feed` | 200 | Social feed | PASS path; content depends on Supabase/R2 |
| `/upload` | 200 | Upload pipeline | PASS path |
| `/capture` | 200 | Capture flow | PARTIAL (Start disabled until ready) |
| `/capture-vehicle` | 200 | Vehicle capture | PARTIAL |
| `/convert` | 200 | File format convert | PASS UI |
| `/image-to-splat` | 200 | Photos → plan/package | **STUB engine** (explicit) |
| `/magazine-cover` | 200 | Magazine layout + embed | PARTIAL |
| `/media-edit` | 200 | Media/captions | PARTIAL (some buttons disabled by design) |
| `/showroom` | 200 | Showroom | PASS path |
| `/ad-studio` `/ad-preview` | 200 | Ads | PARTIAL |
| `/login` `/signup` `/profile` `/settings` `/notifications` | 200 | Auth/account | PASS path (needs real config.js) |
| `/open` | 200 | Open .fumoc | PASS path |
| `/embed` | 200 | Social embed player | PASS path |
| `/splat-edit-engine` | 200 | Alternate editor entry | PARTIAL / overlap with edit |
| `/preflight` `/scene` `/public-preview` | 200 | Support | PASS path |

**Note:** Many `*.html` URLs return **308** → extensionless. That is fine if SPA/Pages rules are intentional.

---

## 2. Studio (`edit.html`) — buttons & tools

### 2.1 Core load / view
| Control | Verdict | Notes |
|---------|---------|--------|
| Open / file input | PASS | Accept `.ply .splat .nif` |
| Drop zone | PASS | |
| Orbit / zoom / pan | PASS | Polar limits loosened in QA pack |
| Photoreal toggle | PASS | Auto-tries ON after load; quality ≠ SuperSplat |
| Point / blob display | PASS | White dots when photoreal off or weak vertex colour |
| Grid + axes | PASS | Array-safe materials |
| Transform gizmo | PASS | Needs selection or subject layer (getHelper fixed) |
| Undo / Redo | PASS path | History stack present |
| Compare / Capture / Export / Publish | PASS path | Publish needs auth + R2 |

### 2.2 Select / clean / paint
| Control | Verdict |
|---------|---------|
| Box / lasso / brush erase / paint | PASS path |
| Delete selected / invert / expand-shrink | PASS path |
| AI clean modules | PARTIAL | Scripts loaded; results vary by cloud |

### 2.3 Multi-splat / layers
| Feature | Verdict |
|---------|---------|
| Add splat / independent layers | PASS (recent commits) |
| Click-to-select subject | PASS (recent) |
| Transform without moving world | PASS (guard commits) |

### 2.4 LiDAR (Import tab)
| Feature | Verdict | Notes |
|---------|---------|--------|
| Import PLY / XYZ / CSV | PASS | Browser parse |
| Uncompressed **LAS** | PASS | Capped ~1M points |
| **LAZ** | GAP | Explicit error: convert first |
| Preview / scale / offset / fit | PASS | |
| Merge / undo / clear | PASS | |
| Outlier clean | PASS path | |
| Colour modes (RGB / intensity / class) | PASS path | |

### 2.5 Mesh & Print
| Feature | Verdict | Notes |
|---------|---------|--------|
| Extract mesh | PARTIAL | Fails on sparse/noisy (“No surface”) — expected |
| Fill holes | PARTIAL | Needs successful extract first |
| STL download | PARTIAL | Enabled when watertight-ish shell |
| Queue GPU print | PARTIAL | Needs worker |
| GLB / coloured PLY | PARTIAL | Pipeline present |
| Hybrid tri-splat | PARTIAL | Module exists; not “one click magic” |

### 2.6 Image → inferred 3D (inside Studio)
| Feature | Verdict | Notes |
|---------|---------|--------|
| Image angle import UI | PASS | In Import-style panels |
| Depth model / heuristic | PARTIAL | Local/heuristic; not full photogrammetry |
| Build inferred splat | PARTIAL | Produces a plan/splat approximation, not SuperSplat quality |
| Open in editor | PASS path | |

### 2.7 Break-frame / magazine-style “out of frame”
| Feature | Verdict | Notes |
|---------|---------|--------|
| Frame styles (polaroid, phone, poster…) | PASS | `break-frame.js` |
| Subject extract + depth text (iPhone-style) | PASS | 2.5D composite canvas |
| Looping pop-out video | PARTIAL | MediaRecorder path |
| True textured 3D frame object in scene | **GAP** | Composite is canvas/video, not a mesh frame in the 3D world |

**Honest read:** “3D-ify images into frames with texture” today = **depth-aware 2.5D composite** (strong for social/ads), **not** a full textured 3D frame mesh you orbit like a product prop. That is the main product gap for this request.

### 2.8 Performance
| Issue | Verdict |
|-------|---------|
| 800k+ points freeze | Mitigated in QA pack (LOD + frame throttle) | Still heavy on weak GPUs |

---

## 3. Image → Splat Studio (`/image-to-splat`)

| Claim | Reality |
|-------|---------|
| Upload listing photos | PASS |
| Camera plan / angles | PASS |
| Export project ZIP + manifest | PASS |
| Run reconstruction in browser | **STUB** — page states engine is separate |
| Backend adapter to Kaggle/GPU | **GAP** — kaggle workers exist in repo, not wired as one-click from this page |

Kaggle folder present: `fumoca_kaggle_worker.py`, `fumoca_nif_worker.py`, `mesh2splat_preflight.py`, etc. → **infra pieces exist**, product glue incomplete.

---

## 4. Viewer & interactivity

| Feature | Verdict |
|---------|---------|
| Load NIF from R2 / query params | PASS path |
| Orbit / idle orbit | PASS |
| Hotspots | PASS |
| State bridge (doors/lights/engine/IVI) | PASS HUD + SFX; hinge is **proxy** |
| `?mode=car&demo=vehicle` seed pins | PASS |
| Walkthrough graph | PARTIAL module |
| Nested splat / portals | PARTIAL |
| Scene audio | PASS path |
| Real CAD door meshes | GAP without tagged regions + geometry |

---

## 5. Convert / formats

| Feature | Verdict |
|---------|---------|
| Convert page (ply/splat URL or file) | PASS UI |
| NIF encode/decode | PASS module |
| Easy “any image → solid splat” | **PARTIAL/STUB** via image-to-splat + depth heuristic only |

---

## 6. Social / ads / magazine

| Surface | Verdict |
|---------|---------|
| Feed | PASS path |
| Magazine cover + embed iframe | PARTIAL |
| Ad studio/preview | PARTIAL |
| Media edit (captions, reverse video) | PARTIAL — some controls disabled until server encoder |

---

## 7. What was fixed in recent QA packs (apply if not pushed)

1. Editor LOD + frame throttle + free orbit + hidden file input  
2. Viewer seed only for car demo params  
3. present.html `nifId` alias  
4. Mesh default resolution softener  
5. Expanded `_redirects` + `.gitignore`  
6. This master report  

---

## 8. Priority build list (after you update)

**P0 — must for “works great” client demos**
1. Wire **Image→Splat package → Kaggle/GPU job → NIF back into `/edit`** (end-to-end)  
2. **Textured 3D frame prop** (plane/box with canvas texture + optional slight extrusion) in Studio scene, not only 2.5D export  
3. Auto **LOD + “Full quality” toggle** labeled in UI so users understand display vs export  

**P1 — quality**
4. Photoreal colour parity path for common PLY exports  
5. Mesh: better defaults + “why failed” guidance when no surface  
6. LAZ: worker convert or clear in-app guidance  

**P2 — polish**
7. Privacy / Terms pages or remove footer promises  
8. Reduce dual editors (`edit` vs `splat-edit-engine`) confusion  
9. Link Image→Splat from Studio Import tab explicitly  

---

## 9. Bottom line

- The **platform shell is broad and mostly live** (routes, modules, Studio, viewer, LiDAR parse, mesh UI, break-frame composites, convert, social pages).  
- **Not missing random buttons** so much as **depth of completion**: reconstruction backend, true 3D framed objects, SuperSplat-level look, and rock-solid mesh on sparse data.  
- Honesty already present on Image→Splat page is good — keep that; productize the backend next.

When this report + prior pack files are on `main` and deploy is green, next engineering session should pick **one P0** only.
