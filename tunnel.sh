#!/usr/bin/env bash
#
# Expose the local server on a public HTTPS URL via Cloudflare Tunnel.
#
# Run ./serve.sh in one terminal, then ./tunnel.sh in another.
#
# This makes an OUTBOUND connection to Cloudflare -- no router ports are opened
# and nothing can knock on this Mac directly. Cloudflare terminates TLS, so
# traffic between her phone and the tunnel is encrypted the whole way.
#
# Caveat: with no domain configured this uses a "quick tunnel", whose URL is
# random and CHANGES EVERY TIME this script restarts. For a URL worth bookmarking
# you need a domain in your Cloudflare account -- see README.md.
#
set -euo pipefail

PORT="${PORT:-8000}"
LOG="${TMPDIR:-/tmp}/groceries-tunnel.log"

if ! command -v cloudflared >/dev/null; then
  echo "cloudflared isn't installed. Run:  brew install cloudflared"
  exit 1
fi

if ! curl -sf -o /dev/null "http://localhost:$PORT/"; then
  echo "Nothing is answering on localhost:$PORT — start ./serve.sh first."
  exit 1
fi

echo "Opening tunnel to localhost:$PORT..."
cloudflared tunnel --url "http://localhost:$PORT" > "$LOG" 2>&1 &
TUNNEL_PID=$!
# Kill the tunnel when this script stops, so it can't linger unnoticed.
trap 'kill $TUNNEL_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
  [ -n "${URL:-}" ] && break
  sleep 0.5
done

if [ -z "${URL:-}" ]; then
  echo "Couldn't get a URL. Tunnel log:"
  tail -20 "$LOG"
  exit 1
fi

cat <<BANNER

  Public URL   $URL

  Open that on her phone -- it works on cellular, no wifi needed and
  nothing to install. This URL dies when you stop this script.

  Ctrl-C to close the tunnel.

BANNER

wait $TUNNEL_PID
