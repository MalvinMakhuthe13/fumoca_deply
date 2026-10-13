# Cleanup notes (Oct 2026 pass)

## Done in this pass

### Hygiene
- Proper `.gitignore` (secrets, zips, node_modules, OS junk, wrangler local)
- Removed committed zip (`fumoca_merged_FIXED (2).zip`)
- Removed `config.js` from tracking (real credentials belong only in local `config.js`)
- Removed `cloudflare/workers/r2-storage-old.js`
- Consolidated long docs into `docs/`

### Docs
- Single clean root `README.md` with quick start + layout
- Technical/spec docs live under `docs/`

### Structure
- Root `package.json` with `npm start` / `npm run serve` → local server
- Scripts kept executable

### Code
- `js/auth.js` rewritten: returns `{ data, error }`, no more raw `alert()`s
- `config.example.js` documented and includes all current keys
- `js/modules/nav.js` formatting cleaned (FOOTER_ITEMS, dead comment removed)

### UI
- Shared nav system already existed and is the single source of truth
- Marketing (`index.html`) and full-screen tools (`viewer`, `edit`, `showroom`, …) correctly opt out via `data-nav="none"`

## Suggested next cleanups (when you want)

1. **Versioned modules** still present — decide which is canonical:
   - `ai-cleanup.js` vs `ai-clean-v2.js`
   - `tour-engine-v80.js` / `tour-mode-v80.js` vs newer tour modules
   - `fumoca-v90-shim.js`
   Audit imports in `edit.html` / `viewer.html` and delete the unused ones.

2. **Duplicate CSS tokens** — some pages redefine `:root` instead of only using `css/tokens.css`. Prefer the shared tokens file everywhere.

3. **Large modules** — `viewer.js` (~2.8k lines), `edit-engine.js` (~1.4k). Candidates for later split when you touch them.

4. **engine-next/** — keep as experimental; don’t mix its imports into the main static pages until Phase wiring is done.

5. **Security** — confirm R2 worker never accepts the old shared secret; rotate any secret that was ever in a committed `config.js`.

## Studio expansion (same pass)

- `docs/STUDIO_VISION.md` — client-ready product story (SuperSplat / Kiri / Blender / CloudCompare inspiration, one calm studio)
- `js/modules/studio-modes.js` — Navigate · Edit · Clean · Mesh & Print · Present · Import
- `js/modules/lidar-import.js` — PLY / XYZ import; LAS/LAZ deferred to worker
- `js/modules/camera-paths.js` — save / go / export camera angles for viewer + capture guide
- `js/modules/sparse-quality.js` — limited-view floater + gap boost
- `js/modules/studio-mesh-print.js` — mesh extract, hole fill, STL / GPU print panel
- `edit.html` — new left tabs (Mesh, Present, Import), mode bar, sparse boost button, module wiring

Next wiring (when you open Studio with a real splat):
1. `mergePointCloudIntoStudio(cloud)` on the live renderer state
2. Connect `FUMOCA_MeshExtractor` / gap-filler / print-export globals to the panel buttons (hooks already call them if present)
3. Persist camera paths into `splats.metadata` on save
