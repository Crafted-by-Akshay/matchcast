#!/usr/bin/env bash
# Month-to-date Azure spend per service next to the plan targets (PLT-10).
# Uses only the signed-in az session; no keys. Needs: az login, jq.
# Usage: scripts/cost_today.sh [subscription-id]
set -euo pipefail

SUB="${1:-${AZURE_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}}"
START="$(date -u +%Y-%m-01)"
END="$(date -u +%Y-%m-%d)"

# Plan targets in USD (docs/architecture/13, PLT-10). Keyed by the Cost Management ServiceName.
TARGETS='{
  "Foundry Models": 15,
  "Azure AI Services": 15,
  "Foundry Tools": 10,
  "Cognitive Services": 10,
  "Azure Databricks": 10,
  "Microsoft Fabric": 5,
  "Event Hubs": 3,
  "Azure Container Apps": 3,
  "Storage": 3,
  "Key Vault": 3,
  "Azure Monitor": 3,
  "Application Insights": 3,
  "Log Analytics": 3
}'

BODY=$(jq -n --arg s "${START}T00:00:00Z" --arg e "${END}T23:59:59Z" '{
  type: "ActualCost", timeframe: "Custom",
  timePeriod: {from: $s, to: $e},
  dataset: {granularity: "None",
    aggregation: {totalCost: {name: "Cost", function: "Sum"}},
    grouping: [{type: "Dimension", name: "ServiceName"}]}}')

RESULT=$(az rest --method post \
  --url "https://management.azure.com/subscriptions/${SUB}/providers/Microsoft.CostManagement/query?api-version=2023-11-01" \
  --body "$BODY")

echo "Month to date ${START} .. ${END}, subscription ${SUB}"
echo "$RESULT" | jq -r --argjson t "$TARGETS" '
  def row: {service: .[1], cost: .[0]};
  [.properties.rows[] | row] | sort_by(-.cost) as $rows
  | ($rows | map(.cost) | add // 0) as $total
  | ["SERVICE", "SPEND_USD", "TARGET_USD", "FLAG"],
    ($rows[] | . as $r | ($t[$r.service] // null) as $tg
      | [$r.service, ($r.cost * 100 | round / 100 | tostring),
         ($tg // "-" | tostring),
         (if $tg != null and $r.cost > 0.8 * $tg then "OVER 80%" else "" end)]),
    ["TOTAL", ($total * 100 | round / 100 | tostring), "100 cap", (if $total > 40 then "OVER $40 ALERT" else "" end)]
  | @tsv' | (command -v column >/dev/null && column -t -s $'\t' || cat)
