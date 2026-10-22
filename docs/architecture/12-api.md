# 12 Interfaces: REST, SSE, MCP, A2A, events

Status: **Agreed design**. Last reviewed 22 Oct 2026. The generated OpenAPI file is the final word on field types; this file is the design it must match.

## 1. Conventions

- Base URL `https://<api-fqdn>`; every route except `/health` and `/ready` starts with `/v1` (public) or `/internal/v1` (service to service).
- Match-scoped routes take `{match_id}` in the path and `session_id` as a query parameter. The tenant is `demo`, set by the server. Together these form the stream key (see [07-data-and-storage.md](07-data-and-storage.md) §2).
- JSON in and out, UTF-8, `snake_case`. Times are RFC 3339 UTC with `Z`. Match times are integer milliseconds.
- Errors use RFC 9457 `application/problem+json`: `{type, title, status, detail, code, path, trace_id}`. `code` values are listed in §6.
- `X-Request-Id` is accepted or generated and returned. `trace_id` is the OpenTelemetry trace ID.
- FastAPI publishes `/openapi.json`. A snapshot lives at `docs/api/openapi.json`, and CI fails if the live schema differs from it.
- The S03 local `/sessions` routes stay for local tests only and are not deployed in cloud mode.

## 2. REST endpoints

| Method and path | Who | Body or query | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /health` | anyone | none | 200 `{status}` | none |
| `GET /ready` | anyone | none | 200 or 503 with dependency states | 503 |
| `POST /v1/matches` | anyone | `session_id, match_id, seed, engine_version, home_team_id, away_team_id, venue_id, kickoff_local, approval_mode, roster` | 201 match | 409 exists, 422 |
| `GET /v1/matches/{match_id}` | anyone | `session_id` | 200 match + current state | 404 |
| `POST /v1/matches/{match_id}/events` | anyone | `session_id`; `{events: [...]}` 1 to 50 contract events | 202 `{accepted, last_sequence}` | 422 invalid event (first bad index and validator message), 409 sequence gap over 50, 503 publish failed |
| `GET /v1/matches/{match_id}/stream` | anyone | `session_id, persona, lang`; `Last-Event-ID` header | 200 `text/event-stream` | 404 |
| `GET /v1/matches/{match_id}/claims` | anyone | `session_id, verdict?, agent?, metric?, limit ≤ 500, cursor?` | 200 page | 404 |
| `GET /v1/matches/{match_id}/lines` | Producer | `session_id, status?` | 200 page (the approval queue) | 403 |
| `POST /v1/lines/{line_id}/approve` | Producer | `session_id, match_id` | 200 line (+ publication) | 403, 404, 409 not approvable |
| `POST /v1/lines/{line_id}/edit` | Producer | `session_id, match_id, text ≤ 280` | 200 line after re-verification | 403, 404, 422 rejected (verdict in body) |
| `POST /v1/lines/{line_id}/kill` | Producer | `session_id, match_id, reason ≤ 200` | 200 | 403, 404 |
| `GET /v1/matches/{match_id}/audit` | anyone | `session_id, from_seq?, limit ≤ 1000` | 200 records | 404 |
| `GET /v1/matches/{match_id}/trace/{line_id}` | anyone | `session_id` | 200 steps with agent, duration, model or rules, tokens, tools | 404 |
| `POST /v1/matches/{match_id}/ask` | anyone | `session_id, browser_session_id, question ≤ 300, persona, lang` | 200 `{answer, citations[], claim_ids[], verdict, trace_id}` | 400 shield, 429 |
| `POST /v1/matches/{match_id}/talk` | anyone | `session_id, target (player_id or producer), utterance ≤ 300, lang` | 200 `{reply, audio_url, verdict}` | 400, 429 |
| `POST /v1/ds/ask` | anyone | `question ≤ 300` | 200 `{answer, sql, rows[], chart_spec, verdict}` | 400, 429 |
| `POST /v1/matches/{match_id}/vision/identify` | anyone | `session_id, crop, track_id, team_hint` | 200 `{shirt, confidence, source, elapsed_ms}` | 413, 429 |
| `GET /v1/speech/token` | anyone | none | 200 `{token, region, expires_at}` | 429 (10 a minute per IP) |
| `GET /v1/audio/{publication_id}.{lang}.mp3` | anyone | `session_id, match_id` | 200 `audio/mpeg` | 404 |
| `GET /v1/matches/{match_id}/recap/{persona}` | anyone | `session_id` | 200 recap | 404 not ready |
| `POST /v1/matches/{match_id}/exports` | Viewer | `session_id, kind (claims_csv, events_json), filters` | 201 `{export_id, url, sha256}` | 403 |
| `POST /internal/v1/recaps` | `fn-recap` identity only | `tenant_id, session_id, match_id` | 202 | 401, 403 |

"Anyone" means unauthenticated access is allowed (judges can view without signing in). "Viewer" means any signed-in user. "Producer" means the `roles` claim contains `Producer` or `Admin`.

## 3. Server-Sent Events

`GET /v1/matches/{match_id}/stream` sends:

| `event:` | `data:` | `id:` |
| --- | --- | --- |
| `state` | score, clock, possession, revision | `state:<revision>` |
| `claim` | claim packet | `claim:<claim_id>` |
| `line` | line with status | `line:<line_id>:<status>` |
| `publication` | publication with the variant for `lang` (+ English) | `pub:<publication_id>` |
| `audit` | audit record | `audit:<sequence>` |
| `recap_ready` | personas available | `recap` |
| `status` | `live`, `rules_fallback`, `warming_up` | none |
| `heartbeat` | server time | none, every 15 s |

On reconnect with `Last-Event-ID`, the server replays publications and audit records after that point (at most 500), then continues live.

## 4. MCP and A2A

- MCP server: `services/mcp`, Streamable HTTP at `/mcp`. Tools and limits are listed in [04-agents.md](04-agents.md) §6. Internal callers (`api`) use the internal FQDN; Copilot uses the external route behind Easy Auth.
- A2A: Stats Desk at `/a2a`, Agent Card at `/.well-known/agent-card.json` with name `matchcast-stats-desk`, one skill `compare_to_season`, input `{metric, team_id | player_id}`, output `{value, season_avg, rank, of: 28}`.

## 5. Event Hubs messages

- Hub `match-events`, partition key = stream key.
- Body: one contract packet as JSON (`application/json`).
- Application properties: `kind`, `schema_version`, `sk`, `stream_sequence`.
- Producers: `api` only. Readers: `api` consumer, `fn-recap`, Fabric Eventstream (all on `$Default`).

## 6. Error codes

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `contract_invalid` | 422 | A packet failed contract validation; `path` is a JSON pointer |
| `roster_required` | 422 | Player-bearing event without a roster for the match |
| `sequence_gap` | 409 | More than 50 missing sequences before this batch |
| `match_exists` | 409 | `POST /v1/matches` for an existing stream key |
| `not_found` | 404 | Unknown match, line, publication or recap |
| `forbidden_role` | 403 | Producer route without the Producer or Admin role |
| `prompt_attack` | 400 | Prompt Shields flagged the input |
| `rate_limited` | 429 | Over a limit in §7; `Retry-After` set |
| `publish_failed` | 503 | Event Hubs publish failed; retry the same batch |
| `not_ready` | 503 | Dependency not ready; see `/ready` |

## 7. Rate limits

| Route | Limit | Key |
| --- | --- | --- |
| `/events` | 20 batches a second | stream key |
| `/ask`, `/talk` | 5 a minute | `browser_session_id` (or IP) |
| `/ds/ask` | 5 a minute | IP |
| `/vision/identify` | 15 a minute | stream key |
| `/speech/token` | 10 a minute | IP |

Limits are kept in memory in the single `api` replica (ADR-0005).
