# FUMOCA — Deployment Guide

This covers every service in the stack, in the order you'd redeploy them, plus how to
verify each one actually reached production (not just "the command didn't error").

## Architecture — what's actually live vs. not yet

Based on the real URLs already in `config.js`, this is what's live in production today:

| Service | What it does | Status |
|---|---|---|
| **Frontend** (this repo's root `.html`/`css`/`js`) | The app itself | 🟢 Live — `fumoca.co.za` |
| **Supabase** | Auth + Postgres DB | 🟢 Live — project `sjxkgdaaknflnviwjbej` |
| **R2 Storage Worker** (`cloudflare/workers/r2-storage.js`) | File upload/serve/delete | 🟢 Live — `fumoca-r2-storage.fumocaapp.workers.dev` |
| **OG Meta Worker** (`cloudflare/workers/og-meta.js`) | Link previews (WhatsApp/iMessage/Slack) | 🟢 Live — routes on `fumoca.co.za/viewer*` |
| **Kaggle GPU Worker** (`kaggle/fumoca_kaggle_worker.py`) | Gaussian splat reconstruction (COLMAP + training) | 🟡 Live but manual — see below |
| **Backend API** (`engine-next/backend-api/`) | New Express API, NIF format backend | 🔴 Not deployed — still Phase 2 in `engine-next/ROADMAP.md` |
| **NIF/SPAX engine** (`engine-next/format`, `graph`, etc.) | New file format | 🔴 Not wired into the live app — isolated in `engine-next/`, tested standalone only |

Redeploy order matters less between the 🟢 services (they're independent), but always
redeploy **Supabase schema changes first**, then workers, then frontend — the frontend
and workers both assume the schema they were built against already exists.

---

## 1. Supabase (schema/migrations)

```bash
# Paste the relevant .sql into Supabase SQL Editor and run, OR via CLI:
supabase db push
```
No automated migration runner is wired up yet — this is manual today. If you're
reconciling `engine-next/db-reference/schema*.sql` (v4's schema) with the live one,
that's Phase 3 in `engine-next/ROADMAP.md` — do that comparison before running anything
against production.

**Verify:**
```bash
curl -s "https://sjxkgdaaknflnviwjbej.supabase.co/rest/v1/" \
  -H "apikey: <your anon key>" -o /dev/null -w "%{http_code}\n"
# → 200 means the project is reachable
```

---

## 2. Cloudflare Workers (R2 storage + OG meta)

```bash
cd cloudflare
wrangler login          # once per machine
wrangler deploy         # deploys workers/r2-storage.js (per wrangler.toml)
wrangler deploy --config wrangler-og.toml   # deploys workers/og-meta.js
```

**Required secrets** (see `cloudflare/DEPLOY.md` for the full list and — important —
a note on rotating `FUMOCA_API_SECRET` if you're redeploying an existing worker, since
it used to be exposed client-side before this session's security fix):
```bash
wrangler secret put FUMOCA_API_SECRET   # server-to-server only, never in frontend code
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
```

**Verify:**
```bash
curl -s https://fumoca-r2-storage.fumocaapp.workers.dev/health
# → {"ok":true,"service":"fumoca-r2","ts":...}

curl -s -I https://fumoca.co.za/viewer?id=test | grep -i "og:"
# → should show og:title / og:image meta tags (confirms the OG worker is routing)
```

---

## 3. Frontend (this repo's root)

This is static HTML/CSS/JS — no build step. Deploy however you're currently hosting it
(cPanel per your existing setup, or Cloudflare Pages if you migrate):

```bash
# cPanel / rsync-style host:
rsync -avz --exclude 'engine-next' --exclude 'node_modules' --exclude '.git' \
  ./ user@yourhost:/path/to/public_html/

# Cloudflare Pages (if/when you move to it):
wrangler pages deploy . --project-name=fumoca --exclude-paths engine-next
```
`engine-next/` should **never** be deployed to the public frontend — it's your isolated
dev/test area (unproven format engine, untested backend). Excluding it isn't optional.

**Verify:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://fumoca.co.za/
curl -s -o /dev/null -w "%{http_code}\n" https://fumoca.co.za/feed.html
# both should be 200
```

---

## 4. Kaggle GPU Worker (reconstruction pipeline)

This one's operationally different from the others — Kaggle doesn't support persistent
background services, so this is a manual runbook, not a `deploy` command:

1. Open the notebook: `kaggleNotebookUrl` in `config.js`
   (`https://www.kaggle.com/code/malvinmakhuthe/notebook6ce27d38de`)
2. Run `kaggle/kaggle_bootstrap.py` (clones `gaussian-splatting`, installs deps)
3. Run `kaggle/fumoca_kaggle_worker.py` — this polls Supabase for queued jobs every
   `POLL_SECONDS` (10s default) and processes them in a `while True` loop
4. **It will die when the Kaggle session times out** (Kaggle's free-tier GPU session
   limit) — this needs to be manually restarted periodically. There's no supervisor/
   auto-restart built in right now.

**Verify it's actually processing jobs** (not just that the notebook is "running"):
```sql
-- Run in Supabase SQL Editor — jobs stuck in 'queued' for >10 min likely mean
-- the worker isn't actually polling right now, even if the notebook is open
select id, status, created_at, now() - created_at as age
from processing_jobs
where status = 'queued'
order by created_at asc
limit 10;
```
If you see queued jobs aging past a few minutes, go restart the worker in Kaggle.

**Known risk from `worker_fallback_patch.py`** (already applied, worth knowing about):
reconstruction failures used to silently upload a hardcoded 8-vertex cube as if it were
the user's real splat. That's been changed to fail loudly (`status="failed_reconstruction"`)
instead of shipping garbage — good to know if you see that status appear in the DB.

---

## 5. Backend API (`engine-next/backend-api/`) — when you're ready

Not deployed yet, by design — see Phase 2 in `engine-next/ROADMAP.md`. When you are:

```bash
cd engine-next/backend-api
npm install
npm test          # runs everything that's testable without a live DB — should be 10/10 + 7/7
# then deploy to Render/wherever, with real env vars:
#   SUPABASE_URL, SUPABASE_SECRET_KEY, R2 credentials, FUMOCA_API_SECRET
```

---

## Full redeploy checklist (in order)
1. [ ] Run `scripts/health-check.sh` **before** you start, so you have a baseline
2. [ ] Supabase schema changes (if any) — manual SQL Editor or `supabase db push`
3. [ ] `cd cloudflare && wrangler deploy` (both workers)
4. [ ] Frontend sync to your host
5. [ ] Run `scripts/health-check.sh` again — confirm everything that was green before
      is still green, and anything you changed now reflects the update
6. [ ] Manually check the Kaggle worker is still running (see §4)
7. [ ] Smoke test by hand: sign up/log in → upload → confirm it appears in feed →
      open the viewer → paste the link into WhatsApp and confirm the preview renders
