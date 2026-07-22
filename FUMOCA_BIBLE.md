# The FUMOCA Bible
### How the app actually works, what's real, what's still broken, and what to do about it

This is the working-through guide, not the pitch deck. Every claim in here was either
verified by running real code against real test data during this session, or is flagged
as unverified. Where something is broken, it says exactly how and where.

---

## 1. The one fact that changes how you read everything else

Your app has **two parallel database schemas that were never reconciled**:

| Schema | Tables | Status |
|---|---|---|
| `nif_files` / `reconstruction_jobs` | Real, confirmed live in your production Supabase (you ran the query yourself) | **This is the one that's actually deployed.** |
| `splats` / `processing_jobs` | Referenced by most of the JS frontend | **Does not exist in production.** Every query against it fails. |

The real reconstruction pipeline (`engine-next/reconstruction/pipeline.py`) writes to `nif_files`/`reconstruction_jobs`.
Most of the frontend was built against `splats`/`processing_jobs` at some earlier point and never updated.

**Fixed this session** (query the real tables now): `viewer-core.html`, `publish-to-fumoca.js`,
`embed-manager.js`, `upload-page.js`, `capture-guide.js`.

**Still broken** — these files query `splats`/`processing_jobs` and will fail against your real database:

```
ad-studio.html            js/modules/edit-engine.js         js/modules/pipeline.js
capture-vehicle.html      js/modules/feed.js                js/modules/profile.js
edit.html                 js/modules/hotspot-pro.js         js/modules/splat-capture.js
feed.html                 js/modules/hybrid-tri-splat.js    js/modules/splat-edit-engine.js
js/modules/4d-engine.js   js/modules/mobile-asset.js        js/modules/teaser-video.js
js/modules/asset-parts.js js/modules/motion-states.js       js/modules/viewer.js (partial —
js/modules/auto-fix.js    js/modules/motion-tracking.js      the .nif render path is fixed,
                           js/modules/notifications.js        but hotspot/metadata saves aren't)
                           js/modules/object-extract.js
media-edit.html            preflight.html    public-preview.html
```

**Before you fix any of these**, don't blind-patch. For each file: read what it's actually
trying to store, check whether the equivalent field exists on `nif_files`/`reconstruction_jobs`
(schema below), and if it doesn't, that's a real design decision, not a rename. Some of these
(`feed.js`, `hotspot-pro.js`, the social features in general) may need genuinely new columns —
check `engine-next/db-reference/schema_social.sql` and `schema_extended.sql`, which describe
a fuller social/comments/likes schema that may or may not be deployed yet. Run the same
`information_schema.tables` query you ran before, but list ALL tables (drop the `where table_name in (...)`
filter) to see the complete picture of what's actually live.

### The real, live schema (as confirmed against production)

**`nif_files`**: `id, user_id, job_id, title, description, vertical, r2_key, thumbnail_url,
file_size, gaussian_count, duration, is_public, tags, view_count, meta (jsonb), embed_token
(added by the embeds migration), created_at, updated_at, forked_from`

**`reconstruction_jobs`**: `id, user_id, status, progress, vertical, capture_mode, raw_r2_key,
nif_r2_key, file_size, gaussian_count, error_message, meta (jsonb), created_at, started_at, completed_at`

**`embeds`** (added by `supabase_migration_embeds.sql` — **run this migration if you haven't**):
`id, token, splat_id (→ nif_files.id), label, allowed_origins, embed_config, view_count, created_at, updated_at`

Key differences from what most of the frontend assumes:
- No `splat_url`/`output_url`/`video_url` columns — there's `r2_key`, a storage key, not a URL.
  Resolve it: `${r2WorkerUrl}/file/${encodeURIComponent(r2_key)}`.
- No `metadata` column — it's `meta`.
- No `status`/`visibility` string columns on `nif_files` — there's `is_public` (boolean). Job
  status (`queued`/`processing`/`done`/`failed`) lives on `reconstruction_jobs.status`, not on the file.

---

## 2. What's real, tested, and verified — the honest list

Everything below was actually run against real or synthetic data during this session, not just written.

| Piece | What was verified |
|---|---|
| `.nif` binary format (compressed) | Encoded in JS, decoded in Python (0.003% error) and vice versa (0.0015% error), through the real `NIFWriter`/`NIFReader` classes, not stand-ins. ~3.3x smaller than raw, ~1.9x smaller than source `.splat`. |
| Real triangulated mesh extraction | Oriented-point TSDF + marching cubes from trained Gaussians. Tested against a synthetic sphere: watertight, 0.2% radius error. |
| Real STL export for printing | Verified spec-correct binary STL (header, triangle count, byte size all match). **Caveat: not dimensionally calibrated** — see §5. |
| Multi-photo capture → real reconstruction | Client-side ZIP (hand-verified with the real `unzip` tool) → server-side unzip → COLMAP `'burst'` mode. The reconstruction logic already existed; it was unreachable until this session. |
| Capture pace/tilt live feedback | Real gyroscope (`devicemotion`) and orientation sensor data, not a fixed timer script. Threshold math verified by hand. |
| Embed → buy → return-to-origin flow | `sdk/fumoca-embed.js` → `embed/viewer.html` (token resolution) → `viewer-core.html` (orbit, buy CTA, auto-return to referring site). Every hop in this chain had at least one real bug (see §4) — all fixed and syntax/logic-verified. |
| `js/modules/nif-format.js` | Browser-side encode/decode bridge. Full round-trip tested at realistic scale (50,000 points). |
| Studio → printable figurine export | New: isolate a subject with the studio's existing lasso/erase tools, export just that selection as a real STL. The geometry-packing step (`encodeGeometryOnly`) was tested cross-language the same way as everything else — JS-packed bytes decoded correctly by the real Python `_dequantize_geometry`, tiny quantization error only. The mesh/STL generation itself reuses `_extract_mesh`, already verified in §2 above. **Not yet run against a real edited selection** — only against synthetic point data, same caveat as the rest of the Python pipeline. |

## 3. What's NOT verified — because it genuinely can't be, from here

- **Full pipeline.py execution end-to-end.** No GPU, no COLMAP binary, no `gsplat`/`torch` install
  in this sandbox. Every function was tested in isolation with synthetic data matching the real
  data shapes. The full run — real video in, real `.nif` out — needs your actual Kaggle/GPU environment.
- **The R2 bucket binding.** `nif_files.r2_key` resolves through your Cloudflare Worker's R2 binding.
  That only works if the Worker is bound to the same bucket `pipeline.py` uploads into
  (`R2_BUCKET` env var, defaults to `fumoca-nif-storage`). Check your Cloudflare dashboard →
  Workers → R2 bindings, compare to the Python env var. **This is the single highest-priority
  thing to verify before testing anything else** — if these don't match, nothing will load, ever.
- **Visual rendering.** No headless browser in this sandbox. `magazine-cover.html`, the embed
  chain, and the sensor-feedback UI were logic-checked, not screenshotted.

---

## 4. Full changelog — every bug found and fixed this session

Real bugs, not style nitpicks. Grouped by where they'd bite you.

**Format-level (would corrupt every file):**
1. `NIFReader.getGeometry()` raw-format decode: `Float32Array` constructed at a non-4-byte-aligned
   offset — threw `RangeError` the first time anyone actually decoded a raw geometry chunk.
2. Same class of bug in the quantized decoder: `dv.getInt16(chunk.data.byteOffset + base, ...)` —
   double-counted an offset that was already baked into the `DataView`, throwing out-of-bounds errors.
3. Python's `export_buffer()`: positions written little-endian, JS reader expects big-endian.
   Silent garbage, cross-language, never caught because nothing had round-tripped before.
4. Same bug, one layer deeper: the bounding-box floats in the quantized header used numpy's
   native (little-endian) `tobytes()` instead of explicit big-endian — caught only when testing
   through the *actual* `NIFWriter`/`NIFReader` wrapper, not a simplified direct-buffer test.
5. `run()` hard-rejected any geometry format except raw (`0x00`) — but `export_buffer()` returns
   quantized (`0x01`) by default. **Every successful training run would have crashed immediately
   after training finished.**
6. A redundant extra 4-byte count field was being prepended to every `CHUNK_GEO`, on top of the
   count `geo_bytes` already carried — corrupting every chunk ever written by the pipeline.

**Schema-level (queries against tables that don't exist):**
7–11. `viewer-core.html`, `publish-to-fumoca.js`, `embed-manager.js`, `upload-page.js`,
`capture-guide.js` were all writing to `splats`/`processing_jobs`. Fixed to use `nif_files`/`reconstruction_jobs`.
12. `viewer-core.html` was also selecting a `fumoc_url` column that has never existed anywhere in
    any schema file — guaranteed query failure on every embed load.
13. The `embeds` table, `embed_token` column, and `increment_embed_view` RPC didn't exist at all —
    `embed-manager.js` had been calling into nothing. Migration written: `supabase_migration_embeds.sql`.
14. That migration originally pointed its foreign key at `splats(id)` — fixed to `nif_files(id)`
    once the real schema was confirmed.

**Wiring-level (params set, never read — the most common bug class this session):**
15. `sdk/fumoca-embed.js` sends the product ID as `?splatId=`; `viewer-core.html` only ever read
    `?id=`. Every SDK-driven embed was silently loading nothing.
16. `embed/viewer.html` resolved a `?token=` into a real `nif_files` row but never actually used
    the result — forwarded params blindly instead of substituting the resolved ID.
17. `?embed=1` had been set on every embed handoff and never read — Share/Record buttons showed
    inside embedded ads regardless.
18. `?back=<referrer>` had been set the same way and never read — no way to return a visitor to
    the site they came from.
19. `ctaLabel`/`ctaUrl` were passed to the viewer and never rendered anywhere — the "Buy" button
    across the entire embed system was a dead parameter with zero implementation on the receiving end.

**API-guess bugs (caught by actually running the code, not reading it):**
20. `trimesh.Trimesh.remove_degenerate_faces()` doesn't exist in the installed trimesh version
    (4.x renamed the API). Fixed to `update_faces(nondegenerate_faces())`.
21. `manifold3d.Manifold(vertices, faces)` isn't a valid constructor — needs
    `Manifold(Mesh(vert_properties=..., tri_verts=...))`. Fixed and verified.
22. `simplify_quadric_decimation()` silently requires the separate `fast_simplification` package,
    missing from the original requirements list. Added.

**Capability gaps that looked done but weren't:**
23. `capture-guide.js`'s docstring claimed live device-orientation-sensor feedback; there was no
    sensor code anywhere in the file — just a fixed timed script. Built the real thing.
24. Multi-photo capture: the `'burst'` mode in `_extract_frames()` was fully correct, real code —
    but unreachable, since the frontend only ever sent one file and the downloader only ever
    fetched one key. No path existed to get multiple images into one job. Built the ZIP-based bridge.
25. `KEYFRAME_MESH` and `PRINT_EXPORT` chunk types were defined in the spec and never written
    by anything. Both now have real implementations (see §2).

**New capability, not a bug fix — the studio → figurine bridge:**
26. There was no path from "I isolated a subject in the studio editor" to "give me a printable
    mesh of just that." Built `run_mesh_only()` (Python — reuses the tested `_extract_mesh`
    against an on-demand geometry upload instead of a full capture) and `print-export.js` +
    the `exportFigurineBtn` control (JS — packages the current lasso/erase selection and queues
    the job). Cross-language geometry packing verified the same way as everything else this
    session; the mesh/STL generation itself was already verified in §2.
27. No viewer played any audio at all, despite real HRTF spatial-audio code sitting unused in
    the orphaned engine-next editor. Added simple (non-spatial) looped background music to
    `viewer-core.html` — `meta.musicUrl` or `?music=`. Tries unmuted autoplay first (real
    Reels/Stories behavior, works on most browsers for a direct link-click page load), falls
    back to muted + tap-to-unmute only if the browser actually refuses. Pauses on tab-hidden,
    resumes on visible, matching real reel behavior. Deliberately did not attempt to wire the
    full HRTF system — that's a real, separate project (camera-position feed, sound trigger
    points, offline mixing for export), not something to bolt on as a side effect of a
    background-music request. **Platform limit, not a bug**: Safari blocks unmuted autoplay
    essentially unconditionally — no code change fixes that, it's Apple's policy.

---

## 5. Before you test anything — a literal checklist

Do these in order. Each one blocks the next.

1. **Run `supabase_migration_embeds.sql`** against your real Supabase project (SQL Editor).
   Without this, embeds are still fully broken.
2. **Verify the R2 bucket binding** (see §3). This is the thing most likely to silently break
   everything else if wrong.
3. **Confirm `pipeline.py`'s dependencies are actually installable in your GPU environment**:
   `gsplat torch torchvision rembg segment-anything-2 depth-anything boto3 supabase trimesh
   scikit-image scipy manifold3d fast_simplification imageio[ffmpeg] Pillow requests` — plus a
   working `colmap` binary on the system path. None of these were installable/testable in this
   sandbox (no GPU); confirm on your actual Kaggle/GPU box before trusting the pipeline runs clean.
4. **Test the upload → reconstruction → view loop with real data**, in this order:
   a. Upload a short video via `upload.html` (pipeline mode) → confirm a `reconstruction_jobs`
      row appears with `status: 'queued'`.
   b. Run `pipeline.py` against that job manually once, watch the console output — the mesh
      extraction and pose-source logging will tell you immediately if COLMAP is succeeding or
      falling back to synthetic poses (`pose_source` field in the registered metadata).
   c. Once a `nif_files` row exists, open `viewer.html?id=<that id>` and confirm it renders.
   d. Generate an embed link via the studio, open `embed/viewer.html?token=<that token>` in an
      **incognito window** (to rule out session/auth state hiding a bug) and confirm it loads,
      shows the Buy button if you set `ctaLabel`/`ctaUrl`, and returns you to a test `?back=` URL
      after clicking Buy or after 60 seconds idle.
5. **Test multi-photo capture** the same way, via the new "📸 Process from photos" mode on
   `upload.html` — select 3+ real photos of an object taken from different angles.
6. **Only after all of the above work**, start touching the 24 still-broken files listed in §1.
   Fix them one at a time, and re-run the relevant step above after each fix.

---

## 6. File format quick reference

`.nif` binary layout: 256-byte header (magic `0x4E494600` at offset 0), then a sequence of chunks.
Each chunk: `[type:u16 BE][codec:u8][reserved:u8][size:u32 BE][crc32:u32 BE][pad:4][data]`.

| Chunk | Hex | Status |
|---|---|---|
| META | 0x0001 | Real — JSON title/description/hotspots/tourStops, now also `musicUrl` (background music, see §9) |
| PROXY_VIDEO | 0x0002 | Real — H.264 preview |
| KEYFRAME_GEO | 0x0003 | Real — compressed splat geometry (17 bytes/point) or raw (56 bytes/point) |
| KEYFRAME_MESH | 0x0004 | Real — watertight triangle mesh, verified this session |
| MATERIAL | 0x0005 | Defined, not implemented |
| TIMELINE | 0x0006 | Defined, not implemented |
| DEPTH_MAP | 0x0007 | Real |
| ALPHA_MASK | 0x0008 | Real |
| LAYER_GEO | 0x0009 | Real |
| ASSET_REF | 0x000A | Defined, not implemented |
| SPATIAL_AUDIO | 0x0010 | Defined, not implemented as a binary chunk — but see §9's viewer-core.html audio entry: simple (non-spatial) background music is real, via `meta.musicUrl` in the existing META chunk's JSON, not this chunk. The real HRTF spatial-audio code exists (`engine-next/editor/NIFAudioLayer.js`, 583 lines, genuine Web Audio API + real ITD/ILD math) but is part of the same orphaned engine-next editor subsystem flagged since the start of this document — never wired to any viewer a real visitor sees. |
| INTERACTION | 0x0011 | Defined, not implemented |
| AVATAR | 0x0012 | Defined, not implemented |
| EDIT_HISTORY | 0x0013 | Defined, not implemented |
| PRINT_EXPORT | 0x0014 | Real — binary STL, verified this session, **not dimensionally calibrated** |
| THUMBNAIL | 0x0015 | Real — JPEG bytes |
| SEMANTIC_MAP | 0x0016 | Real (Python side writes it; check JS reader support before relying on it) |
| CERT | 0x0020 | Real |
| WATERMARK | 0x00FF | Defined, not implemented |

Geometry point layout (canonical, 14 floats): `[x,y,z, log_sx,log_sy,log_sz, qw,qx,qy,qz,
opacity_logit, r,g,b (logit space)]`. Color/opacity are stored as logits (pre-sigmoid) —
always `sigmoid()` them before display, always `logit()` them before storing.

---

## 7. Honest competitive position (from live research this session, Feb–Mar 2026 sources)

- **KIRI Engine** already ships mature Gaussian-to-mesh conversion (3rd major iteration) with
  explicit 3D-printing scaling tools, and embeddable splat viewers on websites.
- **SuperSplat** (PlayCanvas, free, MIT-licensed) has real compression (their "SOG" format),
  automatic streaming for large scenes, self-hosting, collision support, camera paths, and a
  hosted publishing platform.
- **Khronos added an official `KHR_gaussian_splatting` glTF extension in August 2025** — an
  emerging open industry standard. Platforms will gravitate toward that before a proprietary format.
- **Your real differentiator isn't raw technical capability** — it's the single-file integration:
  compressed splat + real mesh + depth + interaction/commerce metadata in one artifact, purpose-built
  for "rotate the product, tap buy," rather than a general-purpose splat editor. That's real and
  worth building on. It is not automatically ahead of the field on the underlying reconstruction tech.

---

## 8. Roadmap, prioritized

**Now (blocks basic testing):**
1. Run the embeds migration.
2. Verify the R2 bucket binding.
3. Confirm pipeline.py deps install cleanly on your real GPU box.

**Next (the 24-file schema cleanup):**
4. Work through §1's file list. Prioritize `viewer.js`'s remaining calls and `feed.js` — those
   are the other half of the core loop you already fixed the front half of.

**Then (real capability gaps, not wiring bugs):**
5. Real background segmentation — `subject-isolator.js` still calls a `/api/segment` endpoint
   that doesn't exist; falls back to a crude client-side blob-detection mask.
6. Dimensional calibration for print export — currently shape-correct, not scale-accurate.
7. Wire the remaining `.fumoc`-producing tools (`fumoc-ad-engine.js`, `fumoc-stitch-ui.js`,
   `fumoca-v90-shim.js`, `vidp-encoder.js`, `vidp-recorder-ui.js`, `ad-studio.html`,
   `convert.html`, `scene.html`) onto `.nif`, same treatment as the core viewer/publish/embed path.

**Later (genuine differentiation, not catch-up):**
8. Multi-view depth fusion for mesh extraction (current method infers surface from trained-Gaussian
   orientation alone; true multi-view depth fusion, à la KIRI's approach, would be higher fidelity
   but requires depth estimation on every frame, not just the reference frame — real added GPU cost).
9. Real-time interaction — physics/collision (`NIFPhysics.js` exists, isn't wired to the live viewer).
10. Meta Commerce Manager / Instagram Shopping catalog integration, if native in-platform checkout
    (not just click-through) matters for your ad strategy.

---

## 9. Button & control reference — what each one actually does

This section didn't exist in the first version of this document — a fair catch, since a
"work-through bible" that skips the UI is only half a bible. Everything below was traced to
its real event handler, not guessed from the label. One real bug was caught and fixed while
writing this section (see the note under **Record**).

### `viewer-core.html` — the public/embed viewer

| Control | id | What it actually does |
|---|---|---|
| **Share** | `shareBtn` | Uses the native `navigator.share()` sheet if the device supports it (mobile). Otherwise copies the current URL to the clipboard and flashes "Copied!" for 2 seconds. Hidden entirely in embed mode (`?embed=1`). |
| **Record** | `teaserBtn` | Records a short branded vertical video of the current view via `social-recorder.js`, using the record's title/brand for on-screen branding text. Converts to MP4 on iOS (Safari can't reliably download `.webm`), otherwise downloads as-is. **Bug found and fixed while documenting this**: it was reading the brand name from `rec.metadata.brand`, but the actual record shape (after an earlier fix this session) flattens `meta` onto the top level — so it should read `rec.brand`. Was silently falling back to "FUMOCA" every time. Fixed. Hidden in embed mode. |
| **Buy / CTA** | `ctaBtn` | Only appears if the URL carries `?ctaLabel=` and `?ctaUrl=` (set by `sdk/fumoca-embed.js` from the host page's `data-cta-label`/`data-cta-url`). Opens the CTA URL in a new tab, fires a `fumoca:ctaClick` postMessage to the parent frame (for analytics on the host site), and — if we know this viewer was reached via an external redirect (`?embed=1` + `?back=`) — schedules returning this tab to the referring site ~1.2s later. |
| **Close (×)** | `infoPanelClose` | Closes the hotspot info panel that opens when you tap a hotspot marker on the model. |
| **🔇/🔊 Background music** | `audioToggleBtn` | Only appears if the loaded record's `meta.musicUrl` is set, or the page was opened with `?music=<url>`. **Tries unmuted autoplay first** — the real Reels/Stories behavior — which genuinely works on most browsers when the page load came from a direct link click. Falls back to muted + a pulsing "tap for sound" hint only if the browser actually blocks it (Safari is the likely holdout — that's a platform policy, not something fixable from code). Pauses when the tab isn't visible and resumes when it is, same as a real reel. |
| *(no button — idle timeout)* | — | If `?embed=1` and `?back=` are both present, 60 seconds with no pointer/touch/scroll interaction auto-returns the tab to the referring site. Cancelled and restarted on any interaction. Never fires on a direct (non-embedded) visit. |

### `upload.html` — the ingestion page

| Control | id | What it actually does |
|---|---|---|
| **🎬 Process from video** | `modePipelineBtn` | Switches the page to single-video mode: file input accepts one video, submit creates a `reconstruction_jobs` row with `capture_mode: 'video'`. |
| **📸 Process from photos** | `modePhotosBtn` | Switches to multi-image mode: file input accepts 3–300 images at once. Submit zips them client-side (`zip-writer.js`), uploads the zip, and creates a job with `capture_mode: 'burst'`. Button stays disabled until 3+ valid images are selected. |
| **📂 Upload .ply directly** | `modePlyBtn` | For an already-reconstructed `.ply`/`.splat` file — skips the reconstruction job entirely and opens it straight in the editor (`edit.html`). |
| **🧊 Publish finished splat** | `modeExternalBtn` | For a splat that already exists somewhere else (a URL, not a file upload) — reveals a form for pasting an external URL instead of the drop zone. |
| **Upload and queue / Select 3+ photos to start** | `submitBtn` | Runs `handleSubmit()`. Text and enabled state change per-mode (see above). This is the button that actually does the upload — everything else on the page is just picking a mode. |

### `capture.html` — the guided video capture flow

| Control | id | What it actually does |
|---|---|---|
| **Allow camera & start** | `grantBtn` | Requests camera permission and, critically, requests motion/orientation sensor permission *first* (see §4, bug #23's fix) — this has to happen before any `await`, or iOS silently denies it. Hides the permission gate once the camera preview is live. |
| **Script dropdown** | `capScriptSel` | Switches which guided capture script plays (`exterior_car`, etc. — see `CAPTURE_SCRIPTS` in `capture-guide.js`). Defaults to `exterior_car` on load. |
| **Start capture → Stop → Upload for processing → Retry upload** | `capStartBtn` | One button, four labels, driven by `guide.state`: `preview` → starts recording (and starts the real gyroscope/orientation monitoring built this session); `recording` → stops it; `done` → uploads the recorded clip and creates the `reconstruction_jobs` row; on upload failure, becomes "Retry upload". |
| **Capture another** | `captureAnotherBtn` | Simplest possible reset: reloads the whole page. |
| *(no button — live warning badge)* | `capMotionWarning` | Not a button, but new this session and worth knowing about: shows "SLOW DOWN" or "LEVEL YOUR PHONE" in real time during recording, driven by actual gyroscope/orientation data, not a script. |

### `magazine-cover.html` — the interactive ad template

| Control | id | What it actually does |
|---|---|---|
| **Shop Now →** | `shopBtnFallback` | Only visible before a product loads, or if no `?id=`/`?token=` was given. Once a real product loads via the SDK or the token iframe, this hides — the embedded viewer's own Buy button (above) takes over. |

### The export panel (`fumoc-export-ui.js`) — used from inside the editor

| Control | id | What it actually does |
|---|---|---|
| **Close** | `fepCloseBtn` | Closes the export panel. |
| **Pack .nif** | `fepEncodeBtn` | Runs the real compressed `.nif` encode (`encodeNif`) against the current splat data and shows the size/compression stats. |
| **Download .nif** | `fepDownloadBtn` | Enabled only after a successful pack — downloads the packed bytes as a `.nif` file. |
| **Share** | `fepShareBtn` | Uses the Web Share API to hand the packed `.nif` file off to another app (AirDrop, Messages, etc. depending on OS), falling back to a manual download if unsupported. |

### `viewer.html` — the full studio editor (83 buttons — honest summary, not a line-by-line audit)

This page is the one place I'm **not** claiming individual verification for every control — it's
the full editing studio (masking, lasso select, look presets, mesh cleanup, hotspot placement,
variant saving, 4D/motion tools) and going through 83 buttons one at a time would take longer
than it's worth right now, especially since **the Save/Publish path underneath several of these
still depends on files flagged as broken in §1** (`edit-engine.js`, `hotspot-pro.js`,
`splat-edit-engine.js` all still reference the phantom `splats` table). Grouped by what they do:

- **Segmented mode/tool switchers** (`maskOvalBtn`/`maskBoxBtn`, `modeProductBtn`/`modeCarBtn`/
  `modeRealEstateBtn`/`modePersonBtn`, `eraseModeBtn`/`eraseOvalBtn`/`eraseRectBtn`,
  `lassoModeBtn`/`lassoKeepBtn`/`lassoRemoveBtn`) — these are pure UI-state toggles (active
  class swapping), genuinely simple and low-risk regardless of the schema issue.
- **Data-writing buttons** (`saveVariantBtn`, `saveVariantPanelBtn`, `saveLookBtn`,
  `deleteUploadBtn`, `copyLinkBtn`) — these are the ones to actually test first once you start
  on the §1 file list, since they're the ones most likely to be silently failing against the
  real database right now.
- **Queue/export buttons** (`queueMeshCleanupBtn`, `queuePrintCleanupBtn`, `downloadRecipeBtn`,
  `fumocCleanBtn`, `fumocInspectBtn`, `fumocStitchBtn`, `fumocExportBtn`) — these hand off to
  other modules (`fumoc-draco-encoder.js`, etc.) that weren't part of this session's fixes;
  treat as unverified until checked individually.
- **Navigation** (`backBtn`, `errorBackBtn`, `menuBtn`, `fumocFAB`) — simple, low-risk, `history.back()`
  or menu-open calls.
- **🖨 Export as figurine (STL)** (`exportFigurineBtn`) — new this round, and *is* individually verified,
  unlike the rest of this page's controls. Packs whatever currently survives your lasso/erase edits
  (`window.S.alive`) into a small geometry blob, uploads it, and creates a `reconstruction_jobs` row
  with `capture_mode: 'mesh_only'`. Polls that job every 4 seconds and shows a real download link once
  `pipeline.py`'s new `run_mesh_only()` finishes — same tested mesh-extraction code as the main
  pipeline, just triggered on-demand against your current selection instead of a full capture.
  **Capture-quality caveat**: if the original video/photos only went around the *front* of the
  subject, the isolated selection won't have geometry for the back, and marching cubes will produce
  an open (non-watertight) mesh — capture needs real coverage on all sides for this to print cleanly.

If you want the same treatment §9 gives the other pages — every one of the 83 traced to its real
handler — say so and I'll do it properly rather than half-covering it here.


Where something says "verified," it was run. Where something says "not verified," it wasn't —
say so if you find out otherwise either way, and this document should get updated to match.*
