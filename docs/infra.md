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

## Deploy on merge (PLT-7)
`.github/workflows/deploy.yml` runs after `ci` succeeds on main (and on manual dispatch). It signs in to Azure with OIDC, builds the `api` and `web` images (and `mcp` once `services/mcp/Dockerfile` exists), pushes them to `ghcr.io/crafted-by-akshay/matchcast-*` tagged `sha-<short sha>` and `latest`, then runs `azd provision` with `API_IMAGE`, `WEB_IMAGE`, `MCP_IMAGE` set, so the Bicep points each Container App at the new tag. Container Apps run in single revision mode and only switch traffic after the new revision is healthy, so a failed deploy leaves the previous revision serving. The last step calls `GET /ready` on the api.

The web image is built with the api URL baked in (`API_URL` build argument, read from the running api's FQDN).

### One-time setup (Mac mini, `az login` and `gh auth login` done)
```
SUB=538de541-d855-4dcc-8644-8c1ce1da7486
APP=$(az ad app create --display-name matchcast-github --query appId -o tsv)
az ad sp create --id "$APP"
SPID=$(az ad sp show --id "$APP" --query id -o tsv)
az ad app federated-credential create --id "$APP" --parameters '{"name":"matchcast-main","issuer":"https://token.actions.githubusercontent.com","subject":"repo:Crafted-by-Akshay/matchcast:ref:refs/heads/main","audiences":["api://AzureADTokenExchange"]}'
az role assignment create --assignee-object-id "$SPID" --assignee-principal-type ServicePrincipal --role Contributor --scope /subscriptions/$SUB/resourceGroups/rg-matchcast
# Role Based Access Control Administrator, limited to the roles in infra/modules/roles.bicep
ROLES="53ca6127-db72-4b80-b1b0-d745d6d5456d,0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3,ba92f5b4-2d11-453d-a403-e96b0029c9fe,2b629674-e913-4c01-ae53-ef4638d8f975,a638d3c7-ab3a-418d-83e6-5f17a39d4fde,4633458b-17de-406a-b5cd-9c4a5b5cd8ee"
az role assignment create --assignee-object-id "$SPID" --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope /subscriptions/$SUB/resourceGroups/rg-matchcast \
  --condition-version 2.0 --condition "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES}))"
gh variable set AZURE_CLIENT_ID --body "$APP" -R Crafted-by-Akshay/matchcast
gh variable set AZURE_TENANT_ID --body "$(az account show --query tenantId -o tsv)" -R Crafted-by-Akshay/matchcast
gh variable set AZURE_SUBSCRIPTION_ID --body "$SUB" -R Crafted-by-Akshay/matchcast
gh variable set AZURE_ENV_NAME --body dev -R Crafted-by-Akshay/matchcast
gh variable set AZURE_LOCATION --body eastus2 -R Crafted-by-Akshay/matchcast
gh variable set FOUNDRY_PROJECT_ENDPOINT --body "<project endpoint>" -R Crafted-by-Akshay/matchcast
```
These are variables, not secrets (client, tenant and subscription IDs are not credentials). After the first workflow run pushes the images, make each GHCR package public (GitHub > Packages > matchcast-api, -web > Package settings > Change visibility) so Container Apps can pull without a registry secret.

Not verified yet: the workflow has not run, the Dockerfiles were checked by running their steps by hand (no Docker daemon in the build session), and the `mcp` image waits for `services/mcp`.
