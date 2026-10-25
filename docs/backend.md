# Backend configuration, readiness, and local sessions

This document describes the S03 local API foundation. It does not claim durable
storage, authentication, model access, or any cloud dependency is ready.

## Configuration

The API reads these process environment variables at startup. It does not load
`.env` files automatically.

| Variable | Default | Validation and use |
| --- | --- | --- |
| `MATCHCAST_MODE` | `local` | `local` or `cloud` |
| `FOUNDRY_PROJECT_ENDPOINT` | unset | Required in `cloud` mode; absolute HTTPS URL of the Foundry project |
| `FOUNDRY_MODEL_DEPLOYMENT` | unset | Required and non-blank in `cloud` mode; deployment name, `gpt-5-mini` |

There is no API key. Cloud mode authenticates with Microsoft Entra ID through
`DefaultAzureCredential` (`az login` locally, the managed identity `id-matchcast` in Azure).

Local mode requires no credentials and makes no model connection. Cloud mode
configuration is validated at startup. The API process stays live when configuration
is invalid so orchestration can inspect readiness and repair the environment.
Configuration errors name missing or invalid settings without echoing values.

## Health and readiness

`GET /health` is a liveness probe. It returns HTTP 200 and
`{"status":"healthy"}` when the API process can answer. It does not contact a
model or assert that dependencies are ready.

`GET /ready` reports overall status, configuration, and dependency statuses:

| Situation | Overall / model status | HTTP |
| --- | --- | --- |
| Valid local configuration | service `ready` / model and store `local_mock` | 200 |
| Invalid or incomplete configuration | `not_ready` / `unavailable` | 503 |
| Valid cloud configuration, no Entra credential obtainable | `not_ready` / `unavailable` | 503 |
| Valid cloud configuration, credential obtained | `ready` / `ready` (the credential is probed; no model call is made) | 200 |

The top-level `ready` status in local mode means the local API profile can serve
requests; it does not mean a dependency is genuinely ready. Each dependency reports
its own state. `local_mock` marks a local substitute, `unavailable` means
readiness cannot be established (invalid configuration or no credential), and
`ready` means a token for Azure AI was obtained. Readiness never calls the model;
`scripts/smoke_foundry.py` does that. The status strings are diagnostic states, not
a claim that the full product readiness gates pass.

Run locally with defaults:

```sh
uv run --locked --package matchcast-api uvicorn app.main:app --app-dir services/api --reload
curl -i http://localhost:8000/health
curl -i http://localhost:8000/ready
```

For an intentional negative configuration probe, start with
`MATCHCAST_MODE=cloud` and omit the Foundry settings. `/health` remains 200;
`/ready` returns 503 with the missing settings. With both set and `az login` done,
`/ready` returns 200 and the model dependency is `ready`.

Prove one keyless model call (needs the `gpt-5-mini` deployment and the Azure AI User
role): `make smoke-foundry`. It prints the model name, token counts and latency, never
credentials.

## Local session API

Session identity is the S02 tuple `(tenant_id, session_id, match_id)`. All three
IDs are required and must use the same 1–128 character identifier syntax as the
shared contracts. Operations use the full tuple as the storage key, so two
sessions for the same match remain independent across tenants and sessions.

| Operation | Request / result |
| --- | --- |
| `POST /sessions` | `{"stream":{"tenant_id":"t1","session_id":"s1","match_id":"m1"}}`; creates an empty state with revision 0; duplicate identity returns 409 |
| `GET /sessions/{tenant_id}/{session_id}/{match_id}` | Returns stream, state, and state revision; unknown identity returns 404 |
| `PUT /sessions/{tenant_id}/{session_id}/{match_id}` | `{"state":{...}}` replaces the whole JSON object and increments state revision; unknown identity returns 404 |
| `POST /sessions/{tenant_id}/{session_id}/{match_id}/reset` | Replaces state with `{}` and increments state revision; unknown identity returns 404 |

Invalid IDs and non-JSON/non-finite state values return 422. Reset is explicit
state replacement; it does not delete the registry entry or reset its revision.
This S03 store exists only in process memory: restart loses sessions, separate API
replicas do not share them, and no authorization boundary is implemented. A
durable store, authenticated tenant enforcement, replay/history, and production
readiness probes are later work.

## Match routes (AGT-3)

`services/api/app/matches.py` mounts the `/v1` routes from `docs/architecture/12-api.md` on the
rules-mode workflow in `packages/agents`: create a match with its roster, post contract event
batches, read `claims`, `lines`, `audit` and `trace/{line_id}`, follow the SSE `stream`, and
approve, edit or kill lines. Errors are RFC 9457 problems with a `code`.

- The tenant is `demo`; the roster's `stream` must equal `(demo, session_id, match_id)`.
- Everything is in memory in one process (ADR-0005). No model is called.
- `GET .../stream?follow=false` sends status, state and the replay, then closes (useful for curl and tests).
- Producer routes (lines, approve, edit, kill) check the caller's role only when
  `MATCHCAST_REQUIRE_ROLE=1`. With `MATCHCAST_EASY_AUTH=1` (set by Bicep when Entra sign-in is
  on) the role comes from the Easy Auth `X-MS-CLIENT-PRINCIPAL` header: no caller gives 401
  `unauthenticated` (the browser then goes to `/.auth/login/aad`), a Viewer gives 403
  `forbidden_role`, Producer and Admin pass, and the `X-MatchCast-Role` header is ignored.
  Without Easy Auth (local mode) the `X-MatchCast-Role` header (`Producer` or `Admin`) is used.
  `app/auth.py` holds the parsing and the `caller_role` dependency.
- Built since: `/ask`, `/talk` (5 a minute per browser session, shared), `/ds/ask` (5 a minute per
  client), recap, exports, the per-minute `Retry-After: 60` on those 429s, the MCP tools at `/mcp`
  (`MATCHCAST_TOOLS=mcp` routes the Analyst's `get_metrics` through them), the Stats Desk, and the
  `docs/api/openapi.json` snapshot (`make openapi-generate`).
- Not built yet: vision identify (Analyst lane, DAT-11), speech token and audio routes; the
  Azure-backed pieces that need the Mac mini (embeddings and AI Search upload, live Foundry
  validation, Table store under load, see doc 07 §11); the `ds_abstained` audit action (a contract
  change that needs all lanes to agree).
