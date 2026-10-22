#!/usr/bin/env bash
# PLT-9: sample the api replica count every few seconds into a CSV (timestamp,replicas) for the scaling graph.
# Usage: scripts/watch_replicas.sh [out.csv] [seconds-to-run] [interval]   (needs az login)
set -euo pipefail
OUT=${1:-replicas.csv}
DURATION=${2:-900}
INTERVAL=${3:-5}
ENV_NAME=${AZURE_ENV_NAME:-dev}
RG=${AZURE_RESOURCE_GROUP:-rg-matchcast}
APP="ca-api-matchcast-${ENV_NAME}"
echo "timestamp,replicas" > "$OUT"
end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  n=$(az containerapp replica list -g "$RG" -n "$APP" --query "length(@)" -o tsv 2>/dev/null || echo "")
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),${n:-NA}" | tee -a "$OUT"
  sleep "$INTERVAL"
done
