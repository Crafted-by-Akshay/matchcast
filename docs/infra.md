# Infrastructure (PLT-3)

Bicep under `infra/`, driven by `azd` (`azure.yaml`). Design: `docs/architecture/13-deployment-and-operations.md`.

## What the template creates
Log Analytics + Application Insights, `id-matchcast`, Key Vault (RBAC), Storage (10 tables, 10 containers, lifecycle rules), Event Hubs Basic with hub `match-events`, Container Apps environment with `web`, `api`, `mcp`, Azure AI Content Safety (`cs-matchcast-<env>`, S0, local auth off) and AI Search Free (`srch-matchcast-<env>-<suffix>`) from `modules/ai.bicep`, the recap Function app `fn-matchcast-dev-recap-<suffix>` on Flex Consumption (`modules/function.bicep`), and the role assignments for `id-matchcast` (including Cognitive Services User on Content Safety and Blob Data Owner and Queue Data Contributor on storage for the Functions host). Foundry is hand-made and passed in by parameter.

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
- `modules/ai.bicep` holds the Cognitive Services accounts in one list (`accounts`); Content Safety and Speech are in it (kind `SpeechServices`, S0, same region as the app; the api reads `SPEECH_ENDPOINT` and `SPEECH_REGION` from the Bicep outputs, so no deploy variable is needed, and its Cognitive Services User role lets the api's identity call the account's `issueToken`, which `GET /v1/speech/token` uses), Translator is in it too (kind `TextTranslation`, S1; the api reads `TRANSLATOR_ENDPOINT` and `TRANSLATOR_REGION` from the Bicep outputs), and Vision is added by its own story. Every account gets Cognitive Services User for the api identity from the `cognitiveNames` output, which covers Speech `issueToken` and Translator calls. Custom subdomains and the search name carry a 5-character suffix from `uniqueString(resourceGroup().id)` because those names are global; use the `CONTENT_SAFETY_ENDPOINT`, `SPEECH_ENDPOINT`, `SEARCH_SERVICE` and `SEARCH_ENDPOINT` outputs, not guessed names.
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
ROLES="53ca6127-db72-4b80-b1b0-d745d6d5456d,0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3,ba92f5b4-2d11-453d-a403-e96b0029c9fe,2b629674-e913-4c01-ae53-ef4638d8f975,a638d3c7-ab3a-418d-83e6-5f17a39d4fde,4633458b-17de-408a-b874-0445c86b69e6,a97b65f3-24c7-4388-baec-2e87135dc908,b7e6dc6d-f1e8-4753-8033-0f276bb0955b,974c5e8b-45b9-4653-ba55-5f855dd0fb88"
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
## Event stream (DAT-1, DAT-2)
`MATCHCAST_PIPELINE` (Bicep param `pipelineMode`, azd variable `PIPELINE_MODE`, repo variable `PIPELINE_MODE`, default `direct`) picks how `POST /v1/matches/{id}/events` reaches the workflow. `eventhubs` follows F1 in `03-runtime-flows.md`: the api validates the batch, publishes it to hub `match-events` with the stream key as partition key (`services/worker/matchcast_worker/eventhubs.py`), and answers 202 only after the hub has it (a publish failure is `503 publish_failed` and the browser resends the same batch). A consumer task inside the same api process reads the hub on `$Default` with checkpoints in Blob `eh-checkpoints` (managed identity, so the existing Event Hubs Data Sender/Receiver and Blob roles apply) and runs the workflow; a batch whose handler fails 3 times is logged and skipped so the single partition keeps moving. If the api restarted, the consumer rebuilds the match's workflow from the stored roster (`Registry.flow_for`), which needs `MATCHCAST_STORE=table`. `memory` runs the same code over an in-process queue (local runs, tests).

`MATCHCAST_STATE_WRITER` (`workflow` or `reducer`, set by Bicep from `pipelineMode`: `workflow` in `direct`, `reducer` in `memory` and `eventhubs`) says who writes `matchstate` (ADR-0017). With `reducer`, `Pipeline.handle` runs each batch through the worker reducer first (`process_applied`, `TableStateRepo` when `MATCHCAST_STORE=table`) validates each event first (bad ones are logged and dropped), gives the workflow the applied events plus duplicates, and commits the reducer's writes only after the workflow took them, so a failed ingest leaves held events held; events behind a gap wait. Known limit: the edge validates before publishing, so a dropped event at the consumer is rare, but if one is dropped (or a batch is skipped after its retries) later events wait behind its sequence until 500 are held and the reducer gives the gap up. Untested against Azure.

Tested: transport fakes (`tests/test_eventhubs.py`), the api in `memory` mode against the same fixture as `direct`, a failed publish, and a restart (`tests/test_api_pipeline.py`); `scripts/smoke_pipeline.py --base http://localhost:8000` passes against a local `memory` api. **Not tested against a real hub** (no Azure, no emulator here). To switch the deployed api: `azd env set PIPELINE_MODE eventhubs && azd provision`, run `scripts/smoke_pipeline.py --base https://<api-fqdn>`, and set `PIPELINE_MODE=direct` again if it fails. Set the repo variable `PIPELINE_MODE=eventhubs` too, or the next CI deploy resets it.

## Web image delivery
`apps/unified/Dockerfile` stages exactly the files the shell loads into `/site` (`tests/test_web_image.py` fails if `index.html` loads a script the image lacks; until 22 Oct `trace-panel.js`, `voice.js` and `voices.json` were missing), gzips the large ones once at build time, and `nginx.conf` serves them with `gzip_static` (players.json 5.8 MB goes out as 2.6 MB with no per-request CPU). Files are not content-hashed, so every response is `Cache-Control: no-cache`: the browser revalidates with the ETag and gets a 304. Checked 22 Oct with a local nginx 1.24 against the staged site (gzip, 304, 404, headers); the image itself was not built (no Docker daemon here).

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
KEDA rule `match-events-backlog` (threshold 50 unprocessed events) wakes the api from 0. To record the graph: in one shell run `scripts/watch_replicas.sh replicas.csv 1200 5`, in another publish 500 events in 10 s with the replay publisher (DAT-1, 4x mode), then plot `replicas.csv` and commit the image under `docs/evidence/`. Expected: 0 to 1 within 60 s, back to 0 within 10 minutes of the last event. For a local baseline or a spike without the replay publisher, `scripts/load_test.py --base <api url> --matches 8 --repeat 2` replays the ten-minute fixture into independent matches and prints events a second and p50/p95 latency (local api, rules mode, 8 matches at once: about 230 events/s, p50 1.1 s, p95 2.1 s per request, single process, measured 22 Oct). Waiting on DAT-1's replay publisher and the first deployed api image.

## Secret scan proof (PLT-4)
CI job `secrets` runs gitleaks on the history, then `scripts/gitleaks_proof.sh`, which builds a throwaway repo, checks a clean commit passes, then commits a fake AWS key (assembled at run time, never stored in the repo) and requires the scan to fail. Run it locally with `scripts/gitleaks_proof.sh path/to/gitleaks`.

## AI Search keys (AGT-16)
AI Search Free has no managed identity (ADR-0009), so the two keys are the only stored secrets. They never appear in Bicep, outputs or the repo:
1. `azd provision` creates the service. The `postprovision` hook runs `scripts/set_search_secrets.sh`, which reads the keys with `az` and writes `srch-admin-key` and `srch-query-key` to Key Vault.
   The search service has its own `searchLocation` param (default `eastus`) because `eastus2` returned `InsufficientResourcesAvailable` for the free tier on 22 Oct 2026; the other AI accounts stay in `eastus2`.
2. Writing needs **Key Vault Secrets Officer** on the vault for whoever runs the hook (Akshay on the Mac mini, once: `az role assignment create --assignee <you> --role "Key Vault Secrets Officer" --scope <vault id>`). The hook is `continueOnError`, so provisioning still succeeds without it; run the script by hand afterwards.
3. The script saves `SEARCH_KEYS_IN_VAULT=true` in the azd environment of the machine that ran it. The next `azd provision` there gives the api the Key Vault reference `SEARCH_QUERY_KEY` (a reference to a missing secret would fail the revision, so it is off until the secret exists). The CI deploy starts from a fresh azd environment, so also set the repo variable once the secrets exist: `gh variable set SEARCH_KEYS_IN_VAULT --body true`. `ENTRA_CLIENT_ID` and `ALERT_EMAIL` are repo variables for the same reason (`gh variable set ENTRA_CLIENT_ID --body <app id>`), otherwise a merge to main would turn sign-in and alerts off.
4. `scripts/build_kb.py` reads `srch-admin-key` through the OIDC identity's Key Vault access (Key Vault Secrets User).
Not verified: no live provision yet (`az bicep build` passes with no warnings on Bicep 0.48).

**Re-run the role setup once.** The condition on the deploy identity's Role Based Access Control Administrator assignment lists the allowed roles. Cognitive Services User (`a97b65f3-...`, AGT-12), Storage Blob Data Owner (`b7e6dc6d-...`) and Storage Queue Data Contributor (`974c5e8b-...`, AGT-15) were added to that list, so update the assignment with the `COND` block above (`az role assignment update` on it, or delete and recreate it) before the next deploy, or the role assignment for Content Safety is refused.

## Recap function (AGT-15)
`services/recap` is a Python v2 Azure Functions app: an Event Hubs trigger on `match-events` (`$Default`, identity-based `EVENTHUB__*` settings, retry 3 x 10 s) that spots the end of the final period (`RECAP_FINAL_PERIODS`, default `2`; use `2,4` if extra time is played, `1` for the one-period test match). With `2,4` the end of period 2 writes a regulation-time recap, since the function cannot know whether extra time follows, and the end of period 4 is sent with `final: true`, which makes the api write the recaps again over it. The duplicate guard (skip personas that already have a recap) works against the api's store, which a single replica holds in memory and reads through from Table Storage (ADR-0005) and calls `POST /internal/v1/recaps` on the api, which writes the recaps (03 F8). It holds no agent logic.
- Hosting: Flex Consumption (`FC1`), maximum instance count 40 (the lowest value older API versions accept; the trigger only fires at full time, so it stays at 0 to 1 in practice), no key or connection string; deployment package in the `app-package` container, host state and checkpoints in the storage account under `AzureWebJobsStorage__*`. The checkpoints are the Functions host's own (`azure-webjobs-eventhub`), not `eh-checkpoints/recap` as the first design said.
- Code goes up with `azd deploy recap` (the deploy workflow runs it after provisioning; a failure is a warning).
- The one plain connection string is `APPLICATIONINSIGHTS_CONNECTION_STRING` (an ingestion id, not a credential), as on the container apps before they reference it as a secret.
- Sign-in: when `ENTRA_CLIENT_ID` is set, the function asks for a token for `api://<client id>/.default` and the api route needs the Producer role, so the identity `id-matchcast` must be assigned the `Producer` app role of `matchcast-web` (Entra step, with the judge account; one command, `az rest` on `appRoleAssignedTo`). With sign-in off no token is sent.
- Not verified: no live provision or deploy yet; the function logic is tested with a mock api (`services/recap/tests`).

## Judge path on one machine

`make judge-path` (or `scripts/judge_path.py`, add `--e2e` for the Playwright unified spec) boots the api with rules agents, the in-memory store and the in-process event stream, builds the unified app, and checks `/health`, `/ready`, the three built views, a match from the fixture through to verified claims (`scripts/smoke_pipeline.py`) and the routes in the openapi document. It calls no Azure or Foundry service. Passes locally in about 15 s without `--e2e`; the browser-level flow is covered by the e2e suite.

## Replaying a match into the hub

`uv run python scripts/replay_match.py --match M001 --speed 4 --sink eventhub --url https://<api-fqdn> --session-id demo` creates the match through the api, then publishes the converted events to `match-events` with the stream key as partition key (needs `EVENTHUB_FQDN` and an Entra login with Azure Event Hubs Data Sender; the api must run with `PIPELINE_MODE=eventhubs` to consume them). Tested with a stub api and a fake publisher; **not run against a real hub**.

## First deploy on the Mac mini (PLT-7, 23 Oct)

Environment `dev` in `rg-matchcast` (East US 2 for the apps; AI Search in East US, because East US 2 had no free-tier capacity when Search was created). Provisioned by `azd provision -e dev` run by Akshay on the Mac mini. The first attempts stopped on the Search region and on a Key Vault role id typo (fixed here and in `infra/modules/roles.bicep`). Images were built for linux/amd64 (the Mac mini is arm64).

URLs:
- api: https://ca-api-matchcast-dev.calmbay-045566e2.eastus2.azurecontainerapps.io
- web: https://ca-web-matchcast-dev.calmbay-045566e2.eastus2.azurecontainerapps.io
- mcp: `ca-mcp-matchcast-dev`, internal ingress, still on the quickstart placeholder (no `services/mcp/Dockerfile` yet)
- recap function: `fn-matchcast-dev-recap-hno67`

Images: `ghcr.io/crafted-by-akshay/matchcast-api` and `matchcast-web` at `sha-3d627d1`. Both GHCR packages were made public by Akshay, so their source is public.

Checks against the live api (23 Oct, after the image switch):
- `/health` 200 (0.82 s); `/ready` 200 (0.74 s): configuration valid, model credential obtained (model call not probed), session store `local_mock`.
- `/v1/status` 200 (0.89 s): overall `unavailable`. Live: Table Storage, Speech, Translator. Simulated: Foundry agents (rules agents), Event Hubs (in-process stream), Entra sign-in. Planned: Content Safety, AI Search, Fabric, Databricks. Unavailable: Vision, because `VISION_ENDPOINT` is not set (Vision is not in Bicep yet).
- Web 200 (1.25 s).
- `scripts/health_check.sh` reports UNHEALTHY only for the Vision dependency.

Smoke (`scripts/smoke_pipeline.py`): FAILED. The match was created in rules mode, then the events POST returned 500. The api logs show Table Storage `OutOfRangeInput` on the marker row in the `events` table, partition key `<stream>#ids` (`packages/agents/matchcast_agents/tables.py`, `add_event`). Azure Table Storage rejects `#` in PartitionKey and RowKey. A later probe's match-create call also returned 500 and was not traced. Not fixed in this PR; the events and load path needs a code fix first.

Load (`tests/e2e/load.spec.ts`, chromium, against the live web): passed in 46.5 s. Marks: picker 2.4 s, Watch started 12.8 s, Analyst ready 18.2 s, Broadcast ready 41.5 s. The webkit project was not run (browser not installed here).

Not done: identity setup (Entra app, GitHub OIDC, production environment, repo variables), the mcp image, and any teardown.
