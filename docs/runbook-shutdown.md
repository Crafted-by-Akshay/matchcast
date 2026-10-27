# Shutdown runbook (PLT-10)

Keeps total spend near the plan (about $49, about $60 with the Translator, Vision and Content Safety caps) and under the $100 cap. Run every command on the Mac mini with `az login` done. Subscription `538de541-d855-4dcc-8644-8c1ce1da7486`, resource group `rg-matchcast`.

## Daily check (every build day, and each judging day)
```
scripts/cost_today.sh
```
Prints month-to-date spend per service beside its target and flags anything above 80% of target. This subscription is billed in Indian rupees (INR), so the script shows the billed INR and Azure's own USD figure (`CostUSD`, about 96 INR per USD on 24 Oct 2026). The plan targets and caps in this runbook are USD. Alerts exist at $40 and $50 on budget `matchcast-budget` (see "Budget alerts").

## Schedule

| When | Step | Command or portal path |
| --- | --- | --- |
| After filming the demo video (target 26 Oct) | Pause the Fabric capacity (DAT-8) | `az fabric capacity suspend --resource-group rg-matchcast --capacity-name <capacity>`; if the 60-day trial is used, nothing to pause, note it here |
| After the `train-danger` and `fit-xg` jobs finish (DAT-6, target 24 Oct) | Stop Databricks compute | Portal: Databricks workspace > Compute > terminate every cluster; confirm no running job in Workflows. The workspace itself costs nothing while idle |
| 27 Oct (after the submission closes 23:59 PT) if the demo replays from Blob | Delete the Event Hubs namespace | `az eventhubs namespace delete --resource-group rg-matchcast --name evhns-matchcast-dev`. Skip if live ingestion is part of the judged demo |
| 10 Nov (judging ends) | Final cost check | `scripts/cost_today.sh` and save the output in `docs/evidence/cost-final.txt` |
| 11 Nov | Remove everything | `azd down --purge --force` from the repo root with the `dev` environment selected |
| 11 Nov | Verify empty | `az resource list --resource-group rg-matchcast -o table` shows only `matchcast-foundry` (hand-made) unless it is also removed |

Do not delete `matchcast-foundry` or `rg-matchcast` without Akshay's say-so; `azd down` only removes what the template created.

## Scripts (dry run by default)
`scripts/shutdown.sh <scale-down|pause-fabric|cost-final|stop-eventhubs|teardown>` prints the command for that step; add `--execute` to run it. `stop-eventhubs` and `teardown` also refuse to run without `CONFIRM_DESTROY=rg-matchcast` in the environment, which is Akshay's call. `pause-fabric` needs `FABRIC_CAPACITY`. After any step, or at any time, `scripts/health_check.sh <api-url> [web-url]` checks `/health`, `/ready`, that `/v1/status` lists no unavailable dependency, and the web page (`DRY_RUN=1` prints the requests only). The destructive steps have not been run.

## Budget alerts
The budget amount is in the billing currency, INR here. At about 96 INR per USD (the rate Azure used on 24 Oct 2026), $50 is about 4,800 INR and $40 about 3,840 INR (80% of 4,800). A budget of `50` means 50 rupees, about $0.50. To set it from the CLI (keeps the existing contact emails; changes only the amount and the two thresholds):
```
SUB=538de541-d855-4dcc-8644-8c1ce1da7486
URL="https://management.azure.com/subscriptions/$SUB/providers/Microsoft.Consumption/budgets/matchcast-budget?api-version=2023-05-01"
az rest --method get --url "$URL" | python3 -c "
import sys,json
d=json.load(sys.stdin); p=d['properties']; p['amount']=4800
n=next(iter(p['notifications'].values()))
p['notifications']={'actual_GreaterThan_80_Percent':dict(n,threshold=80.0),'actual_GreaterThan_100_Percent':dict(n,threshold=100.0)}
json.dump({'properties':p},open('/tmp/budget.json','w'))"
az rest --method put --url "$URL" --body @/tmp/budget.json --query "properties.amount"
```
Budget `matchcast-budget` should have alerts at $40 and $50 (acceptance criterion of PLT-10).

Check: `az consumption budget list --query "[?name=='matchcast-budget'].notifications" -o json`

Add or update the $40 alert (Owner: Akshay, portal path Cost Management > Budgets > matchcast-budget > Edit > Alert conditions > add 40 USD actual, with Akshay's email). If the CLI is preferred, `az consumption budget` cannot edit single notifications; use the portal.

## Foundry and Speech
Both bill by use, so they stop costing money when nothing calls them. During judging the `api` replica count stays at 0 until a visitor arrives, and `docs/runbook-demo.md` sets `min replicas = 1` only for recording and live judging windows. Set it back to 0 afterwards:
```
az containerapp update --resource-group rg-matchcast --name ca-api-matchcast-dev --min-replicas 0
az containerapp update --resource-group rg-matchcast --name ca-web-matchcast-dev --min-replicas 0
az containerapp update --resource-group rg-matchcast --name ca-mcp-matchcast-dev --min-replicas 0
```
`scripts/shutdown.sh scale-down` runs all three, and `azd env set KEEP_WARM false` then `azd provision` does the same through Bicep (`keepWarm` gates the api, web and mcp minimums).

## Rollback of a bad deploy
`az containerapp revision list --resource-group rg-matchcast --name ca-api-matchcast-dev -o table`, then `az containerapp revision activate` on the previous revision.
