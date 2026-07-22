#!/usr/bin/env bash
# FUMOCA — one-command local server for testing.
#
# WHY THIS EXISTS: this app uses ES modules for most interactive JS. Browsers
# refuse to load ES modules over the file:// protocol (double-clicking an
# .html file) — that's a real browser security restriction, not a bug here.
# Opening files directly will show correct CSS/layout but silently fail to
# run anything that makes the page interactive (uploads, feed data, nav
# user info, etc), which looks like "everything is broken."
#
# Usage:  ./scripts/serve-local.sh [port]
# Then open the URL it prints — NOT by double-clicking any .html file.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8000}"

cd "$REPO_ROOT"

echo "── FUMOCA local server ──────────────────────────────────────"
echo "Serving: $REPO_ROOT"
echo "URL:     http://localhost:$PORT/feed.html"
echo "         (or /index.html, /upload.html, etc.)"
echo ""
echo "Press Ctrl+C to stop."
echo "────────────────────────────────────────────────────────────"
echo

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m SimpleHTTPServer "$PORT"
elif command -v npx >/dev/null 2>&1; then
  exec npx --yes serve -l "$PORT" .
else
  echo "No Python or Node found. Install either, or run any static file"
  echo "server of your choice from this directory on port $PORT."
  exit 1
fi
