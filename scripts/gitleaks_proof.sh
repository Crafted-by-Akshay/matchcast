#!/usr/bin/env bash
# PLT-4 proof: the secret scan really fails on a leaked key and passes on a clean repo.
# Usage: scripts/gitleaks_proof.sh [path/to/gitleaks]
set -euo pipefail
GL=$(realpath "${1:-./gitleaks}")
CFG=$(realpath "$(dirname "$0")/../.gitleaks.toml")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q
git config user.email proof@example.invalid
git config user.name proof
echo "hello" > README.md
git add . && git commit -qm clean
"$GL" detect --source . --config "$CFG" --no-banner >/dev/null
echo "clean repo: scan passes"
# The fake key is assembled at run time so this file never contains a literal key.
printf 'AWS_SECRET=%s\n' "AKIA$(printf 'IOSFODNN7EXAMPLQ')" > leak.env
printf 'aws_access_key_id = %s\n' "AKIA$(printf 'QYLPMN5HHHFPZAM2')" >> leak.env
git add . && git commit -qm leak
if "$GL" detect --source . --config "$CFG" --no-banner --redact >/dev/null 2>&1; then
  echo "FAIL: gitleaks did not flag the fake key" >&2
  exit 1
fi
echo "fake key: scan fails as expected"
