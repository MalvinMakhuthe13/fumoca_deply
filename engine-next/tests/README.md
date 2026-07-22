# engine-next test suite

Real, executable tests — not aspirational. Run with plain Node (no build step, no
framework needed since these use plain assertions and exit codes):

```
node tests/format.test.mjs   # NIF binary format: header/chunk round-trip, CRC
                              # corruption detection + recovery, HMAC cert signing
node tests/graph.test.mjs    # NIFGraph: spatial hierarchy, quaternion animation
                              # interpolation, click->action->script wiring,
                              # semantic validation, LOD selection, JSON round-trip
```

Both exit 0 on full pass, 1 if anything fails — wire into CI as-is.

## What's proven so far (Phase 1 of ../ROADMAP.md)
- `format/NIFSpec.js` — 24/24 passing. Header and chunk data round-trip exactly,
  including float64 GPS coordinates. CRC32 corruption detection works. **Found and
  fixed a real bug**: the reader used to silently drop every chunk after a corrupted
  one with no signal to the caller — now it records `reader.errors[]` and exposes
  `reader.isCorrupted`, and recovers healthy chunks that come after a damaged one
  instead of losing them too. HMAC-SHA256 certificate signing/verification works and
  correctly rejects a wrong key.
- `graph/NIFGraph.js` — 19/19 passing. Quaternion slerp animation interpolation is
  mathematically correct (verified against hand-computed expected values, not just
  "does it run"). Click → action → script wiring works end to end. Semantic
  validation against a custom plugin schema correctly catches and clears a real
  missing-field error. LOD device-tier selection logic verified — worth a design
  review: in the narrow window where a low-end device excludes `depth_field` but
  hasn't reached the `mesh` distance threshold yet, it currently falls straight to
  the lowest-quality `proxy` rather than `mesh`. Might be intentional (conservative
  for weak devices) — flagging so it's a deliberate choice, not an accident.

## Not yet tested
`physics/NIFPhysics.js` (spot-checked by hand earlier in this conversation, not yet
a formal suite), `viewer-src/` (renderer — needs a browser/WebGL context, can't run
in plain Node), `editor/`, `backend-api/` (needs a live Supabase instance — see
Phase 2 in ../ROADMAP.md).
