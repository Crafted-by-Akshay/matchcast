#!/usr/bin/env bash
# Exports the seven architecture diagrams (SUB-6) from their Mermaid sources to docs/architecture/img/*.png at 1600 px wide.
# Usage: scripts/export_diagrams.sh   (needs node; uses npx @mermaid-js/mermaid-cli and a local Chromium)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
A=docs/architecture
OUT=$A/img
TMP=$(mktemp -d)
mkdir -p "$OUT"

# name | file | heading that precedes the mermaid block (first block after it is used)
DIAGRAMS=(
  "1-system-context|02-context-and-containers.md|## 1. System context"
  "2-agent-workflow|04-agents.md|## 3. Workflow graph"
  "3-life-of-one-claim|03-runtime-flows.md|## F1 Live match loop"
  "4-azure-deployment|13-deployment-and-operations.md|## 1. Azure topology"
  "5-data-flow|02-context-and-containers.md|## 2. Containers"
  "6-identity-and-security|14-security-and-responsible-ai.md|## 2. Trust boundaries"
  "7-ci-cd|13-deployment-and-operations.md|## 5. CI/CD"
)

CHROMIUM=${CHROMIUM_PATH:-}
if [ -z "$CHROMIUM" ] && [ -d "${PLAYWRIGHT_BROWSERS_PATH:-/nonexistent}" ]; then
  CHROMIUM=$(find "$PLAYWRIGHT_BROWSERS_PATH" -type f -name chrome -path '*chromium-*' | head -1)
fi
EXEC=""
[ -n "$CHROMIUM" ] && EXEC=",\"executablePath\":\"$CHROMIUM\""
printf '{"args":["--no-sandbox"]%s}\n' "$EXEC" > "$TMP/puppeteer.json"

for d in "${DIAGRAMS[@]}"; do
  IFS='|' read -r name file heading <<<"$d"
  python3 - "$A/$file" "$heading" "$TMP/$name.mmd" <<'P'
import sys
path, heading, out = sys.argv[1:]
lines = open(path, encoding="utf-8").read().splitlines()
start = next(i for i, l in enumerate(lines) if l.startswith(heading))
i = next(i for i in range(start, len(lines)) if lines[i].strip() == "```mermaid")
j = next(j for j in range(i + 1, len(lines)) if lines[j].strip() == "```")
open(out, "w", encoding="utf-8").write("\n".join(lines[i + 1:j]) + "\n")
P
  PUPPETEER_SKIP_DOWNLOAD=1 npx --yes @mermaid-js/mermaid-cli@11.4.2 -i "$TMP/$name.mmd" -o "$OUT/$name.png" -w 1600 -b white -p "$TMP/puppeteer.json" -q
  echo "exported $OUT/$name.png"
done
