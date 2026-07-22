# FUMOCA Merge Roadmap — final (base) + v4 (engine-next)

## Structure right now
This zip = `fumoca_final` (your tested, working app — UI, feed, splat pipeline, PWA/share
config, all untouched and still fully functional) **plus** a new `engine-next/` folder
containing everything valuable from v4, kept isolated so nothing that currently works
can break:

- `engine-next/format/`      → NIFSpec.js, SPAXSpec.js — the new file format definitions
- `engine-next/graph/`       → NIFGraph.js — scene graph engine
- `engine-next/math/`        → NIFMath.js — math library the format depends on
- `engine-next/physics/`     → NIFPhysics.js
- `engine-next/reconstruction/` → Python pipeline (Gaussian → NIF reconstruction)
- `engine-next/print/`       → NIFPrintPipeline.py — 3D print export
- `engine-next/viewer-src/`  → v4's modular renderer (device-tier detection, transitions,
  sort worker) — reference implementation for eventually replacing final's monolithic
  viewer.html rendering internals
- `engine-next/editor/`      → v4's presentation editor (hotspots, camera path recorder,
  audio layer) — more advanced than final's editor, not yet wired to final's UI
- `engine-next/backend-api/` → v4's Express API (routes, middleware, S3/R2 via server) —
  untested, kept separate from final's direct-to-Supabase calls
- `engine-next/db-reference/` → v4's schema.sql + extensions, for comparison against
  final's supabase_schema.sql before touching production DB
- `engine-next/docs/`        → NIF_SPEC_v1.0.md, IMPLEMENTATION_GUIDE.md

**Nothing in engine-next is wired into the live app yet.** That's intentional — v4 was
never fully tested, so nothing from it becomes load-bearing until it's proven.

## Why this order
Final works and produces real splats. v4 is the ambitious next-gen format but unproven.
Wiring untested code into a working app without isolation is exactly how you end up
debugging a tangled failure with no clear rollback — same shape as the Brydgess schema
mess. Keeping v4 in its own lane means you can test each piece in isolation, and if
something doesn't pan out, final never stops working.

## Phase 1 — Prove the format engine standalone (no UI, no DB)
### ✅ DONE — format + graph layers proven with real, executable tests
See `tests/README.md` for how to run these. Summary:

- **`format/NIFSpec.js` — 24/24 tests passing.** Full write→serialize→read round-trip
  verified byte-exact, including float64 GPS coordinates and a 100-point geometry
  chunk. HMAC-SHA256 encoder certificates sign and verify correctly (and correctly
  reject a wrong key). **Found and fixed a real bug in the process**: when one chunk
  in a file was corrupted, the reader used to silently drop that chunk *and every
  chunk after it*, with no signal to the calling app — a viewer would've just shown
  "no material data" instead of "this file is damaged." Fixed: `NIFReader` now
  exposes `.isCorrupted` and `.errors[]`, and recovers healthy chunks that come after
  a damaged one instead of losing them too. This matters more than usual for NIF
  given the vehicle-inspection/comparison use case discussed — corruption needs to be
  loud, not silent, if this format is ever going to carry evidentiary weight.
- **`graph/NIFGraph.js` — 19/19 tests passing.** Built a real test scene (car body +
  wheel, matching the automotive inspection use case), animated wheel rotation via
  quaternion keyframes, and verified the slerp interpolation against hand-computed
  expected values at the midpoint — not just "did it run," but "is the math right."
  Click → action → script wiring works end to end. Semantic validation against a
  custom plugin schema correctly catches a real missing-field error and clears once
  fixed. JSON round-trip (`toJSON`/`fromJSON`) preserves the scene correctly.
  One design question surfaced, not fixed (needs a decision, not a patch): in the LOD
  ladder, a low-end device in the ~10-50m range currently falls straight from
  `depth_field` to the lowest-quality `proxy`, skipping `mesh` — worth confirming
  that's intentional rather than an oversight.

### Not yet tested
`physics/NIFPhysics.js` was spot-checked by hand (spring-damper sign convention
verified correct) but doesn't have a formal test suite yet. `viewer-src/` (the
renderer) needs a real browser/WebGL context and can't be verified in plain Node —
that's Phase 4 (wiring it into final's actual viewer, where it can be tested for
real). `editor/` likewise needs DOM/UI testing, not unit tests.

## Phase 2 — Prove the backend API standalone
### ⚠️ Partially done — honest status
I don't have network access to a live Supabase instance from where I'm working, so the
full "hit every route against a real DB" version of this phase isn't something I could
actually do here. What I did instead: tested everything in `backend-api/` that doesn't
require a live database connection, and found two real, fixed issues in the process.

- **`middleware/rateLimit.js` — 10/10 tests, one real bug found and fixed.** The sliding
  window logic itself is correct (isolation per key, correct blocking, correct reset
  after the window expires). But **the very first request in every fresh rate-limit
  window was returning early and skipping the `X-RateLimit-*` header-setting entirely**
  — only the 2nd+ request in a window ever got `X-RateLimit-Limit`/`Remaining`/`Reset`
  headers. Any client UI trying to show "4 uploads remaining" would have nothing to show
  on someone's very first call. Fixed and verified: now every request, including the
  first, gets correct headers.
- **`middleware/webhooks.js` (outbound webhook signing) — 7/7 tests, refactored for
  testability.** Correction to my own earlier notes: **there is no PayFast integration
  anywhere in this codebase** — I'd conflated it with BaseMarket's PayFast work when I
  first wrote this checklist. What actually exists here is an *outbound* webhook system
  (FUMOCA notifying a user's registered endpoint when e.g. a reconstruction finishes),
  signed with HMAC-SHA256. The signing logic was buried inside a non-exported function
  tightly coupled to a live Supabase call, so it wasn't testable as written — pulled it
  out into an exported `buildSignedDelivery()` pure function (same computation, zero
  behavior change) and verified: signatures are independently reproducible with the
  correct secret, a wrong secret produces a different signature (spoofing protection
  works), and different events don't share signatures (no replay risk).
- **Route handlers (`routes/presentations.js`, `middleware/social.js`,
  `middleware/analytics.js`) — not yet tested.** These need a real Supabase connection
  (reads/writes against actual tables) to test meaningfully; mocking the whole
  `.from().select().eq()` chain convincingly is possible but wasn't done here. This is
  the part that genuinely needs Phase 2 done against a real (ideally throwaway/staging)
  Supabase project, not something I can respond around.

### Still needed — requires an actual Supabase project (can't be done from here)
Spin up `engine-next/backend-api` against a **copy** of your Supabase project (not
production). Hit each route in `routes/presentations.js` manually (upload, presentations,
webhooks) and confirm it actually does what it claims. `npm install && npm test` in
`engine-next/backend-api/` runs everything that *is* testable without that connection.

## Phase 3 — Reconcile schemas
Diff `engine-next/db-reference/schema*.sql` against `supabase_schema.sql` (final's, at
project root). Some tables will overlap (users, scenes/presentations). Decide per-table:
keep final's, adopt v4's, or merge columns. Do this on paper before running anything
against production.

## Phase 4 — Wire NIF/SPAX as an *additional* format, not a replacement
In final's viewer/editor, add NIF/SPAX as a second supported import/export format
alongside `.fumoc`. Users can still make and view normal Gaussian splats the whole time.
Only promote NIF/SPAX to default once it's held up under real usage.

## Phase 5 — Mobile & production hardening pass (on final's shell, safe to do anytime,
doesn't depend on the above)

### ✅ DONE — Navigation unification (this pass)
Found and fixed: **6 independent hand-rolled nav implementations** across the app
(index.html, feed.html, profile.html + 3 dashboard.css pages sharing one broken pattern,
convert.html), each with a different link set, and 3+ different color-token vocabularies
where the same variable name (`--black`) resolved to different actual colors on different
pages. On mobile, feed.html had no way to reach Profile/Notifications/Settings at all —
just a single "+" button.

Fixed by building **one** shared nav component instead of patching each page:
- `css/tokens.css` — canonical design tokens (single source of truth for colors)
- `js/modules/nav.js` — self-injecting nav: mobile hamburger + slide-in drawer with the
  full social menu (Feed, Discover, Create, Alerts w/ badge, Profile, Studio tools,
  Settings, user avatar/name), persistent sidebar on desktop (≥900px). Exposes
  `window.FumocaNav.setBadge(name, count)` and `.setUser({name, handle, avatarUrl})` for
  pages to call.
- `css/nav.css` — styling for both breakpoints
- Wired into feed.html, profile.html, notifications.html, settings.html, upload.html,
  convert.html — old sidebar markup removed from each, `dashboard-shell.js` updated to
  feed real user data into the new component
- index.html (logged-out marketing page) intentionally kept its own separate, simpler
  hamburger — it shouldn't show Profile/Alerts links to a visitor who hasn't signed up
- edit.html, viewer.html, scene.html, showroom.html, media-edit.html marked
  `data-nav="none"` — full-screen tools that had zero nav by original design; kept that
  way rather than bolting on an unreviewed "back" affordance
- Fixed 3 layered CSS bugs found *while* wiring this in: `dashboard.css`'s `.app-shell`
  grid was reserving its own 240px column on top of the new nav's own offset (would have
  doubled the gap); a later "final layout fix" block in the same file was silently
  reasserting the old `margin-left:260px` after my first fix; a 1100px breakpoint was
  doing the same. All three fixed and verified together.
- Verified with an actual DOM test harness (jsdom), not by eye: nav mounts exactly once
  per page, active-state highlighting is correct per page, badge API updates all 3 badge
  locations at once, hamburger open/close works, `data-nav="none"` opt-out works.

### ✅ DONE — "breezy" interaction polish (feed + nav)
Same colors throughout — this is motion/feedback, not a re-theme:
- Tap/press feedback (spring scale-down) added to every interactive element across
  the feed and the shared nav — buttons previously had zero visual response to touch.
- Double-tap-to-like on post images, the gesture people already know from
  Instagram/Facebook — heart burst animation, layered on top of the *existing*
  single-tap-to-open behavior without adding any delay to it (verified: rapid
  double-tap still opens the viewer instantly on the first tap, no regression).
- Like button now has a spring pop animation instead of an instant icon swap.
- Post images/video fade in once loaded instead of popping in abruptly.
- Feed loading state replaced with content-shaped skeleton cards (shimmer effect)
  instead of a bare spinner + "Loading feed…" text.
- Mobile drawer now opens with a springier easing curve instead of flat linear.
Verified with a real logic test: double-tap detection correctly distinguishes rapid
taps from slow ones and never delays the primary open action.

**Still open on nav:** `open.html` and other standalone tool pages (ad-studio,
capture-vehicle, splat-edit-engine, viewer-core, etc.) were never wired to any nav in the
original codebase either — left as-is since they appear to be intentional full-screen
tools, but worth a quick confirmation pass. `docs/fumoc-spec.html`, linked from convert.html's
old sidebar, doesn't exist (pre-existing broken link, unrelated to this change).

### Still to do
- [ ] **Move `r2ApiSecret` out of `config.js`** — it's currently shipped to every browser.
      Proxy R2 writes through `cloudflare/workers/r2-storage.js` (already exists) using a
      server-side-only secret, and stop exposing it to the client.
- [ ] Confirm `og-meta.js` worker is deployed and pointed at production domain — this is
      what makes fumoca.co.za links render previews in WhatsApp/iMessage/Slack. Test by
      pasting a real scene link into WhatsApp.
- [ ] Verify `manifest.json`'s `share_target` and `file_handlers` actually work on a real
      Android/iOS device (install as PWA, share a file into it, open a `.fumoc` from
      Files app) — manifest correctness ≠ working share sheet, both need device testing.
- [ ] Audit touch targets and viewport meta across `viewer.html`, `feed.html`, `edit.html`
      (these are large hand-built files — check they weren't primarily tested on desktop).
- [ ] Confirm `sw.js` cache versioning bumps correctly on deploy (currently `fumoca-v93` —
      make sure your deploy pipeline updates this or old clients get stuck on stale JS).
- [ ] Set real CSP headers in `_headers` (currently has good security headers but no
      `Content-Security-Policy` — worth adding before production launch).
- [x] ~~Confirm PayFast/webhook endpoints (in v4's `api/middleware/webhooks.js`) use
      signature verification~~ — **correction**: there is no PayFast integration
      anywhere in the FUMOCA codebase (v4 or final). That's a BaseMarket feature; I
      conflated the two projects when I first wrote this checklist. What
      `backend-api/middleware/webhooks.js` actually is: an *outbound* webhook system
      (FUMOCA notifying third-party integrations when a reconstruction/print job
      finishes), not payment handling. See Phase 2 findings below for what was
      actually tested there.

## Phase 6 — Full regression test pass
Once Phases 1–4 land, test the whole merged app end to end: capture → upload → view →
share → WhatsApp preview → PWA install → offline reload. This is the point where you
sign off on "production ready."

## ✅ Final QA/QC pass (whole-repo, browser-verified)
This pass used a real headless Chromium (via Playwright), not just static code
reading — several findings here only surfaced by actually loading pages and reading
V8's own error output.

- **Real bug found and fixed: `feed.html` had a genuine orphaned extra `}`** at the
  end of `loadTrendingTags()`, causing "Unexpected token '}'" and silently breaking
  the entire inline module script (stories, suggestions, trending tags, notif
  checks — none of it ran). This had been misdiagnosed twice earlier in this project
  as a sandbox network artifact (blocked `esm.sh`) — that diagnosis was wrong. Found
  the real cause by using Chrome DevTools Protocol directly to get V8's exact
  file/line/column for the exception, rather than guessing from symptoms. Confirmed
  fixed: zero exceptions on reload, isolated the exact line via binary search first
  to be sure before editing.
- **Found and fixed: the shared nav (`js/modules/nav.js`) still said "New Splat" and
  "Splat Studio"** in the sidebar/drawer — missed during the earlier rename pass since
  that pass only touched feed.html/viewer.html/feed.js specifically. Renamed to "New
  Capture" / "Editor" for consistency with the rest of the rebrand, verified the
  active-state highlighting logic still works correctly after the change.
- **Verified clean, all 10 core pages** (index, feed, upload, viewer, profile,
  notifications, settings, convert, login, signup): zero real console errors on load
  when served correctly over HTTP. ("Real" excludes this sandbox's specific network
  allowlist blocking `esm.sh`/`fonts.googleapis.com`/`jsdelivr.net` — confirmed via a
  mocking test that those specific blocks are not the cause of anything reported as a
  real bug in this pass.)
- **Verified visually** (screenshots at both mobile and desktop widths): feed's
  tabs-row fade/scroll fix works correctly in both the "more to scroll" and
  "scrolled to end" states; the shared nav sidebar and mobile drawer render
  correctly; upload.html renders its full styled layout when served properly;
  index.html's dark hero renders correctly (an earlier screenshot in this same
  session that looked blank/white was my own test script's screenshot timing, not a
  real bug — caught and corrected before reporting it).
- **Re-ran the full existing test suite** (format 24/24, graph 19/19, rateLimit
  10/10, webhookSigning 7/7, R2 auth 6/6, feed-polish 4/4 — 70/70) plus a fresh
  repo-wide JS syntax sweep: zero errors.
- **Re-confirmed the `file://` diagnostic banner** still works correctly after all
  changes this session: shows when a page is opened via `file://`, stays hidden when
  served correctly over HTTP.

### What's still genuinely open (not fixed by this pass, by design)
- `viewer.html`'s actual 3D rendering can't be verified without a real Three.js/
  gaussian-splats-3d CDN connection, which this sandbox can't reach — the hint text
  and panel-visibility fixes are confirmed, but the renderer itself needs testing on
  a real machine with real internet.
- `profile.html`/other auth-gated pages redirect to `login.html` without a live
  Supabase session — expected behavior, not a bug, but means their full content
  can't be visually verified from this sandbox either.
- Everything already flagged as open in Phases 2–6 above (live-DB route testing,
  schema reconciliation, the R2 delete-endpoint ownership-check gap, the DB/storage
  "splat" rename migration) is still open — this QA pass didn't change that scope,
  it verified what's already shipped is solid.


## ✅ Verification sweep — "does every file actually match" (whole-repo check)
Ran a real, mechanical check rather than eyeballing: syntax-checked every `.js` file in
the repo, and checked every `src`/`href` in every `.html` file actually resolves to a
real file. Found and fixed:

- **`engine-next/editor/NIFSceneEditor.js` had two entire copies of the same 2500-line
  class concatenated together** (a merge artifact from however the original file was
  assembled) — the second copy was missing its opening comment token, which is what
  broke the syntax check. Compared the two copies directly: the first has a real,
  working selection system (`_boxSelect`, `_lassoSelect`, `_magicWandSelect`, full
  hotkey wiring — 68 methods); the second was a stale, older version missing that
  entire feature (44 methods, selection only mentioned in a leftover HTML comment, never
  implemented). Kept the complete version, removed 1272 lines of stale duplicate.
- **`js/modules/publish-to-fumoca.js` declared `const ext` twice** in the same function
  — a leftover from a prior edit that added a hardcoded override without removing the
  old conditional line it was replacing. Turned out `ext` isn't even read anywhere else
  in the file (the upload path already hardcodes `.splat` directly), so this was dead
  code with a syntax error baked in. Cleaned up to one declaration with a comment
  explaining why.
- **`convert.html` and `open.html` each have a duplicate twin** at `convert/index.html`
  and `open/index.html` (routing artifact — likely so both `/convert` and `/convert.html`
  work). My earlier nav-unification pass only touched `convert.html`, leaving
  `convert/index.html` — the one actually served at the clean `/convert` URL — with the
  old broken sidebar. Found this specifically by checking for the pattern app-wide.
  Synced both pairs so whichever route serves the page, the content is identical
  and fixed.
- **A dead link to `docs/fumoc-spec.html`** (a spec page that doesn't exist anywhere in
  either codebase) was live in `open.html` and its twin. Disabled it cleanly with a
  "coming soon" state instead of shipping a 404 — a real spec page still needs to be
  written at some point.
- Confirmed clean: `ad-studio.html`'s flagged references are HTML-escaped example code
  shown to users as copyable snippets, not live links — no fix needed.

**Result: zero JS syntax errors and zero broken local file references anywhere in the
delivered app**, re-verified after every fix. All 64 tests (format/graph/rateLimit/
webhookSigning/feed-polish) still pass — none of these fixes touched tested code paths,
confirmed by re-running the full suite after each change.
