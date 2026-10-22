#!/usr/bin/env bash
# Runs the jobs from .github/workflows/ci.yml on this machine, for use while Actions is unavailable.
# Usage: scripts/local_ci.sh [job ...]   jobs: checks e2e bicep secrets openapi (default: all)
# E2E_ARGS narrows Playwright, e.g. E2E_ARGS="tests/e2e/approval.spec.ts" scripts/local_ci.sh e2e
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

export MATCHCAST_MODE=local MATCHCAST_AGENT_MODE=rules MATCHCAST_STORE=memory
jobs=("$@"); [ ${#jobs[@]} -eq 0 ] && jobs=(checks e2e bicep secrets openapi)
declare -a results

run() { # run <job> <command...>
  local name=$1; shift
  echo "=== $name ==="
  if "$@"; then results+=("PASS    $name"); else results+=("FAIL    $name"); fi
}
skip() { echo "=== $1: SKIPPED ($2) ==="; results+=("SKIPPED $1 ($2)"); }

job_checks() {
  make install && make lint && make typecheck && make test && make build
}
job_e2e() {
  make -n e2e >/dev/null 2>&1 || { echo "make e2e not defined"; return 0; }
  npx playwright --version >/dev/null 2>&1 || return 1
  local chromium
  chromium=${CHROMIUM_PATH:-$(node -e "console.log(require('@playwright/test').chromium.executablePath())")}
  [ -e "$chromium" ] || chromium=""
  CHROMIUM_PATH=$chromium make e2e E2E_ARGS="${E2E_ARGS:-}"
}
job_bicep() {
  [ -f infra/main.bicep ] || { echo "no infra/main.bicep"; return 0; }
  local out
  out=$(az bicep build --file infra/main.bicep --stdout 2>&1 >/dev/null) || { echo "$out"; return 1; }
  echo "$out"
  if echo "$out" | grep -qi "warning"; then echo "Bicep produced warnings"; return 1; fi
}
job_secrets() {
  local g=${GITLEAKS:-$(command -v gitleaks || true)}
  [ -n "$g" ] || [ ! -x ./gitleaks ] || g=./gitleaks
  [ -n "$g" ] || { echo "gitleaks not found"; return 1; }
  "$g" detect --source . --log-opts="HEAD" --redact --no-banner --verbose && scripts/gitleaks_proof.sh "$g"
}
job_openapi() {
  [ -f docs/api/openapi.json ] || { echo "no docs/api/openapi.json"; return 0; }
  local tmp; tmp=$(mktemp -d)
  uv sync --locked --all-packages &&
  PYTHONPATH=services/api uv run --locked --all-packages python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2, sort_keys=True))" > "$tmp/served.json" &&
  python3 -c "import json; print(json.dumps(json.load(open('docs/api/openapi.json')), indent=2, sort_keys=True))" > "$tmp/committed.json" &&
  diff -u "$tmp/committed.json" "$tmp/served.json"
}

for j in "${jobs[@]}"; do
  case $j in
    bicep) command -v az >/dev/null || { skip bicep "az not installed"; continue; } ;;
    secrets) command -v gitleaks >/dev/null || [ -n "${GITLEAKS:-}" ] || [ -x ./gitleaks ] || { skip secrets "gitleaks not installed"; continue; } ;;
    checks|e2e|openapi) ;;
    *) echo "unknown job $j"; exit 2 ;;
  esac
  run "$j" "job_$j"
done

echo; echo "=== summary for $(git rev-parse --short HEAD) ==="
printf '%s\n' "${results[@]}"
printf '%s\n' "${results[@]}" | grep -q '^FAIL' && exit 1
exit 0
