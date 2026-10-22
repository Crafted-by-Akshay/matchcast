# Infrastructure (PLT-3)

Bicep under `infra/`, driven by `azd` (`azure.yaml`). Design: `docs/architecture/13-deployment-and-operations.md`.

## What the template creates
Log Analytics + Application Insights, `id-matchcast`, Key Vault (RBAC), Storage (9 tables, 10 containers, lifecycle rules), Event Hubs Basic with hub `match-events`, Container Apps environment with `web`, `api`, `mcp`, and the role assignments for `id-matchcast`. Foundry is hand-made and passed in by parameter.

## Run it (Mac mini, `az login` done)
```
azd env new dev
azd env set FOUNDRY_PROJECT_ENDPOINT <project endpoint from the Foundry portal>
azd provision        # azd up once the Dockerfiles exist
```
Until each service has a Dockerfile, apps start from a public placeholder image (`webImage`, `apiImage`, `mcpImage` parameters); PLT-7 deploys the GHCR images.

## Decisions and notes
- Storage container `kb` from doc 07 is named `kb-chunks` because container names need at least 3 characters.
- No app setting holds a key or connection string in plain text. The App Insights connection string (not a credential) is stored as the Container Apps secret `appinsights-connection` and referenced by `APPLICATIONINSIGHTS_CONNECTION_STRING` with `secretRef`.
- The api scales on the Event Hubs backlog (KEDA `azure-eventhub`, threshold 50, `$Default`, identity-based, checkpoints in `eh-checkpoints`) and on HTTP, between 0 and 1 replicas (PLT-9).
- Alert rules (errors, agent latency, fallback spike) deploy only when `ALERT_EMAIL` is set: `azd env set ALERT_EMAIL <address>`. The workbook `MatchCast agents` deploys always (PLT-8). Its queries use the span names from doc 15 and show data once the services emit them.
- Cognitive Services User roles for Content Safety, Speech, Translator and Vision are added by the stories that create those resources.
- Run time and resource list from the first `azd up`: to be recorded after the Mac mini run.
