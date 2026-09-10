#!/usr/bin/env bash
# Start the backend and the Vite dev server together. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

[ -d backend/.venv ] || python3 -m venv backend/.venv
./backend/.venv/bin/pip install -q -r backend/requirements.txt
[ -d frontend/node_modules ] || (cd frontend && npm install)

trap 'kill 0' EXIT
(cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000) &
(cd frontend && npm run dev) &
wait
