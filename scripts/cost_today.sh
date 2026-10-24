#!/usr/bin/env bash
# Month-to-date Azure spend per service next to the plan targets (PLT-10).
# Uses only the signed-in az session; no keys. Needs: az login, jq.
# Usage: [INR_PER_USD=88] scripts/cost_today.sh [subscription-id]
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

# Cost Management reports in the billing currency (INR on this subscription), so convert to USD before
# comparing with the USD targets. The rate is an estimate: override it with INR_PER_USD=<rate>.
INR_PER_USD="${INR_PER_USD:-88}"
CUR="$(echo "$RESULT" | jq -r '.properties.rows[0][-1] // "USD"')"

echo "Month to date ${START} .. ${END}, subscription ${SUB}, billing currency ${CUR}"
[ "$CUR" = "USD" ] || echo "USD values are estimates at ${INR_PER_USD} ${CUR} per USD (set INR_PER_USD to change)"
echo "$RESULT" | jq -r --argjson t "$TARGETS" --arg cur "$CUR" --argjson rate "$INR_PER_USD" '
  (if $cur == "USD" then 1 else $rate end) as $div
  | def row: {service: .[1], billed: .[0], cost: (.[0] / $div)};
  def r2: (. * 100 | round / 100 | tostring);
  [.properties.rows[] | row] | sort_by(-.cost) as $rows
  | ($rows | map(.cost) | add // 0) as $total
  | ($rows | map(.billed) | add // 0) as $billed
  | ["SERVICE", "SPEND_" + $cur, "SPEND_USD", "TARGET_USD", "FLAG"],
    ($rows[] | . as $r | ($t[$r.service] // null) as $tg
      | [$r.service, ($r.billed | r2), ($r.cost | r2),
         ($tg // "-" | tostring),
         (if $tg != null and $r.cost > 0.8 * $tg then "OVER 80%" else "" end)]),
    ["TOTAL", ($billed | r2), ($total | r2), "100 cap", (if $total > 40 then "OVER $40 ALERT" else "" end)]
  | @tsv' | (command -v column >/dev/null && column -t -s $'\t' || cat)
