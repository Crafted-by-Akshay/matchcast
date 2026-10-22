#!/usr/bin/env bash
# Stop: if Python or contract files changed, run the matching tests once. Failing tests keep the session going.
in=$(cat)
active=$(printf '%s' "$in" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("stop_hook_active",False))' 2>/dev/null)
[ "$active" = "True" ] && exit 0   # already retried once; do not loop
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
changed=$(git status --porcelain 2>/dev/null | awk '{print $NF}')
[ -n "$changed" ] || exit 0
targets=()
echo "$changed" | grep -q '^packages/agents/' && targets+=(packages/agents/tests)
echo "$changed" | grep -q '^packages/metrics/' && targets+=(packages/metrics/tests)
echo "$changed" | grep -q '^packages/shared/' && targets+=(packages/shared/tests)
echo "$changed" | grep -q -E '^(services/|packages/contracts/|tests/)' && targets+=(tests)
[ ${#targets[@]} -gt 0 ] || exit 0
out=$(MATCHCAST_MODE=local MATCHCAST_AGENT_MODE=rules MATCHCAST_STORE=memory \
  timeout 200 uv run --locked --all-packages pytest -x -q "${targets[@]}" 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  echo "Tests failed for the files you changed (${targets[*]}). Fix them before stopping:" >&2
  echo "$out" | tail -30 >&2
  exit 2
fi
exit 0
