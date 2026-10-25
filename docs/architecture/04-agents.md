# 04 Multi-agent design

Status: **Agreed design**. Last reviewed 22 Oct 2026. Backlog: AGT-3 to AGT-15, EXP-5, EXP-16. Earlier design notes: `/mnt/project-files/matchcast-v2/orchestration/DESIGN.md` (superseded by this file where they differ).

## 1. Principles

1. **Four core agents, each with one job.** Producer decides, Analyst measures, Narrator writes, Verifier checks. No agent does another's job.
2. **Shared state, not chat.** Agents hand off typed packets (contracts v1.1) through the workflow and the `claims` table. No agent reads another agent's prompt or free text.
3. **Numbers come from tools.** A model may state a number only if a tool returned it in the same turn and the claim cites that tool call.
4. **Nothing reaches a screen unverified.** Only `published` publications are sent over SSE.
5. **Every step degrades.** Each agent has a deterministic rules implementation with the same interface.
6. **Everything is audited.** Each step appends a hash-chained `AuditRecord`.

## 2. Agents

| Agent | Job | Input | Output | Tools | Model settings | Fallback (rules) | Prompt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Producer | Picks the moment, sets priority, routes to personas, skips quiet play | Last 30 s of events, state, `moment_score`, active personas | `ProducerTask` or `Skip{reason}` | none. The model Producer (`live/producer.py`, prompt `producer.md` v0.3.0) chooses among the rules' candidates: it narrows the personas to those the candidate allows, asks the Stats Desk for a moment that is not priority 1, or skips a storyline it just aired. Goals and red cards never reach the model. Any model failure falls back to the rules decision and is audited. The Stats Desk call is made by the workflow after verification, not by the Producer | default temperature, answer budget 400 + 1500 reasoning headroom | Threshold rule: score ≥ 60 or priority kind | `packages/agents/prompts/producer.md` |
| Analyst | Turns events into 1 to 3 claims with evidence | `ProducerTask` | `ClaimPacket[]` (status pending) | `get_metrics` today (all numbers and xG). The MCP server also serves `get_state`, `get_events`, `get_evidence`, `query_season` and `search_kb`, which the Analyst does not call yet; `predict_danger` is served by the MCP server but no agent calls it yet | default temperature, answer budget 400 + 1500 reasoning headroom | Metric templates per event kind | `prompts/analyst.md` |
| Narrator | Writes one line per persona and language-neutral English | Claims + personas | `DraftLine[]` | none | default temperature, answer budget 400 + 1500 reasoning headroom | Templated lines per persona. Goals, shots on target and cards add a consequence clause (opens the scoring, a player short, pressure on the defence); the clause carries no number the Verifier would have to tie to a claim | `prompts/narrator.md` |
| Verifier | Checks every number, name, source, freshness, meaning and safety | Claims + lines + state | `Verdict` per line | recounts every number from the stored events in process (`verify/checks.py`), never through a tool the Analyst could have influenced; each claim backs one number in the line, so a score with one side repeated is refused; in goal, card, shot, tackle and foul lines a player named in full must be one the event names (scorer, assist, ...); an event that names no player allows its team's players. A swapped-in player, from either club, is refused. Not caught: a surname alone. Refused although legitimate: a teammate or opponent the event does not name (a keeper, an assister the claims do not carry), which goes to one repair and then abstains. Summaries, period ends, recaps and Ask answers are exempt; Content Safety | default temperature, answer budget 400 + 1500 reasoning headroom (model step only) | Deterministic checks alone; `review` instead of model meaning check | `prompts/verifier.md` |

On-demand agents (never on the live loop):

| Agent | Where | Job | Tools | Verified by |
| --- | --- | --- | --- | --- |
| Data Scientist | Analyst view, `POST /v1/ds/ask` | Answers season questions with SQL, a table and a chart | `query_season`, `describe_views` (in process, and as MCP tools on the `mcp` container) | Verifier re-runs the SQL and compares every cell |
| Stats Desk (A2A partner) | `mcp` container, path `/a2a`, Agent Card at `/.well-known/agent-card.json` | `compare_to_season(metric, scope, value, team_id?)`: value, season average, rank among the season's team or player match performances (`of` counts those rows, 56 for teams, not matches). The api calls the skill over A2A when `STATS_DESK_URL` is set (`https://<mcp host>/a2a`) and audits `transport: a2a`; without it, or with a malformed value, it calls the same skill in process and audits `transport: in_process`. `/v1/status` shows `stats_desk` live only with the URL | DuckDB over `season/v1` | Deterministic, no model. Called for priority 1 moments only, after a line is verified, for a claim behind a verified line, within a 2 s budget; failures are audited as `a2a_failed`; a club with no season rows is compared with every season team and the `a2a_call` says so (`compared_with`, `requested_team_id`). The match's club *name* is resolved to the season's club code through the generated profiles in `kb/clubs` (`season_clubs.py`); a name the season does not know (a test fixture's `home`) is compared league-wide |
| Player persona (talk) | `POST /v1/matches/{id}/talk` | First-person reply ≤ 60 words using only that player's own counts (or the producer's score and key moment), his squad and team sheet and kb passages in words (ADR-0020), and the whole match log by relevance, with minutes only from the log (ADR-0021); the model writes the player's reply and names the instruction it heard in live mode (`packages/agents/prompts/player.md`), the rules template is the fallback (ADR-0018). An instruction becomes an order only if the role guard allows it for his position (ADR-0016). He may talk about the last 8 match events, every goal and card, and each club's totals. Every count must be his own or a club total from the log, with the club named in the reply; a name outside those events fails the check | counts recounted from the event log | Reply checked before it is returned: each number must equal the log's count for the metric it names, names in the roster; otherwise "I can't confirm that from the match data yet." |
| Recap mode | `POST /internal/v1/recaps` | Full-time recap per persona | Same as the core four | Verifier per sentence; a failing sentence is dropped |
| Ask pipeline | `POST /v1/matches/{id}/ask` | Chatbot answers | Model answer from a fact sheet in live mode (`packages/agents/prompts/ask.md`); router + AI Search + core tools otherwise | Verifier, see [05-assistant-rag.md](05-assistant-rag.md) |
| Broadcast Copilot | `POST /v1/matches/{id}/ask` with `surface: "broadcast"` | Highlights, camera focus and a production plan for the Broadcast view | Ranking in code over events and state (`matchcast_agents/broadcast.py`); no model call yet | Rules; every pick cites its event. See [ADR-0019](adr/0019-broadcast-copilot-reuses-ask.md) |

## 3. Workflow graph (Microsoft Agent Framework)

Exported image: [img/2-agent-workflow.png](img/2-agent-workflow.png) (regenerate with `scripts/export_diagrams.sh`).

```mermaid
flowchart LR
  ev([state revision]) --> P[Producer executor]
  P -- Skip --> X([audit skip, end])
  P -- ProducerTask --> AN[Analyst executor]
  AN -- claims --> N[Narrator executor]
  N -- lines --> V[Verifier executor]
  V -- verified --> G{approval mode}
  V -- review --> Q[(Producer queue)]
  V -- rejected, first time --> RP[Repair router]
  RP -- number or source --> AN
  RP -- wording --> N
  V -- rejected, second time, checkable fact --> Q
  V -- rejected, second time, other --> AB([abstain, audit])
  G -- auto --> PUB[Publisher executor]
  G -- producer --> Q
  Q -- approve --> PUB
  PUB --> TR[Translate + voice]
  TR --> SSE([SSE publication])
```

- Built with Agent Framework `WorkflowBuilder` (`packages/agents/matchcast_agents/af_graph.py`, package `agent-framework-core`): executors Producer, Analyst, Narrator, Verifier and Stats Desk, edges carrying small dataclasses, the Stats Desk edge conditional on priority 1. The repair router and the approval step run inside the Verifier executor, where the one-repair rule lives. A line that fails its one repair on a checkable fact (number, unknown player, unknown source, stale state) is escalated: it waits in the producer queue with `escalated: true` for a person to kill it (the desks offer no approve or edit, since the Verifier could not check the line), and a `handoff verifier to repair` span traces the repair. Every other failure still abstains. An escalated line can only be killed: approve and edit are refused in the workflow, so the api and the web app both enforce the hold, and a second Verifier pass cannot approve it. It is the default (`MATCHCAST_ORCHESTRATOR=af`); `native` runs the same steps as plain calls, and a test checks the two give identical claims, lines and audit records (actor, action, subject and details). A new workflow is built per event because Agent Framework refuses concurrent runs on one instance. Checkpointing is our own Table store (AGT-13), not the framework's. The publisher and translate steps are not executors yet.
- Checkpointing: once per event (after the graph run, not after every executor) the processed sequence, the match state and the Producer's memory are saved as one checkpoint row per stream (`put_checkpoint`; Table `checkpoints`, PartitionKey the stream key), and a restart resumes from it, see AGT-13.
- Rundown ledger (`MatchWorkflow._record_rundown`, AB#375): every moment the crew takes gets one entry in `rundown` (moment, the agents called, the agents skipped, why, and who routed it: `rules` or `model`). It is checkpointed with the match, so a restart keeps it. The routing itself is still the Producer's: a separate Showrunner model call that picks specialists is not built yet, because the Producer already makes the Stats Desk decision. Each specialist that the moment calls is listed by name. No new audit action or stream event is added, since both are closed contracts.
- Shared match memory (`packages/agents/matchcast_agents/memory.py`): before the Producer and Narrator run, the context carries the storylines of verified lines (`extra["storylines"]`), and the Narrator's facts carry `already_said_about_this_play`: the latest two lines that passed a check or a person (verified, approved or published) about the same player or club. Lines still drafted, verifying, repairing, abstained, rejected, in review or killed are never remembered. Only the wording goes to the models, with every number replaced by `#`, so no number can be copied from memory; the Narrator must not repeat the wording (prompt rule 14, `narrator.md` v0.3.1). The Producer sees the same memory (`producer.md` v0.3.0).
- Storylines and stall replan (CREW-3.2 and CREW-1.2, `matchcast_agents/storyline.py`): a storyline opened early (a shot that goes wide) waits for its payoff, a goal by the same player. The payoff airs once and cites both events; a storyline never paid off closes at full time with a summary. When no verified line airs for 60 s of wall time, the Showrunner replans: it picks the player with the most remembered beats, assigns one analyst, and records the old and new plan. If a replan aired nothing and the next stall comes, it falls back to the rules twin's storyline instead of looping. **Planned**: the workflow wiring (the Narrator's payoff line, the replan entry in the rundown, the stall check on each event). The stall is measured on events, so a feed with no events at all does not replan until the booth's filler runs.
- Concurrency: today events of one match are processed one at a time under a lock, so there is one run per moment and no pre-emption; overlapping runs (at most 2 per match, priority 1 first) are **Planned**.
- Rate rule: at most one Producer task per 8 s of match time, except priority 1 (goal, red card, penalty, own goal).
- Live-run fixes after the first deployed match (40 of 58 lines rejected): the names check ignores a possessive ("Harbour United's", "Ellis'") and a capitalised sentence opener before a roster name; the live Verifier is also given the stored `moment` (play, player, club) and may accept a stock "why it matters" clause (prompt 0.1.2); the Narrator no longer receives the character limits as numbers (it echoed them into lines); `line_drafted` audit records carry the moment reason.
- Pre-match history metrics (national-team fixtures): `h2h_played`, `h2h_home_wins`, `h2h_draws`, `h2h_away_wins` and `elo` (rounded rating) are `count` claims over the whole stream, read by the tools and recounted by the Verifier from `MatchContext.extra["history"]` (`history_metrics.py`), not from events. They are offered to the Analyst only when the match carries that history; form strings are not claims. The contract is unchanged.
- Commentary booth: two more personas, `booth:pbp` (play-by-play, calls the action) and `booth:colour` (colour analyst, reacts to the call: shape, tactics, what it means). They are ordinary personas (no contract change, limits of `broadcast`, two numbers), written in the same Narrator call so the exchange hangs together, checked by the same Verifier, and the colour line is checked and aired after the call it answers. A viewer asks for both with `GET /v1/matches/{id}/stream?persona=booth`; a `colour` moment also carries the booth voices. `buildup` (kick-off) and `filler` (quiet spell) moment kinds have claims and rules lines ready (goals/shots of both sides); the Producer emitting them is the orchestration lane's and is **Planned** until it lands, so kick-off and quiet-spell booth talk do not fire yet. Only the booth line of a call that aired is checked and aired: if the play-by-play is turned away, the colour line is not shown. A booth registers both voices or neither (the 8 extra-mode cap). A colour line must name a player or a club, or carry a number from a claim: a reaction that fits any match ("the balance of the game is getting clearer") is refused by the Verifier's `specific` check (reason `unsupported_statement`), and the Narrator prompt (0.2.3) asks for the ball carrier's name, energy that follows the danger and varied openings. `eval/agents_eval.py` reports the share of generic colour drafts and how many are worded differently. In producer approval mode the booth voices are approved by the agent as soon as the Verifier passes them (held booth talk is dead air); `hold_booth: true` on match creation holds them too. A stream with a persona gets only that persona's publications; line records (the producer approval queue) stay on every stream. In rules mode the call is the broadcast line and the reading is a stock sentence with no number.
- Colour line (live agents only): a quiet play (off-target shot, tackle, foul) becomes a `colour` moment, priority 3, analyst persona only, at most once per 45 s of wall time per match (`COLOUR_EVERY_S`, env `MATCHCAST_COLOUR_EVERY_S`, 0 = off; only with the analyst persona, a won tackle, and never mixed with watch-mode personas; a model pass costs a fraction of a cent so a match stays well under a dollar). It goes to the model even when the quiet gate would skip it, counts shots/xG, tackles won or fouls of the play's team, passes the same Verifier checks, and falls back to a rules line (`NarratorRules`) if the model fails. The rate rule above still applies, and a rate-limited play does not spend the budget. The rules-only workflow never emits it.
- Booth moments (only when a viewer has the two booth voices): `buildup` at the first event of the match, and `filler` after 20 s of wall time with nothing aired. Both are priority 3, personas `booth:pbp` and `booth:colour` only, never merged with watch modes, and not sent to the Producer model for a skip. The live Analyst and Narrator voice them (no rules-only quiet gate), so the booth is written, not templated.
- Model gate: moments at priority 1 or 2 (goal, red or yellow card, shot on target, half time, full time) go to the model; quieter moments use the rules twin. `MATCHCAST_LIVE_MAX_PRIORITY` overrides the gate (1 to 3); the default is 2.

## 4. Packet shapes

The wire contracts are in `packages/contracts` ([docs/contracts.md](../contracts.md)). Internal workflow packets live in `packages/agents/matchcast_agents/messages.py`:

```text
ProducerTask   moment_id, match_id, event_ids[], up_to_sequence, priority 1|2|3,
               personas[], deadline_ms, reason
Skip           moment_id, reason (quiet_play | rate_limited | duplicate_moment | low_score | model_skip), why (model_skip only)
DraftLine      line_id, claim_ids[], persona, text, max_chars
Verdict        line_id, verdict verified|review|rejected, reason_code, checks[] (name, passed, detail)
RepairRequest  line_id, target analyst|narrator, verdict, attempt 1
```

`reason_code` values: `number_mismatch`, `unknown_player`, `unknown_source`, `stale_state`, `unsupported_statement`, `unsafe_content`, `length_exceeded`, `citation_missing`.

`fallback_reason` values (written with audit action `fallback_used`, ADR-0014): `timeout` (20 s), `rate_limited` (429 after one retry), `model_error` (5xx or invalid structured output), `circuit_open`, `tool_error` (a tool call failed, in process or over MCP: the Analyst makes no claim for that moment, so no line is written and no number is guessed).

Audit `action` values (closed list; add new ones here first): `event_rejected`, `moment_skipped`, `claim_created`, `line_drafted`, `line_verified`, `line_review`, `line_rejected`, `line_repair_requested`, `line_abstained`, `line_approved`, `line_edited`, `line_killed`, `publication_created`, `translation_rejected`, `fallback_used`, `recap_created`, `ask_answered`, `talk_answered`, `export_created`, `safety_blocked`, `a2a_call`, `a2a_failed`, `ds_answered`, `ds_unverified`.

## 5. Verifier checks (in order)

| # | Check | Rule | Tolerance |
| --- | --- | --- | --- |
| 1 | Sources exist | Every `source_event_id` exists in `events` at the cited revision | exact |
| 2 | Freshness | Claim snapshot revision ≥ current revision − 5 and match time within 30 s | as stated |
| 3 | Numbers | Every number in the line appears in a claim, and each claim value is recomputed with `get_metrics` | counts 0; ratios 0.01; km/h 0.5; metres 0.5 |
| 4 | Names | Every player or club name is in the roster for this match | exact, case-insensitive |
| 5 | Persona rules | Length limit and number limit per persona: casual 140 chars, 1 number; analyst 280 chars, 6 numbers; broadcast 180 chars, 2 numbers; the watch modes `my-club:<team>`, `player-focus:<player>` and `one-metric:<metric>` use casual, casual and analyst character limits and 1, 1 and 2 numbers | exact |
| 6 | Citations (Ask only) | Every sentence carries `[kb:…]` or `[claim:…]` | exact |
| 7 | Safety | Content Safety text:analyze, all categories severity < 2. The api calls Azure when `CONTENT_SAFETY_ENDPOINT` is a `*.cognitiveservices.azure.com` host (Entra token, `safety_from_env`); a failed call falls back to the local screen (a short word list, **Simulated** strength), is counted, is audited as `fallback_used`, and the result source says `local`; three failures in a row skip Azure for 60 s. `/v1/status` goes unavailable while the circuit is open or when 5 of the last 10 line screens in the last 2 minutes used the local list, and reads live again by itself once those age out or Azure answers; Prompt Shields calls are not counted. Without the variable only the local screen runs (**Simulated**) | as stated |
| 8 | Meaning (model) | Does the line say only what the claims support? Returns supported, unclear or unsupported | unclear gives `review` |

Checks 1 to 7 are deterministic and run first. Check 8 runs only if 1 to 7 pass. In rules mode check 8 is skipped and the verdict is `verified` only if the line came from a template; otherwise `review`.

## 6. Tools (MCP server)

All tools are served by `services/mcp` over Streamable HTTP; until a shared store exists (DAT-2) the api mounts the same app at `/mcp` (ADR-0005). Every match tool takes `session_id` and `up_to_sequence` as well as `match_id` (`describe_views`, `query_season` and `search_kb` are not match-scoped), so an agent can never read the future. Each result is at most 20 KB.

| Tool | Parameters | Returns | Source |
| --- | --- | --- | --- |
| `get_state` | match_id, up_to_sequence | score, clock, possession, revision, last 10 event ids (players on pitch and cards are **Planned**) | the store's match state |
| `get_events` | match_id, from_seq, to_seq, kinds[] (max 200) | contract events | Table `events` |
| `get_metrics` | match_id, up_to_sequence, names[] as `<metric>:<team_id>` (`window_s`, `player_id` are **Planned**) | values with units and `derivation_version` | counts from the match state, xG from `xg.py` |
| `get_evidence` | claim_id (plus `session_id`, `up_to_sequence`) | source events, tool calls, formula inputs | Tables `claims`, `events` |
| `get_replay_clip` | event_id (plus `session_id`, `up_to_sequence`) | event window ±5 s for the explain replay | Table `events` |
| `predict_danger` | event_id (plus `session_id`, `up_to_sequence`) | `score` (a ranking score for a same-team shot within 10 s, not a probability), model version and AUC, `unset_inputs`, limits | ONNX `data/models/danger/v1` (override with `MATCHCAST_DANGER_MODEL`); contract events lack xg, phase and kind, so those inputs are unset and the card shows held-out AUC 0.884 with overconfident top scores. Needs onnxruntime; an image without it refuses the call. The mcp image has no Dockerfile yet (**Planned**) |
| `predict_danger` | match_id, event_id | probability of a shot within 10 s, model version | **Planned** (needs the danger model, ONNX from Blob `models/danger/`) |
| `query_season` | sql (SELECT only), limit ≤ 1,000 | rows, columns, sql_hash, elapsed_ms | DuckDB over Blob `season/v1/*.parquet` |
| `describe_views` | none | allowed views and columns | DuckDB catalogue |
| `search_kb` | query, corpus?, top ≤ 8 | chunks with ids and scores | AI Search `kb-matchcast-v1` ranks in the process that has `SEARCH_ENDPOINT` and `SEARCH_QUERY_KEY` (today the api, which mounts `/mcp`; the standalone mcp container is not given them, so it reports `local`) and the index is loaded (keyword only; embeddings **Planned**); BM25 over `kb/` otherwise or on a failed call. The result's `retrieval` says which (`local`, `search`, `search_fallback`) |

Copilot Agent Mode uses the same server through the external route (Easy Auth), configured in `.vscode/mcp.json` (AGT-10, PLT-11).

## 7. Model access

- Endpoint `FOUNDRY_PROJECT_ENDPOINT`, deployment `FOUNDRY_MODEL_DEPLOYMENT=gpt-6-luna`, embeddings `FOUNDRY_EMBEDDING_DEPLOYMENT=text-embedding-3-small`. Auth with `id-matchcast` (role Azure AI User). No API key.
- Output format: JSON Schema structured output generated from the packet models. If the deployment rejects structured output, use JSON mode and validate; invalid JSON counts as a failure.
- Budgets per call: 20 s timeout; 1 retry on 429 honouring `Retry-After`; circuit breaker opens after 3 failures in 60 s, half-opens after 30 s.
- Every call logs `gen_ai.usage.input_tokens` and `output_tokens` (see [15-observability.md](15-observability.md)).

## 8. Prompts

Each prompt file has these sections, in this order: `# Role`, `# Inputs`, `# Rules` (numbered, testable), `# Output schema`, `# Examples` (2 good, 1 bad with the reason). The first line is `version: <semver>`. Claims carry the metric formula's `derivation_version` (the contract pattern is `x.y.z`, so `<agent>@<version>` does not fit); recording the prompt version in the audit trail is **Planned**. A prompt change that alters output needs a minor version bump and a re-run of `eval/compare.py`. Prompt files today: `producer.md`, `analyst.md`, `narrator.md`, `verifier.md` (the live Producer, Analyst, Narrator and Verifier load theirs); `router.md`, `ds.md` and `player.md` are **Planned**.

## 9. Package layout

```text
packages/agents/
  matchcast_agents/
    workflow.py        MatchWorkflow: ingest, steps, repair, approval, talk, recap, checkpoint
    af_graph.py        the Agent Framework WorkflowBuilder graph over those steps
    rules/             deterministic Producer, Analyst, Narrator and Verifier
    live/              Foundry model client and the model-backed Analyst, Narrator, Verifier
    resilience.py      timeouts, one retry on 429, circuit breaker, rules fallback
    (live pacing: model only for priority-1 moments by default, lines of a moment verified together, one shared redraft per target; docs/infra.md)
    verify/            deterministic checks 1-7 (check 8, meaning, is the live Verifier's model step)
    tools/             in-process tools and the MCP client path for the Analyst
    ask/               chunking, BM25 retrieval, router rules and answer assembly
    roles/             player and producer chat replies for /talk
    data_scientist.py  season questions, SQL re-run check
    statsdesk.py       A2A client for the Stats Desk
    personas.py        persona and watch-mode names
    safety.py          Content Safety and Prompt Shields clients, local screens
    store.py tables.py repositories: in-memory and Table Storage
    messages.py        workflow packets
    context.py state.py  per-event context and the match state the agents read
    xg.py metrics_spec.py  the xG model and the metric definitions with units
    recap.py hub.py    full-time recap and the stream hub for SSE
  prompts/             producer.md analyst.md narrator.md verifier.md
  tests/               unit tests, fixtures/match-short.json
```

## 10. How this proves multi-agent value (judging)

| Judges look for | Where we show it |
| --- | --- |
| Distinct roles | Trace panel shows four agents with their own tools and outputs (EXP-6) |
| Shared state and handoffs | Claims ledger: one claim, its Analyst evidence, Narrator lines, Verifier verdict (EXP-10) |
| Failure recovery | Seeded bad claim repaired on cue (`?seedBadClaim=1`); rules fallback chip; kill-and-resume clip (QUA-5) |
| Better than one agent | QUA-4: same 30 moments, one agent vs four, verified-claim rate and hallucinations per 100 lines, real numbers in the README |
| Interoperability | MCP for tools and Copilot; A2A Stats Desk with an Agent Card |
