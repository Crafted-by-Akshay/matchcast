# Backend configuration, readiness, and local sessions

This document describes the S03 local API foundation. It does not claim durable
storage, authentication, model access, or any cloud dependency is ready.

## Configuration

The API reads these process environment variables at startup. It does not load
`.env` files automatically.

| Variable | Default | Validation and use |
| --- | --- | --- |
| `MATCHCAST_MODE` | `local` | `local` or `cloud` |
| `MATCHCAST_MODEL_ENDPOINT` | unset | Required in `cloud` mode; absolute HTTPS URL |
| `MATCHCAST_MODEL_API_KEY` | unset | Required and non-blank in `cloud` mode; treated as a secret and never returned by readiness |

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
| Valid cloud configuration, adapter not implemented | `not_ready` / `pending` | 503 |
| A real dependency connection succeeds | dependency `ready` is reserved for a future adapter that performs a successful real probe | Not implemented |

The top-level `ready` status in local mode means the local API profile can serve
requests; it does not mean a dependency is genuinely ready. Each dependency reports
its own state. `local_mock` marks a local substitute, `pending` means configuration
is valid but that adapter/probe has not been implemented, `unavailable` means
readiness cannot be established because configuration is invalid, and `ready` is
reserved for a future dependency adapter after its real probe succeeds. No current
cloud configuration can produce dependency `ready`. The status strings are
diagnostic states, not a claim that the full product readiness gates pass.

Run locally with defaults:

```sh
uv run --locked --package matchcast-api uvicorn app.main:app --app-dir services/api --reload
curl -i http://localhost:8000/health
curl -i http://localhost:8000/ready
```

For an intentional negative configuration probe, start with
`MATCHCAST_MODE=cloud` and omit the model endpoint/key. `/health` remains 200;
`/ready` returns 503 with the missing settings. Supplying both values changes the
model dependency to `pending` until a real adapter is delivered.

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
