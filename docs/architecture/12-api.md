# 12 Interfaces: REST, SSE, MCP, A2A, events

Status: **Agreed design**. Last reviewed 25 Oct 2026. The generated OpenAPI file is the final word on field types; this file is the design it must match.

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
| `GET /v1/status` | anyone | none | 200 `{mode, overall, counts, dependencies[{key, label, status, detail}]}` with `status` one of `live`, `simulated`, `planned`, `unavailable` | none (never 503; states come from the process settings, no Azure call, no endpoint values in the body. Cloud mode with a resource unset is `unavailable`, local mode is `simulated`; Fabric, Databricks, Content Safety and Search are `planned` (provisioned or not built; no app code calls them yet). A resource whose setting is malformed (Speech without its region, a Vision host outside Azure) is `unavailable`, and Entra sign-in is `live` only with both Easy Auth and required roles. `/ready` keeps its own shape for orchestrators) |
| `GET /v1/models/danger/card` | anyone | none | 200 the danger model card JSON (`name`, `version`, `label`, `metrics`, `calibration[]`, `training_data`, `limits`) | 404 `no model card for the danger model` (and 503 `the model card cannot be read` when the file is corrupt) when the model folder (`MATCHCAST_DANGER_MODEL`, default `data/models/danger/v1`) has none. Read from the image, not from Blob: the card is baked in with the model. The Analyst Data platform page shows it and falls back to its shipped copy |
| `GET /ready` | anyone | none | 200 or 503 with dependency states | 503 |
| `POST /v1/matches` | anyone | `session_id, match_id, roster, names, clubs, approval_mode`, optional `seed_bad_claim`, `seed_bad_claim_at_ms`, and the descriptive `seed, engine_version, home_team_id, away_team_id, venue_id, kickoff_local` (accepted, not used by the api yet) | 201 `{stream, approval_mode, mode}` | 409 `match_exists`, 422 |
| `GET /v1/matches/{match_id}` | anyone | `session_id` | 200 match + current state | 404 |
| `POST /v1/matches/{match_id}/events` | anyone | `session_id`; `{events: [...]}` 1 to 50 contract events | 202 `{accepted, last_sequence}`. Direct mode (no event stream): the events are applied before the reply and `last_sequence` is the match's highest applied sequence. Event Hubs mode: the batch is published before the reply and `last_sequence` is the highest sequence in this batch; the consumer applies it afterwards, so state may lag | 422 invalid event (first bad index and validator message); 503 `publish_failed` in Event Hubs mode (nothing was accepted; send the same batch again); 409 `sequence_gap` is **Planned** |
| `GET /v1/matches/{match_id}/booth` | anyone | `session_id` | 200 `{ready, personas[], reason, mode, held}`: registers the commentary booth (both voices) for the match; `ready` false with `reason: watch_mode_cap` when the match already has the most watch modes, so the client can fall back to the rules booth instead of a stream that answers 429 | 404 |
| `GET /v1/matches/{match_id}/stream` | anyone | `session_id, persona, lang (en, es, pt, hi, ar, fr, de, id, ja, zh-Hans; ADR-0023)`; `Last-Event-ID` header | 200 `text/event-stream`; with `lang=en` and a Speech resource a publication also carries `audio_url`, the line audio route below (the clip is made only when a viewer plays it); with `lang` a publication also carries `variants[lang]` when the checked translation passed (10 §4) | 404, 422 `contract_invalid` for an unknown persona or language, 429 watch-mode cap |
| `GET /v1/matches/{match_id}/claims` | anyone | `session_id, verdict?, agent?, metric?, limit ≤ 500, cursor?` | 200 page | 404 |
| `GET /v1/matches/{match_id}/lines` | Producer | `session_id, status?` | 200 page (the approval queue) | 403 |
| `POST /v1/lines/{line_id}/approve` | Producer | `session_id, match_id` | 200 line (+ publication) | 403, 404, 409 not approvable |
| `POST /v1/lines/{line_id}/edit` | Producer | `session_id, match_id, text ≤ 280` | 200 line after re-verification | 403, 404, 422 rejected (verdict in body) |
| `POST /v1/lines/{line_id}/kill` | Producer | `session_id, match_id, reason ≤ 200` | 200 | 403, 404 |
| `POST /v1/matches/{match_id}/feeds/{feed}/kill` | Producer | `session_id, reason ≤ 200`; `feed` one of the six keys in `docs/contracts.md` (AB#499; the air gate enforces the kill) | 200 `{feed, state: killed, audit_id, enforced: true}` | 403, 422 unknown feed, 404 |
| `POST /v1/matches/{match_id}/feeds/{feed}/resume` | Producer | `session_id, reason ≤ 200` | 200 `{feed, state: live, audit_id, enforced: true}` | 403, 422, 404 |
| `GET /v1/matches/{match_id}/audit` | anyone | `session_id, from_seq?, limit ≤ 1000` | 200 records | 404 |
| `GET /v1/matches/{match_id}/scoreboard` | anyone | `session_id` | 200 the three-arm crew scoreboard (`kind: crew_ablation_scoreboard`). The rules arms (`mode: rules`) are computed from the stored events and cached per match, event count and run date. When `MATCHCAST_SCOREBOARD_LIVE_RUN` names a recorded live run for this match, its arms replace them as `mode: precomputed` with the run id. The route never calls a model | 404 |
| `GET /v1/matches/{match_id}/scoreboard/input` | anyone | `session_id` | 200 the stored `events`, `roster`, `names` and `teams` of the match: the input of a live scoreboard recording (`scripts/scoreboard_live.py`). It makes no model call and writes nothing once the match is loaded; a cold read rebuilds the match, which writes its record once, as `/audit` and `/scoreboard` do | 404 |
| `GET /v1/matches/{match_id}/trace/{line_id}` | anyone | `session_id` | 200 steps with agent, duration, model or rules, tokens, tools | 404 |
| `POST /v1/matches/{match_id}/ask` | anyone | `session_id, question ≤ 300, persona, lang (the same ten), surface (ask or broadcast; default ask)` (`browser_session_id` is **Planned**) | 200 `{answer, intent, abstained, citations[], mode, retrieval, lang, variants?, broadcast?}` where `broadcast` is `{highlights[]}`, `{focus}` or `{plan[]}` when `surface` is `broadcast` and the question asks for one (ADR-0019). `claim_ids`, `verdict` and `trace_id` are **Planned**. | 400 shield, 429 |
| `POST /v1/matches/{match_id}/talk` | anyone | `session_id, target (player_id or producer), utterance ≤ 300, position (optional sim code, GK, CB, ST...; the Watch client asserts it and the api applies the role table to it)` | 200 `{target, reply, verdict, facts, order, lang, audio_url}` (`order` is `null`, or `{key, accepted}` for an instruction the player heard: accepted only when the role guard allows it for that position and the reply is verified, ADR-0016; a refused order's reply is his in-character refusal; in live mode the player's own reply from the model, checked against the log's counts and names, with `facts` the player's counts; otherwise, or when the model's reply fails a check, the rules template; a reply with words for counts is refused; the reply passes Content Safety as well as the Verifier; without `CONTENT_SAFETY_ENDPOINT` that check is the local word list (**Simulated**). `lang` is `en`; `audio_url` is `/v1/audio/{id}.mp3` only for a verified reply that was voiced, otherwise null; a clip stays in the api's memory for a while, so fetch it promptly) | 400 `prompt_attack`, 404 unknown target, 422, 429 |
| `WS /v1/matches/{match_id}/call` | anyone | query `session_id`; then JSON text frames `{type: "talk", id, target, position?, utterance ≤ 300}` and `{type: "cancel", id}` | per turn: `reply` (the checked talk result, without `audio_url`); for a verified reply `audio {id, seq, last}` then one binary MP3 frame per sentence; then `audio_end {id, cancelled}`; a failed turn sends `error {id, code}` and the call stays open | unknown match or bad session: refused at the handshake (HTTP 403, so a browser sees close 1006, not 1008); a frame that is not a JSON object, a talk whose id is in flight, or a talk outside the talk route's limits (utterance 1 to 300 characters, player id, position code): `bad_frame` with `id` null or the id, and the call stays open; over the talk budget `rate_limited` |
| `POST /v1/matches/{id}/vision/identify` | anyone | `session_id, crop (base64 PNG 128x128, ≤ 40 KB), track_id, team_hint` | 200 `{shirt, confidence, source, elapsed_ms}`. Plain base64 only (no `data:` prefix); a complete PNG, exactly 128x128. | 404, 413 (body over 64 KB or crop over 40 KB decoded), 422 (bad crop, or `crop` over 60,000 characters), 429 `rate_limited`/`vision_budget_used`, 502 `vision_unavailable` |
| `GET /v1/matches/{id}/vision/summary` | anyone | query `session_id` (the engine session) | 200 `{ready, passes_in, lines_verified, latest_line, agreement: {vision, engine, matched, precision, recall}}`; `ready` is false until the match and its Vision stream exist: what the Vision stream (`<session>.vision`) contributes to the agents on this match (ADR-0022). Zeros until Vision has sent passes. An unknown match is also a 200 with `ready: false`, because the page polls before the match is created. | none |
| `GET /v1/exports/{export_id}` | anyone | none | 200 the file as an attachment | 404 |
| `POST /v1/ds/ask` | anyone | `session_id, question ≤ 300` | 200 `{answer, verdict, sql, columns[], rows[], chart_spec}` | 400 `invalid_query`, 429, 503 |
| `GET /v1/speech/token` | anyone | none | 200 `{token, region, expires_at}` | 429 (10 a minute per IP), 503 `not_ready` without a Speech resource (a Speech-only token from the resource's `/sts/v1.0/issueToken`, exchanged with the api's managed identity, valid 10 minutes and cached 9; never the api's Entra token. Set by `SPEECH_ENDPOINT` and `SPEECH_REGION`. The rate limit keys on the caller: the rightmost `X-Forwarded-For` entry when `MATCHCAST_BEHIND_INGRESS=true` (set by Bicep; the ingress appends it, entries to its left are forgeable), otherwise the socket address) |
| `GET /v1/matches/{match_id}/lines/{line_id}/audio.mp3` | anyone | `session_id` | 200 `audio/mpeg`, the approved line voiced in the commentary voice (markers such as `[claim:…]` are not spoken) | 404 unless the line is on air, 429 `rate_limited` (30 new clips a minute per IP; cache hits are free), 503 `not_ready` without a Speech resource or when the voice budget is used up |
| `GET /v1/audio/{audio_id}.mp3` | anyone | none | 200 `audio/mpeg` from the api's clip cache | 404 unless the api made the clip (any line, audition or talk reply it has voiced; talk replies are reached through their `audio_url`) |
| `GET /v1/voice/audition.mp3` | anyone | none | 200 `audio/mpeg`, a fixed 30-second audition script in the commentary voice | 429, 503 `not_ready` |
| `GET /v1/matches/{match_id}/recap/{persona}` | anyone | `session_id` | 200 recap | 404 not ready |
| `GET /v1/matches/{match_id}/recap/{persona}/audio.mp3` | anyone | `session_id` | 200 `audio/mpeg`, the stored recap read aloud in the commentary voice (only sentences the Verifier marked verified are spoken, packed into parts of under 1,000 characters, at most six, and joined into one mp3; each new part uses one voice allowance) | 404 until the recap exists, 429 and 503 as for line audio |
| `POST /v1/matches/{match_id}/exports` | Viewer | `session_id, kind (claims_csv, events_json), verdict?, agent?, metric?` | 201 `{export_id, url, sha256, rows}` | 403 |
| `POST /internal/v1/recaps` | `fn-recap` identity only | `tenant_id, session_id, match_id` | 202 | 401, 403 |

Each sentence of a reply is one voice clip from the per-address voice allowance (`VOICE_PER_MINUTE`), which the commentary clips share. A reply that runs out of allowance mid-way stops with `audio_end` `cancelled: false`; the text is always shown in full.

"Anyone" means unauthenticated access is allowed (judges can view without signing in). "Viewer" means any signed-in user. "Producer" means the `roles` claim contains `Producer` or `Admin`.

Every match route rebuilds the workflow of a stored match from its roster when this process has not seen it (after a restart of this single replica, ADR-0005; the stream replays nothing from before the restart), so a stream or event call does not 404 for a match that exists in the store; an unknown match is still a 404.

## 3. Server-Sent Events

`GET /v1/matches/{match_id}/stream` sends:

| `event:` | `data:` | `id:` |
| --- | --- | --- |
| `state` | score, clock, possession, revision | `state:<revision>` |
| `claim` | claim packet | `claim:<claim_id>` |
| `line` | line with status | `line:<line_id>:<status>` |
| `publication` | publication with the variant for `lang` (+ English) | `pub:<publication_id>` |
| `audit` | audit record, with `details.why` (the Producer's free text, not yet verified) left out; the stored record keeps it | `audit:<sequence>` |
| `recap_ready` | personas available | `recap` |
| `onair` | the `onair` record of a derived feed line that aired (AB#498 contract, AB#499 wiring; `docs/contracts.md`, "Derived feed lines"). Feed records reach every stream, as line records do; the desk reads them by `feed` key | `onair:<publication_id>` |
| `feed_drop` | the `feed_drop` record of a derived line that did not air. The text stays in the audit chain (the `line_abstained` record it points to), except for a line Content Safety refused (`unsafe_content`), whose text is never written to the audit. Its `publication_id` is `pub-<line_id>` even though nothing published, so a join on it finds no publication | `drop:<line_id>` |
| `crew_ledger` | `crew_ledger` (contract 1.3.0): one moment the crew took, sent once its run has ended; `called`, `skipped`, `why`, `routed_by`, `spawn_reason`. Live only, not replayed on reconnect | `ledger:<moment_id>` |
| `crew_spawn` | `crew_spawn` (contract 1.3.0): one specialist on one moment, on start (`running`) and on end (`done`, `no_data`, `failed` or `budget_exhausted`). Live only | `spawn:<moment_id>:<name>:<status>` |
| `status` | `{status, reason?}`: `live`, `rules_fallback` (with `reason` from the `fallback_reason` list in 04-agents.md §4) or `warming_up`. Sent only when the status or reason changes; every refusal is still audited as `fallback_used` | none |
| `heartbeat` | server time | none, every 15 s |

`persona` is `casual`, `analyst`, `broadcast` (aliases `fan`, `producer`) `booth` (both commentary voices, publications with persona `booth:pbp` then `booth:colour` for each moment, play-by-play first), or a watch mode: `club:<id or name>`, `player:<id or name>`, `metric:<name>` (server forms `my-club:`, `player-focus:`, `one-metric:`). A watch mode must name a real club, player or metric of the match; opening the stream registers it for the match from the next moment on (no back-fill), at most 8 extra modes per match, kept until the match ends.

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
| `publish_failed` | 503 | Event Hubs mode only: the publish failed and nothing was accepted; retry the same batch |
| `not_ready` | 503 | Dependency not ready; see `/ready` |

## 7. Rate limits

| Route | Limit | Key |
| --- | --- | --- |
| `/events` | 20 batches a second (**Planned**, not enforced yet) | stream key |
| `POST /matches` | live for the first 10 created an hour from one address and 100 an hour in all, later ones run on the rules (the page works as before, labelled "Rules fallback"); 2,000 an hour in all is a memory guard, then 429 and the page falls back to its local simulation | client address; one api process |
| `/ask` | 20 a minute | `browser_session_id` (or IP) |
| `/talk`, and each turn of the call socket | 20 a minute, a budget of its own | `browser_session_id` (or IP) |
| `/ask` and `/talk` together, call turns included | 60 a minute and 100 an hour, whatever session ids are sent | client address |
| model calls | match agents 3,000 a UTC day (`MATCHCAST_MODEL_CALLS_PER_DAY`), Ask and Talk answers 1,000 (`MATCHCAST_ANSWER_CALLS_PER_DAY`), so a question loop cannot turn the commentary to rules; `MATCHCAST_MODEL_OFF=true` stops them all | one api process; a refused call falls back to the rules twin (ADR-0014) and is audited as `fallback_used` |
| `/ds/ask` | 5 a minute | client address |
| `/vision/identify` | 15 a minute and 3,000 in total (`VISION_MAX_CALLS`) | one api process (a cost cap, shared by all callers) |
| `/speech/token` | 10 a minute | IP |

Limits are kept in memory in the single `api` replica (ADR-0005). The model limits are the cost guard (`services/api/app/budget.py`): a viewer needs no sign-in, so a loop of new matches or questions must not be able to spend the Azure budget. Past them the app keeps publishing from the rules agents and only model spend stops. The kill switch takes effect with `az containerapp update -g rg-matchcast -n ca-api-matchcast-dev --set-env-vars MATCHCAST_MODEL_OFF=true` (a new revision; the next provision clears it). When `CORS_ORIGINS` (a comma list of origins) is set the api answers those origins and exposes `Retry-After`, so a cross-origin browser can read it on a 429; with it unset no CORS headers are sent.

## Seeded bad claim (demo cue)

`POST /v1/matches` accepts `seed_bad_claim` (boolean) and `seed_bad_claim_at_ms` (match time, default 720000, minute 12). The header `X-MatchCast-Seed-Bad-Claim: 1` has the same effect as `seed_bad_claim: true`. From that match time the Analyst corrupts one claim number, the Verifier rejects the line, and the repair path runs once (04-agents.md §3).

## Failure drill (demo cue)

`POST /v1/matches/{match_id}/drill` with `{"session_id": …, "model_cut": true|false}` cuts or restores that one match's model calls (`ModelCut` in `matchcast_agents/live/client.py`, wrapped round the match's budgeted model client). While cut, every model call for the match (the four agents, and the Ask and Talk answers) fails at once, so each step runs its rules twin and is audited as `fallback_used`: reason `model_error` for an agent's first three refusals in a minute, then `circuit_open` once its breaker has opened (ADR-0014); the stream's `status` event reads `rules_fallback` and the shell pill "Rules fallback". The answer is `{"model_cut", "mode"}`; a rules-mode match answers `mode: rules` and the cut changes nothing. The cut is stored with the match, so a rebuilt match keeps it. After a restore each agent's breaker still holds it on the rules twin for up to 30 s and then needs one successful probe call, and the pill reads "Live agents" again only when all four agents are live, so allow up to 30 s plus one model moment. The Agents tab's "Cut the model" button sends it. Other matches on the same api are not affected, unlike `MATCHCAST_MODEL_OFF`.
