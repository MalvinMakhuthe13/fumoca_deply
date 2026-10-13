# Cleanup changelog — 2026-10-13

## Hygiene
- Expanded `.gitignore` (config.js, zips, secrets, node_modules, OS, wrangler)
- Deleted `fumoca_merged_FIXED (2).zip` from tree
- Deleted tracked `config.js` (use `config.example.js` only)
- Deleted `cloudflare/workers/r2-storage-old.js`
- Moved long docs into `docs/`

## Structure
- Root `package.json` with `npm start` → local server
- `docs/` holds: BIBLE, V2_SPEC, VISION, KAGGLE_SETUP, DEPLOY*, CLEANUP_NOTES

## Code quality
- `js/auth.js`: returns `{data, error}`, no alerts, added `logout` + `getSession`
- `config.example.js`: documented all keys including `r2WorkerUrl`
- `js/modules/nav.js`: clean FOOTER_ITEMS, removed dead commented function, consistent formatting

## Docs
- New focused root `README.md`
- `docs/CLEANUP_NOTES.md` lists done work + suggested next steps

## Intentionally left alone (for your next pass)
- Versioned modules (`*-v80`, `ai-clean-v2`, `fumoca-v90-shim`) — need import audit before delete
- Large monolithic modules (`viewer.js`, `edit-engine.js`)
- Per-page CSS token redefinitions
- `engine-next/` experimental tree
