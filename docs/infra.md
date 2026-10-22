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
az ad app federated-credential create --id "$APP" --parameters '{"name":"matchcast-production","issuer":"https://token.actions.githubusercontent.com","subject":"repo:Crafted-by-Akshay/matchcast:environment:production","audiences":["api://AzureADTokenExchange"]}'
az role assignment create --assignee-object-id "$SPID" --assignee-principal-type ServicePrincipal --role Contributor --scope /subscriptions/$SUB/resourceGroups/rg-matchcast
# Role Based Access Control Administrator, limited to the roles in infra/modules/roles.bicep
ROLES="53ca6127-db72-4b80-b1b0-d745d6d5456d,0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3,ba92f5b4-2d11-453d-a403-e96b0029c9fe,2b629674-e913-4c01-ae53-ef4638d8f975,a638d3c7-ab3a-418d-83e6-5f17a39d4fde,4633458b-17de-406a-b5cd-9c4a5b5cd8ee"
COND=$(cat <<EOF
((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLES}))
EOF
)
az role assignment create --assignee-object-id "$SPID" --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope /subscriptions/$SUB/resourceGroups/rg-matchcast \
  --condition-version 2.0 --condition "$COND"
gh variable set AZURE_CLIENT_ID --body "$APP" -R Crafted-by-Akshay/matchcast
gh variable set AZURE_TENANT_ID --body "$(az account show --query tenantId -o tsv)" -R Crafted-by-Akshay/matchcast
gh variable set AZURE_SUBSCRIPTION_ID --body "$SUB" -R Crafted-by-Akshay/matchcast
gh variable set AZURE_ENV_NAME --body dev -R Crafted-by-Akshay/matchcast
gh variable set AZURE_LOCATION --body eastus2 -R Crafted-by-Akshay/matchcast
gh variable set FOUNDRY_PROJECT_ENDPOINT --body "<project endpoint>" -R Crafted-by-Akshay/matchcast
```
The deploy job runs in the GitHub environment `production` (create it under Settings > Environments; add required reviewers if you want a manual gate), and the federated credential is bound to that environment. Deploy runs only for pushes to this repo's main, never for fork PRs.

These are variables, not secrets (client, tenant and subscription IDs are not credentials). After the first workflow run pushes the images, make each GHCR package public (GitHub > Packages > matchcast-api, -web > Package settings > Change visibility) so Container Apps can pull without a registry secret. Until they are public, the deploy job warns and provisions with the placeholder image, so the first run is safe; re-run it after the switch.

Not verified yet: the workflow has not run, the Dockerfiles were checked by running their steps by hand (no Docker daemon in the build session), and the `mcp` image waits for `services/mcp`.
## Entra sign-in (PLT-5)
Viewing stays open to everyone (Easy Auth is configured to allow anonymous requests). Producer routes need an Entra account with the `Producer` or `Admin` app role. Bicep adds Easy Auth to `web` and `api` and sets `MATCHCAST_EASY_AUTH=1` and `MATCHCAST_REQUIRE_ROLE=1` only when `ENTRA_CLIENT_ID` is set in the azd environment.

One-time setup (Mac mini or portal; needs a tenant that allows app registrations, otherwise use the fallback below):
```
az ad app create --display-name matchcast-web --sign-in-audience AzureADMyOrg \
  --app-roles '[{"allowedMemberTypes":["User"],"description":"Watch","displayName":"Viewer","id":"11111111-1111-4111-8111-111111111111","isEnabled":true,"value":"Viewer"},{"allowedMemberTypes":["User"],"description":"Approve, edit and kill lines","displayName":"Producer","id":"22222222-2222-4222-8222-222222222222","isEnabled":true,"value":"Producer"},{"allowedMemberTypes":["User"],"description":"Everything","displayName":"Admin","id":"33333333-3333-4333-8333-333333333333","isEnabled":true,"value":"Admin"}]' \
  --web-redirect-uris "https://<web-fqdn>/.auth/login/aad/callback" "https://<api-fqdn>/.auth/login/aad/callback" \
  --enable-id-token-issuance true
az ad sp create --id <appId>
# client secret into Key Vault (the one secret Easy Auth needs; Entra sign-in has no keyless option here)
az role assignment create --assignee <your user> --role "Key Vault Secrets Officer" --scope <key vault id>
az keyvault secret set --vault-name kv-matchcast-dev --name entra-client-secret --value "$(az ad app credential reset --id <appId> --query password -o tsv)"
azd env set ENTRA_CLIENT_ID <appId> && azd provision
```
Then assign the judge account the `Producer` role in Entra admin centre > Enterprise applications > matchcast-web > Users and groups. Its password goes only into the private notes field of the submission form.

Fallback if the tenant blocks app registrations: leave `ENTRA_CLIENT_ID` empty and use the signed demo code in the UI, labelled "Simulated sign-in", and record the reason here.

Known exception to "no secret": `entra-client-secret` (Key Vault reference on the apps). Not yet run: the registration, the Easy Auth deployment and the sign-in flow need the Mac mini or portal.

## Scaling proof (PLT-9)
KEDA rule `match-events-backlog` (threshold 50 unprocessed events) wakes the api from 0. To record the graph: in one shell run `scripts/watch_replicas.sh replicas.csv 1200 5`, in another publish 500 events in 10 s with the replay publisher (DAT-1, 4x mode), then plot `replicas.csv` and commit the image under `docs/evidence/`. Expected: 0 to 1 within 60 s, back to 0 within 10 minutes of the last event. Waiting on DAT-1's replay publisher and the first deployed api image.

## Secret scan proof (PLT-4)
CI job `secrets` runs gitleaks on the history, then `scripts/gitleaks_proof.sh`, which builds a throwaway repo, checks a clean commit passes, then commits a fake AWS key (assembled at run time, never stored in the repo) and requires the scan to fail. Run it locally with `scripts/gitleaks_proof.sh path/to/gitleaks`.
