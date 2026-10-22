#!/usr/bin/env bash
# SUB-5: one-shot health check of a deployed MatchCast (api, status document, web). No keys, no Azure login.
# Usage: scripts/health_check.sh <api-base-url> [web-base-url]
# Exit 0 when /health and /ready answer 200, /v1/status has no "unavailable" dependency, and the web returns 200.
# Set DRY_RUN=1 to print the requests without sending them.
set -uo pipefail

API="${1:?usage: health_check.sh <api-base-url> [web-base-url]}"
API="${API%/}"
WEB="${2:-}"
WEB="${WEB%/}"
fail=0

get() { # url -> prints "<code> <body-file>"
  if [ -n "${DRY_RUN:-}" ]; then echo "would GET $1" >&2; echo "200 /dev/null"; return; fi
  local out; out="$(mktemp)"
  local code; code="$(curl -sS -o "$out" -w '%{http_code}' --max-time 20 --retry 3 --retry-delay 5 --retry-all-errors "$1" 2>/dev/null || echo 000)"
  echo "$code $out"
}

check() { # label url
  read -r code body < <(get "$2")
  if [ "$code" = 200 ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1 ($2) -> $code"; fail=1; fi
  echo "$body"
}

check "api live" "$API/health" >/dev/null
check "api ready" "$API/ready" >/dev/null

body="$(check "status document" "$API/v1/status" | tail -1)"
if [ -z "${DRY_RUN:-}" ] && [ -s "$body" ]; then
  bad="$(python3 - "$body" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
print(",".join(d["key"] for d in doc["dependencies"] if d["status"] == "unavailable"))
PY
)"
  if [ -n "$bad" ]; then echo "FAIL  unavailable dependencies: $bad"; fail=1; else echo "PASS  no unavailable dependency"; fi
fi

if [ -n "$WEB" ]; then check "web" "$WEB/" >/dev/null; fi

[ "$fail" = 0 ] && echo "HEALTHY" || echo "UNHEALTHY"
exit "$fail"
