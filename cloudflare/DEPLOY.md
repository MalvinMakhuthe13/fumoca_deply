# FUMOCA R2 Storage — Deploy Guide

## ⚠️ If you're redeploying an existing worker, rotate this secret first
`config.js` used to ship `r2ApiSecret` to every browser (readable via view-source) —
that's been removed from the frontend now, and the worker's auth model changed to
verify real Supabase sessions instead. But if `fumoca-r2-2026-xK9mP3qL` (or whatever
your `FUMOCA_API_SECRET` was) was ever live in production, it may already be known to
anyone who inspected the page source. Rotate it as part of this deploy:
```bash
wrangler secret put FUMOCA_API_SECRET
# → enter a fresh strong random string, e.g. `openssl rand -hex 32`
```
That secret is now reserved for genuine server-to-server calls only (the Kaggle worker,
the backend API) — it must never appear in any file that ships to a browser again.

## Prerequisites
- Node.js installed
- `npm i -g wrangler` (Cloudflare CLI)
- Logged in: `wrangler login`

## Step 1 — Create R2 bucket
```bash
wrangler r2 bucket create fumoca-assets
```

## Step 2 — Deploy worker
```bash
cd cloudflare
wrangler deploy
```

## Step 3 — Set secrets and vars
```bash
wrangler secret put FUMOCA_API_SECRET
# → server-to-server only, never sent from a browser — see warning above

# The worker now verifies real user sessions by asking Supabase directly.
# Both of these are the SAME public-safe values already in your frontend config.js —
# not new secrets, just need to also be available to the worker:
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY

# Only needed if you want presigned PUT URLs (optional — worker proxy works without these):
wrangler secret put R2_ACCESS_KEY_ID       # from CF dashboard → R2 → Manage API tokens
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put ACCOUNT_ID            # your Cloudflare Account ID
```

## Step 4 — Update config.js
```js
r2WorkerUrl: 'https://cdn.fumoca.co.za',   // or your worker URL
// r2ApiSecret is no longer needed here — do NOT add it back. The browser now
// authenticates with the user's real Supabase session token instead.
```

## Step 5 — DNS
In Cloudflare DNS for fumoca.co.za:
- Add CNAME: `cdn` → `fumoca-r2-storage.<yoursubdomain>.workers.dev`
- Proxy: ON (orange cloud)

## Step 6 — Verify
```bash
curl https://cdn.fumoca.co.za/health
# → {"ok":true,"service":"fumoca-r2","ts":...}

# Confirm the old exposed secret no longer works (should be 401, not 200):
curl -X DELETE https://cdn.fumoca.co.za/file/splats/test \
  -H "X-Fumoca-Secret: fumoca-r2-2026-xK9mP3qL"
```

## Known remaining gap
Delete currently only checks that *some* authenticated user is calling, not that they
own the specific file — see the `NOTE` comment in `workers/r2-storage.js` above the
DELETE route. Closing that needs a query against your `splats` table with your actual
schema/RLS setup, which wasn't safe to guess at here.

## What changed from v76
| Module | Change |
|---|---|
| pipeline.js | Video upload → R2 splat-videos |
| publish-to-fumoca.js | Splat binary → R2 splat-files |
| splat-edit-engine.js | Inline splat save → R2 splat-files |
| edit-engine.js | Variant save → R2 splat-files |
| mobile-asset.js | Widget HTML → R2 splat-files |
| splat-capture.js | Capture preview → R2 preview-videos |
| teaser-video.js | Teaser video → R2 preview-videos |
| upload-page.js | PLY + video upload → R2 (TUS removed) |
| feed.js | File deletes → R2 |
| viewer.js | File deletes → R2 |
| profile.js | File deletes → R2 |

Supabase DB (splats, processing_jobs, profiles etc.) is unchanged.
