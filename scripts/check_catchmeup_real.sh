#!/usr/bin/env bash
# CREW-7.3 end-to-end check: run the real api (rules mode, in-memory, no Azure or Foundry call) and drive the unified app's Catch me up block against it.
# Needs the route (PR #413 / the checkout that has GET /v1/matches/{id}/catch-me-up). Usage: API_REPO=/path/to/checkout-with-the-route scripts/check_catchmeup_real.sh
# API_REPO defaults to this checkout. The api runs on 127.0.0.1:$API_PORT (default 8765) and the app on :4173 (playwright starts it).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
repo=${API_REPO:-$here}
port=${API_PORT:-8765}
grep -q "catch-me-up" "$repo/services/api/app/matches.py" || { echo "no catch-me-up route in $repo/services/api/app/matches.py"; exit 2; }
log=$(mktemp)
(cd "$repo" && env -u TRANSLATOR_ENDPOINT CORS_ORIGINS="http://localhost:4173" MATCHCAST_AGENT_MODE=rules uv run --locked --all-packages uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port "$port" >"$log" 2>&1) &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -f "$log"' EXIT
for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://127.0.0.1:$port/health" >/dev/null || { echo "api did not start"; cat "$log"; exit 1; }
cd "$here"
CATCHUP_API="http://127.0.0.1:$port" E2E_ARGS="tests/e2e/crew-catchmeup-real.spec.ts" scripts/local_ci.sh e2e
