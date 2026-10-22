# 12 Interfaces: REST, SSE, MCP, A2A, events

Status: **Agreed design**. Last reviewed 22 Oct 2026. The generated OpenAPI file is the final word on field types; this file is the design it must match.

## 1. Conventions

- Base URL `https://<api-fqdn>`; every route except `/health` and `/ready` starts with `/v1` (public) or `/internal/v1` (service to service).
- Match-scoped routes take `{match_id}` in the path and `session_id` as a query parameter. The tenant is `demo`, set by the server. Together these form the stream key (see [07-data-and-storage.md](07-data-and-storage.md) §2).
- JSON in and out, UTF-8, `snake_case`. Times are RFC 3339 UTC with `Z`. Match times are integer milliseconds.
- Errors use RFC 9457 `application/problem+json`: `{type, title, status, detail, code, path, trace_id}`. `code` values are listed in §6.
- `X-Request-Id` is accepted or generated and returned. `trace_id` is the OpenTelemetry trace ID.
- FastAPI publishes `/openapi.json`. A snapshot lives at `docs/api/openapi.json`, and CI fails if the live schema differs from it. Refresh it with `make openapi-generate` in any PR that changes a route (committed 22 Oct, 24 paths including the local `/sessions` routes).
- The S03 local `/sessions` routes stay for local tests only and are not deployed in cloud mode.

## 2. REST endpoints

| Method and path | Who | Body or query | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /health` | anyone | none | 200 `{status}` | none |
| `GET /ready` | anyone | none | 200 or 503 with dependency states | 503 |
| `POST /v1/matches` | anyone | `session_id, match_id, roster, names, clubs, approval_mode`, optional `seed_bad_claim`, `seed_bad_claim_at_ms`, and the descriptive `seed, engine_version, home_team_id, away_team_id, venue_id, kickoff_local` (accepted, not used by the api yet) | 201 `{stream, approval_mode, mode}` | 409 `match_exists`, 422 |
| `GET /v1/matches/{match_id}` | anyone | `session_id` | 200 match + current state | 404 |
| `POST /v1/matches/{match_id}/events` | anyone | `session_id`; `{events: [...]}` 1 to 50 contract events | 202 `{accepted, last_sequence}` | 422 invalid event (first bad index and validator message); 409 `sequence_gap` and 503 `publish_failed` are **Planned** with Event Hubs |
| `GET /v1/matches/{match_id}/stream` | anyone | `session_id, persona, lang`; `Last-Event-ID` header | 200 `text/event-stream` | 404, 422 `contract_invalid` for an unknown persona, 429 watch-mode cap |
| `GET /v1/matches/{match_id}/claims` | anyone | `session_id, verdict?, agent?, metric?, limit ≤ 500, cursor?` | 200 page | 404 |
| `GET /v1/matches/{match_id}/lines` | Producer | `session_id, status?` | 200 page (the approval queue) | 403 |
| `POST /v1/lines/{line_id}/approve` | Producer | `session_id, match_id` | 200 line (+ publication) | 403, 404, 409 not approvable |
| `POST /v1/lines/{line_id}/edit` | Producer | `session_id, match_id, text ≤ 280` | 200 line after re-verification | 403, 404, 422 rejected (verdict in body) |
| `POST /v1/lines/{line_id}/kill` | Producer | `session_id, match_id, reason ≤ 200` | 200 | 403, 404 |
| `GET /v1/matches/{match_id}/audit` | anyone | `session_id, from_seq?, limit ≤ 1000` | 200 records | 404 |
| `GET /v1/matches/{match_id}/trace/{line_id}` | anyone | `session_id` | 200 steps with agent, duration, model or rules, tokens, tools | 404 |
| `POST /v1/matches/{match_id}/ask` | anyone | `session_id, question ≤ 300, persona` (`browser_session_id` and `lang` are **Planned**) | 200 `{answer, intent, abstained, citations[], mode}` (`claim_ids`, `verdict` and `trace_id` are **Planned**) | 400 shield, 429 |
| `POST /v1/matches/{match_id}/talk` | anyone | `session_id, target (player_id or producer), utterance ≤ 300` | 200 `{target, reply, verdict, facts}` (rules-mode template replies; `audio_url` and `lang` are **Planned** with Speech) | 400 `prompt_attack`, 404 unknown target, 422, 429 |
| `POST /v1/matches/{id}/vision/identify` | anyone | `session_id, crop (base64 PNG 128x128, ≤ 40 KB), track_id, team_hint` | 200 `{shirt, confidence, source, elapsed_ms}`. Plain base64 only (no `data:` prefix); a complete PNG, exactly 128x128. | 404, 413 (body over 64 KB or crop over 40 KB decoded), 422 (bad crop, or `crop` over 60,000 characters), 429 `rate_limited`/`vision_budget_used`, 502 `vision_unavailable` |
| `GET /v1/exports/{export_id}` | anyone | none | 200 the file as an attachment | 404 |
| `POST /v1/ds/ask` | anyone | `session_id, question ≤ 300` | 200 `{answer, verdict, sql, columns[], rows[], chart_spec}` | 400 `invalid_query`, 429, 503 |
| `GET /v1/speech/token` | anyone | none | 200 `{token, region, expires_at}` | 429 (10 a minute per IP), 503 `not_ready` without a Speech resource. **Planned**: not built yet |
| `GET /v1/audio/{publication_id}.{lang}.mp3` | anyone | `session_id, match_id` | 200 `audio/mpeg` | 404. **Planned** (server-side voice) |
| `GET /v1/matches/{match_id}/recap/{persona}` | anyone | `session_id` | 200 recap | 404 not ready |
| `POST /v1/matches/{match_id}/exports` | Viewer | `session_id, kind (claims_csv, events_json), verdict?, agent?, metric?` | 201 `{export_id, url, sha256, rows}` | 403 |
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
| `status` | `{status, reason?}`: `live`, `rules_fallback` (with `reason` from the `fallback_reason` list in 04-agents.md §4) or `warming_up`. Sent only when the status or reason changes; every refusal is still audited as `fallback_used` | none |
| `heartbeat` | server time | none, every 15 s |

`persona` is `casual`, `analyst`, `broadcast` (aliases `fan`, `producer`) or a watch mode: `club:<id or name>`, `player:<id or name>`, `metric:<name>` (server forms `my-club:`, `player-focus:`, `one-metric:`). A watch mode must name a real club, player or metric of the match; opening the stream registers it for the match from the next moment on (no back-fill), at most 8 extra modes per match, kept until the match ends.

On reconnect with `Last-Event-ID`, the server replays publications and audit records after that point (at most 500), then continues live.

## 4. MCP and A2A

- MCP server: `services/mcp`, Streamable HTTP at `/mcp`. Tools and limits are listed in [04-agents.md](04-agents.md) §6. Internal callers (`api`) use the internal FQDN; Copilot uses the external route behind Easy Auth.
- A2A: Stats Desk at `/a2a` on the `mcp` container only (not mounted on the public api; internal ingress), Agent Card at `/.well-known/agent-card.json` with name `MatchCast Stats Desk`, one skill `compare_to_season`, input `{skill, metric, scope (team|player), value, team_id?}`, output `{metric, scope, team_id, value, season_average, rank, of, matches}`. `of` counts the season's team (or player) match performances: 56 for teams, not matches. Bad input gets a JSON-RPC `-32602` error.

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
| `sequence_gap` | 409 | **Planned**: more than 50 missing sequences before this batch |
| `match_exists` | 409 | `POST /v1/matches` for an existing stream key |
| `not_found` | 404 | Unknown match, line, export, publication or recap |
| `unauthenticated` | 401 | Easy Auth is on and no caller is present |
| `not_approvable` | 409 | Approve or edit on a line that is not waiting |
| `crop_too_large` | 413 | Vision request body or crop over the limit |
| `invalid_crop` | 422 | Vision crop is not a complete 128x128 PNG |
| `vision_budget_used` | 429 | The Vision call budget is spent |
| `vision_unavailable` | 502 | The OCR service did not answer |
| `forbidden_role` | 403 | Producer route without the Producer or Admin role |
| `invalid_query` | 400 | `/ds/ask` produced SQL the season guard refused |
| `prompt_attack` | 400 | Prompt Shields flagged the input |
| `rate_limited` | 429 | Over a limit in §7; `Retry-After: 60` set on per-minute limits (not on the watch-mode cap, which time does not clear) |
| `publish_failed` | 503 | **Planned**: Event Hubs publish failed; retry the same batch |
| `not_ready` | 503 | Dependency not ready; see `/ready` |

## 7. Rate limits

| Route | Limit | Key |
| --- | --- | --- |
| `/events` | 20 batches a second (**Planned**, not enforced yet) | stream key |
| `/ask`, `/talk` | 5 a minute | `browser_session_id` (or IP) |
| `/ds/ask` | 5 a minute | client address |
| `/vision/identify` | 15 a minute and 3,000 in total (`VISION_MAX_CALLS`) | one api process (a cost cap, shared by all callers) |
| `/speech/token` | 10 a minute (**Planned**) | IP |

Limits are kept in memory in the single `api` replica (ADR-0005).

## Seeded bad claim (demo cue)

`POST /v1/matches` accepts `seed_bad_claim` (boolean) and `seed_bad_claim_at_ms` (match time, default 720000, minute 12). The header `X-MatchCast-Seed-Bad-Claim: 1` has the same effect as `seed_bad_claim: true`. From that match time the Analyst corrupts one claim number, the Verifier rejects the line, and the repair path runs once (04-agents.md §3).
