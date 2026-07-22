# FUMOCA — Long-Term Platform Vision (parked)

Status: **Not in active development.** This is strategy, not a build spec. Revisit once
the core consumer app (this repo) is merged, tested, and running in production.

## Why this is parked, not pursued now
The current engineering reality: two divergent codebases being merged into one working
app, a mobile nav that's inconsistent across pages, a client-exposed secret, and an
unproven core format engine. Adding Pro/Enterprise/Compare/Inspect/Developer-SDK scope
on top of that before the base app ships would spread a solo-founder team across too many
fronts and risk none of it landing. Ship one good app first.

## The core ideas worth keeping (summarized, not exact source text)
- **.nf as a durable, portable format** — the file should outlive any single app, the way
  PDF did. Worth keeping as a design principle for NIF/SPAX even now: version it, don't
  let it depend on FUMOCA-app-specific internals.
- **Layered architecture**: UI → Controller → Service → API → DB, instead of UI/viewer/
  renderer talking directly to storage. This one *is* relevant now — see engine-next/
  separation already in progress.
- **Dual renderer, one importer**: detect format, route to Gaussian or NIF renderer
  transparently. Already the plan in ROADMAP.md Phase 4.
- **Future product tiers** (not being built now): a consumer social app (this repo), a
  professional inspection/capture/measurement tier, and an enterprise fleet/digital-twin
  tier, all sharing one backend/engine, differentiated by license — modeled loosely on
  how Adobe or Autodesk run one core tech across multiple products.
- **Comparison/inspection use case** (Compare two spatial scans over time to detect and
  classify physical changes — vehicles, property, construction, agriculture) as a
  possible high-value future vertical once the capture/format pipeline is proven solid.

## When to revisit
After: engine-next is wired, tested, and merged into one working app; mobile nav and PWA
gaps are fixed; production security gaps (client-exposed secrets, webhook signature
verification) are closed. At that point, decide whether Pro/Enterprise is worth pursuing
as a second product surface, or whether that ambition is better served by first proving
the consumer app has real users.
