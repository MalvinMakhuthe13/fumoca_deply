#!/usr/bin/env bash
# FUMOCA — health check across every live service.
# Usage: ./scripts/health-check.sh
# Reads config.js for public URLs (no secrets needed for these checks).
# Exits 0 if everything checked is healthy, 1 if anything failed.

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/config.js"

PASS=0
FAIL=0
pass() { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

if [ ! -f "$CONFIG_FILE" ]; then
  echo "config.js not found at $CONFIG_FILE — run this from the repo, or edit CONFIG_FILE above."
  exit 1
fi

extract() { grep -o "$1: *'[^']*'" "$CONFIG_FILE" | head -1 | sed "s/.*'\(.*\)'/\1/"; }

SITE_URL=$(extract "siteBaseUrl")
SUPABASE_URL=$(extract "supabaseUrl")
SUPABASE_ANON_KEY=$(extract "supabaseAnonKey")
R2_WORKER_URL=$(extract "r2WorkerUrl")

echo "── FUMOCA health check ──────────────────────────────────────"
echo

echo "1. Frontend ($SITE_URL)"
if [ -n "$SITE_URL" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SITE_URL/" 2>/dev/null)
  [ "$code" = "200" ] && pass "root page: HTTP $code" || fail "root page: HTTP $code (expected 200)"

  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SITE_URL/feed.html" 2>/dev/null)
  [ "$code" = "200" ] && pass "feed.html: HTTP $code" || fail "feed.html: HTTP $code (expected 200)"
else
  fail "siteBaseUrl not found in config.js"
fi
echo

echo "2. Supabase ($SUPABASE_URL)"
if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/" 2>/dev/null)
  [ "$code" = "200" ] && pass "REST API reachable: HTTP $code" || fail "REST API: HTTP $code (expected 200)"
else
  fail "supabaseUrl/supabaseAnonKey not found in config.js"
fi
echo

echo "3. R2 Storage Worker ($R2_WORKER_URL)"
if [ -n "$R2_WORKER_URL" ]; then
  resp=$(curl -s --max-time 10 "$R2_WORKER_URL/health" 2>/dev/null)
  if echo "$resp" | grep -q '"ok":true'; then
    pass "worker healthy: $resp"
  else
    fail "worker did not return ok:true — got: $resp"
  fi

  # Confirm the old exposed secret (if it was ever live) no longer works.
  # A 401 here is GOOD (means it was rotated / the new auth model is active).
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X DELETE \
    "$R2_WORKER_URL/file/splats/__healthcheck_probe__" \
    -H "X-Fumoca-Secret: fumoca-r2-2026-xK9mP3qL" 2>/dev/null)
  if [ "$code" = "401" ]; then
    pass "old exposed secret correctly rejected (HTTP 401)"
  elif [ "$code" = "200" ]; then
    fail "old exposed secret STILL WORKS (HTTP 200) — rotate FUMOCA_API_SECRET now, see cloudflare/DEPLOY.md"
  else
    echo "  ⚠️  unexpected response (HTTP $code) checking secret rotation — verify manually"
  fi
else
  fail "r2WorkerUrl not found in config.js"
fi
echo

echo "4. OG Meta Worker (link previews)"
if [ -n "$SITE_URL" ]; then
  body=$(curl -s --max-time 10 "$SITE_URL/viewer?id=healthcheck" 2>/dev/null)
  if echo "$body" | grep -qi 'og:'; then
    pass "OG meta tags present on /viewer route"
  else
    echo "  ⚠️  no og: tags found — could be a real issue, or just that id=healthcheck isn't a real splat. Verify manually with a real splat link."
  fi
fi
echo

echo "5. Backend API (engine-next — expected DOWN until Phase 2 deploy)"
if [ -n "${FUMOCA_BACKEND_URL:-}" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$FUMOCA_BACKEND_URL/health" 2>/dev/null)
  [ "$code" = "200" ] && pass "backend API healthy: HTTP $code" || fail "backend API: HTTP $code"
else
  echo "  ⏭️  FUMOCA_BACKEND_URL not set — skipping (expected, not deployed yet per ROADMAP.md)"
fi
echo

echo "6. Kaggle GPU worker"
echo "  ⏭️  Can't be checked over HTTP — it's a polling worker inside a Kaggle notebook."
echo "      Run this in Supabase SQL Editor to check for stuck jobs instead:"
echo "      select id, status, now()-created_at as age from processing_jobs"
echo "      where status='queued' order by created_at asc limit 10;"
echo

echo "────────────────────────────────────────────────────────────"
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
