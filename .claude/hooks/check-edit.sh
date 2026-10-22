#!/usr/bin/env bash
# PostToolUse(Edit|Write): fast check of the one file just edited. Exit 2 feeds the problem back.
in=$(cat)
f=$(printf '%s' "$in" | python3 -c 'import sys,json; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path",""))' 2>/dev/null)
[ -n "$f" ] && [ -f "$f" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
command -v uv >/dev/null || [ "${f##*.}" != py ] || exit 0
case $f in
  *.py)
    out=$(uv run --locked --all-packages ruff check "$f" 2>&1) || { echo "ruff failed on $f:" >&2; echo "$out" | tail -25 >&2; exit 2; } ;;
  *.json)
    python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$f" 2>/dev/null || { echo "$f is not valid JSON" >&2; exit 2; } ;;
  *.sh)
    bash -n "$f" 2>&1 || { echo "shell syntax error in $f" >&2; exit 2; } ;;
  packages/contracts/src/generated.ts|*/packages/contracts/src/generated.ts)
    echo "generated.ts is generated; edit the JSON Schema and run make contracts-generate" >&2; exit 2 ;;
esac
exit 0
