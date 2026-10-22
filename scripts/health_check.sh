#!/usr/bin/env bash
# SUB-5: one-shot health check of a deployed MatchCast (api, status document, web). No keys, no Azure login.
# Usage: scripts/health_check.sh <api-base-url> [web-base-url]
# Exit 0 only when /health and /ready answer 200, /v1/status parses and lists no "unavailable" dependency,
# and the web returns 200. Set DRY_RUN=1 to print the requests without sending them.
set -uo pipefail

API="${1:?usage: health_check.sh <api-base-url> [web-base-url]}"
API="${API%/}"
WEB="${2:-}"
WEB="${WEB%/}"
fail=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# fetch <url> <outfile>: sets CODE (000 when unreachable)
fetch() {
  if [ -n "${DRY_RUN:-}" ]; then echo "would GET $1" >&2; CODE=200; : > "$2"; return; fi
  CODE="$(curl -sS -o "$2" -w '%{http_code}' --max-time 20 --retry "${HEALTH_RETRIES:-3}" --retry-delay 5 --retry-all-errors "$1" 2>/dev/null)" || CODE=000
}

check() { # label url outfile
  fetch "$2" "$3"
  if [ "$CODE" = 200 ]; then echo "PASS  $1 ($2)"; else echo "FAIL  $1 ($2) -> $CODE"; fail=1; fi
}

check "api live" "$API/health" "$TMP/health"
check "api ready" "$API/ready" "$TMP/ready"
check "status document" "$API/v1/status" "$TMP/status"

if [ -z "${DRY_RUN:-}" ] && [ "$CODE" = 200 ]; then
  if bad="$(python3 - "$TMP/status" <<'PY'
import json, sys
doc = json.load(open(sys.argv[1]))
print(",".join(d["key"] for d in doc["dependencies"] if d["status"] == "unavailable"))
PY
)"; then
    if [ -n "$bad" ]; then echo "FAIL  unavailable dependencies: $bad"; fail=1; else echo "PASS  no unavailable dependency"; fi
  else
    echo "FAIL  /v1/status is not the expected document"; fail=1
  fi
fi

if [ -n "$WEB" ]; then check "web" "$WEB/" "$TMP/web"; fi

if [ "$fail" = 0 ]; then echo "HEALTHY"; else echo "UNHEALTHY"; fi
exit "$fail"
