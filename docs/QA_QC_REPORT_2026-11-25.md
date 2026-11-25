# FUMOCA QA/QC report — 25 Nov 2026

Scope: `main` at `5fb490c` and all **26 open PRs** (9 PRs are already merged).
Nothing has been merged on GitHub; all work is on review branches.

## Branches produced

| Branch | Base | What it is |
|---|---|---|
| `qa/2026-11-25-baseline-fixes` | `main` | Standalone fixes for problems found on `main` (security, broken pages, CI gaps). Safe to merge first. |
| `qa/integration-full` | baseline fixes | `main` + every PR that could be merged safely, with conflicts resolved and tested together. |
| `fix/pr-29-rebased` | `main` | PR #29's two real commits replayed onto current `main`. |

## How it was tested

* Every step of `.github/workflows/fumoca-validation.yml` was run (except the Kaggle GLB preflight, which needs `trimesh`).
* Every JS file and every inline `<script>` in every HTML page was syntax-checked.
* Every unit and browser test was run in headless Chrome, including **tests that CI was not running**.
* Missing local files and broken imports were checked.
* Every top-level page was loaded in headless Chrome (uncaught errors, failed same-origin requests).
* Each open PR was checked against `main` (conflicts, tests), against the other PRs, and against GitHub's own CI results.

**Sandbox limits:** CDNs (jsdelivr, esm.sh, sparkjs) are blocked here, so Studio and the viewer could not be run with three.js. The 25 animation suites and 6 articulated/demo browser tests need `three` / `@dimforge/rapier3d-compat` from npm. These run only in GitHub CI. PR #35's head passes them there; re-check them on `qa/integration-full` after pushing.

Results: baseline — all 48 CI steps pass. Integration — all 72 CI steps pass, except the animation suite, which can't run here. No syntax errors, no broken references, no page errors on any page.

## Fixed on `main` (baseline branch)

| Severity | Issue | Fix |
|---|---|---|
| **High** | **Stored XSS.** Hotspot CTA/link/gallery/media, nested-overlay iframe, tour CTAs, ad CTAs, commerce links and audio URLs only HTML-escaped. `javascript:` URLs ran on fumoca.co.za, where the Supabase session lives. | `js/modules/safe-url.js` (http/https only) plus PR #10's guarded versions of the affected modules. Contract tests are added to CI. |
| **High** | `claim_next_job()` (SECURITY DEFINER) was executable by **any signed-in user**. Anyone could grab other users' jobs and video paths, or stall the queue. | `supabase_migration_security_hardening.sql` → **must be run in Supabase.** |
| Medium | Legacy `orders` insert policy let a buyer insert `status='paid'`, `amount_zar=0`. | Same migration: buyers can insert pending, unpaid orders only. |
| Medium | Escaping gaps: camera bookmark names, timeline labels, SDK status and mobile widget HTML. | Escaped (from PR #10). |
| **High** | **Vehicle capture never worked.** It called `r2.upload()`, which doesn't exist, fell back to a different bucket, and queued a job RLS rejects. The user was still told "Uploaded! Processing will begin shortly". | Ported PR #8's fix: `r2.from('nif-videos')`, sign-in required, staged job, real errors, rollback. |
| High | `ad-preview.html` crashed on load (bare `three` import, no import map). | Import map added (three 0.180). |
| Medium | Public viewer showed mojibake ("Loading point cloudâ€¦", "Â·"). | Encoding repaired in viewer.js, viewer.html, feed.html. |
| Medium | Poster editor: near a corner, rotate/scale handles sat on top of Move, so dragging rotated instead. The frame was also 2 px too large. That browser test was **failing on main and not in CI**. | Edge-aware handle placement, border-box frame, corrected test, added to CI. |
| Low | 25 backup/log/zip files tracked despite `.gitignore`; `.before_*` copies were **published to the live site**. | Untracked; `build-pages.js` filter broadened. |
| Low | 9 passing test suites were not in CI. | Added. |

## Integration findings (fixed on `qa/integration-full`)

| Severity | Issue | Fix |
|---|---|---|
| **Critical** | **NIF chunk-ID collision.** #26 defines `MESH_COMPONENTS = 0x001A`, while #35 defines `GAUSSIAN_ANIMATION = 0x001A`. Animations would decode as mesh components. Studio save also strips 0x001A, so **every Studio save would have deleted the animation**. | `GAUSSIAN_ANIMATION` moved to **0x001D** (spec, NIFSpec.js, docs). |
| **High** | PR #33's R2 worker rejects any key not starting with `<userId>/`. Deploying it would break Studio save, #34's own 4D uploads, vehicle capture, poster subjects, review videos and more. | Upload rule: `<uid>/…` is owned; `<ns>/<uid>/…` is owned only by that uid; anything else is bound under `<uid>/`. A caller still can't write outside its own space. Tests extended. |
| Medium | Deleting splats in Studio after animating leaves `GAUSSIAN_ANIMATION` pointing at the wrong records, and viewers drop it silently. | Warning on save. A real remap of the IDs is still to do. |
| Medium | #25/#26 failed `main`'s save-contract test (written after they branched). | Test updated to the new save contract (always NIF, with SH kept in a GAUSSIAN_PLY chunk). |
| Low | #35 shipped a broken duplicate test (wrong import path, stale asserts). | Removed; the maintained copy remains. |

## Status of every open PR

**Included in `qa/integration-full`:** #4 (via #6), #5, #6, #7, #11, #14, #15, #24 and #25 (via #26), #26, #29 (rebased), #31, #32, #33 and #34 (via #35), #35.

**Not included — needs a decision or a rebuild:**

| PR | Why | Recommendation |
|---|---|---|
| #22 Presentation platform | Studio already has a Platform tab on `main` (`platform-tab.js`, splat and base rotate as one rig). #22 adds a second platform plus save/restore in the viewer. It conflicts with #28's Present-tab rewrite. | Keep `platform-tab.js`; port #22's save/restore and viewer restore into it. |
| #23 Selection / transforms / auto-level | 116 commits; rewrites `presentation-platform.js` (a third platform). 5 conflicting files including Studio. | Rebase in a browser. Keep its real fixes (quaternion order, empty selection moving the whole cloud, Oval select, support plane). |
| #27 APE foundation | A second APE design next to #28 (merged), adding a duplicate text/logo layers panel. Was merged, then reverted. | Close, or keep only the zoom/framing settings. |
| #21 Image/logo layers | Superseded by #28's poster image layers. Unique part: 3D world decals. | Close; port decals later. |
| #10 Full-platform QA | 677 commits / 120 files, 16 conflicts. URL/XSS parts already ported. | Split the rest into small PRs: NIF reader bounds (malformed-file DoS), R2 read auth, delete ownership/cleanup, explicit job IDs, stale-meta writes. |
| #8 Job & motion contract | Vehicle capture fix ported. The rest conflicts, and its own test fails on a code comment. | Rebase the remainder. |
| #1 Cleanup | 377 commits behind; its edit.html has a syntax error. | Close. |
| #12 / #18 / #19 Renderer & loading | #18's fixes are already on `main`; Spark replaced the native renderer. #12 is red in CI. | Close after a quick look. |

## Merge order

1. Give the Claude GitHub App write access to `fumoca_deply` so these branches can be pushed.
2. Run `supabase_migration_security_hardening.sql` in Supabase.
3. Merge `qa/2026-11-25-baseline-fixes` → `main`.
4. Open `qa/integration-full` as one PR. Merge once GitHub CI (including the animation suite) is green. Then close the PRs it contains.
5. Deploy the R2 worker **only** from the integration branch. #33's original rule breaks uploads.
6. Decide platform (#22/#23 vs `platform-tab.js`) and APE (#27 vs #28) before more Studio work.

## Not fixed — for later

* three.js versions are mixed: 0.160 (upload, splat-edit-engine), 0.170 (alignment), 0.180 (elsewhere).
* `config.js` is tracked although ignored. It only holds the public anon key, which is fine. Per its own comment, rotate `r2ApiSecret` if it was ever live.
* Dead code: `js/modules/pipeline.js` (no importers); `cloudflare/workers/delete-auth.js` (never wired in).
* Remap animation IDs on Studio save instead of only warning.
