#!/usr/bin/env bash
# SUB-5: the steps of docs/runbook-shutdown.md as one script. DRY RUN BY DEFAULT: it only prints.
# Usage: scripts/shutdown.sh <step> [--execute]
#   steps: scale-down | pause-fabric | cost-final | stop-eventhubs | teardown
# Reversible steps (scale-down, pause-fabric, cost-final) run with --execute.
# Destructive steps (stop-eventhubs, teardown) also need CONFIRM_DESTROY=<resource group> in the environment;
# the runbook says Akshay decides when. Run on the Mac mini after `az login`. Never prints keys.
set -euo pipefail

STEP="${1:-}"
EXECUTE=""
[ "${2:-}" = "--execute" ] && EXECUTE=1
RG="${AZURE_RESOURCE_GROUP:-rg-matchcast}"
ENV_NAME="${AZURE_ENV_NAME:-dev}"
API_APP="ca-api-matchcast-${ENV_NAME}"
FABRIC_CAPACITY="${FABRIC_CAPACITY:-}"
EVENTHUBS_NS="${EVENTHUBS_NAMESPACE:-evhns-matchcast-${ENV_NAME}}"

run() {
  if [ -n "$EXECUTE" ]; then echo "+ $*"; "$@"; else echo "[dry run] $*"; fi
}

need_confirm() {
  if [ -n "$EXECUTE" ] && [ "${CONFIRM_DESTROY:-}" != "$RG" ]; then
    echo "refusing: $1 is destructive. Re-run with CONFIRM_DESTROY=$RG once Akshay has said to." >&2
    exit 2
  fi
}

case "$STEP" in
  scale-down)
    for app in "$API_APP" "${API_APP/ca-api-/ca-web-}" "${API_APP/ca-api-/ca-mcp-}"; do
      run az containerapp update --resource-group "$RG" --name "$app" --min-replicas 0
    done
    ;;
  pause-fabric)
    [ -n "$FABRIC_CAPACITY" ] || { echo "set FABRIC_CAPACITY to the capacity name, or to none if the trial is used" >&2; exit 2; }
    if [ "$FABRIC_CAPACITY" = none ]; then echo "no paid capacity to pause"; exit 0; fi
    run az fabric capacity suspend --resource-group "$RG" --capacity-name "$FABRIC_CAPACITY"
    ;;
  cost-final)
    ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    if [ -n "$EXECUTE" ]; then
      mkdir -p "$ROOT/docs/evidence"
      "$ROOT/scripts/cost_today.sh" | tee "$ROOT/docs/evidence/cost-final.txt"
    else
      echo "[dry run] scripts/cost_today.sh | tee docs/evidence/cost-final.txt"
    fi
    ;;
  stop-eventhubs)
    need_confirm stop-eventhubs
    run az eventhubs namespace delete --resource-group "$RG" --name "$EVENTHUBS_NS"
    ;;
  teardown)
    need_confirm teardown
    echo "azd down removes what the template created and purges soft-deleted AI resources."
    echo "Never remove matchcast-foundry (hand-made) without Akshay's say-so; check the azd preview first."
    run azd down -e "$ENV_NAME" --purge --force
    echo "then verify: az resource list --resource-group $RG -o table (only matchcast-foundry should remain)"
    ;;
  *)
    echo "usage: shutdown.sh scale-down|pause-fabric|cost-final|stop-eventhubs|teardown [--execute]" >&2
    exit 2
    ;;
esac
