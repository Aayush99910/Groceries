#!/usr/bin/env bash
#
# Run this Mac as the grocery server.
#
# Builds the frontend, then serves everything from one uvicorn process wrapped in
# `caffeinate` so the Mac won't fall asleep and drop the connection while she's
# mid-shop. caffeinate only holds sleep off for as long as this script runs -- quit
# it and normal power behaviour comes straight back. No sudo, nothing to undo.
#
#   ./serve.sh              build the frontend, then serve
#   ./serve.sh --no-build   skip the build (frontend hasn't changed)
#
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
VENV="./backend/.venv/bin"

if [ ! -x "$VENV/uvicorn" ]; then
  echo "No virtualenv yet. Run:"
  echo "  cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
  exit 1
fi

if [ "${1:-}" != "--no-build" ]; then
  echo "Building the frontend…"
  (cd frontend && [ -d node_modules ] || npm install)
  (cd frontend && npm run build)
fi

# The .local name is advertised over Bonjour and resolves on iPhones, so it keeps
# working when the router hands this Mac a different IP.
HOST_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
IP="$(ipconfig getifaddr en0 2>/dev/null || echo 'unknown')"

cat <<BANNER

  Groceries is starting.

  On this Mac        http://localhost:$PORT
  On her phone       http://$HOST_NAME.local:$PORT
  If .local fails    http://$IP:$PORT

  The Mac will stay awake while this runs. Ctrl-C to stop.
  Note: closing the lid still sleeps a MacBook -- leave it open, or see the
  "Keeping it awake" section in README.md.

BANNER

# -s prevents system sleep, -i prevents idle sleep.
exec caffeinate -si "$VENV/uvicorn" app.main:app \
  --app-dir backend \
  --host 0.0.0.0 \
  --port "$PORT"
