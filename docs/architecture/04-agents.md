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
| Producer | Picks the moment, sets priority, routes to personas, skips quiet play | Last 30 s of events, state, `moment_score`, active personas | `ProducerTask` or `Skip{reason}` | `get_state`, `get_metrics(moment_score)`, A2A `compare_to_season` (priority 1 only) | temperature 0.1, max 300 output tokens | Threshold rule: score ≥ 60 or priority kind | `packages/agents/prompts/producer.md` |
| Analyst | Turns events into 1 to 3 claims with evidence | `ProducerTask` | `ClaimPacket[]` (status pending) | `get_state`, `get_events`, `get_metrics`, `get_evidence`, `predict_danger`, `query_season` | temperature 0.1, max 600 | Metric templates per event kind | `prompts/analyst.md` |
| Narrator | Writes one line per persona and language-neutral English | Claims + personas | `DraftLine[]` | none | temperature 0.6, max 400 | Templated lines per persona | `prompts/narrator.md` |
| Verifier | Checks every number, name, source, freshness, meaning and safety | Claims + lines + state | `Verdict` per line | `get_state`, `get_events`, `get_metrics` (recompute), Content Safety | temperature 0, max 300 (model step only) | Deterministic checks alone; `review` instead of model meaning check | `prompts/verifier.md` |

On-demand agents (never on the live loop):

| Agent | Where | Job | Tools | Verified by |
| --- | --- | --- | --- | --- |
| Data Scientist | Analyst view, `POST /v1/ds/ask` | Answers season questions with SQL, a table and a chart | `query_season`, `describe_views` | Verifier re-runs the SQL |
| Stats Desk (A2A partner) | `mcp` container, path `/a2a`, Agent Card at `/.well-known/agent-card.json` | `compare_to_season(metric, team or player)`: value, season average, rank of 28 | DuckDB over `season/v1` | Deterministic, no model |
| Player persona (talk) | `POST /v1/matches/{id}/talk` | In-character reply ≤ 60 words using only that player's stats | `get_metrics(player_id)` | Verifier |
| Recap mode | `POST /internal/v1/recaps` | Full-time recap per persona | Same as the core four | Verifier per sentence; a failing sentence is dropped |
| Ask pipeline | `POST /v1/matches/{id}/ask` | Chatbot answers | Router + AI Search + core tools | Verifier, see [05-assistant-rag.md](05-assistant-rag.md) |

## 3. Workflow graph (Microsoft Agent Framework)

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
  V -- rejected, second time --> AB([abstain, audit])
  G -- auto --> PUB[Publisher executor]
  G -- producer --> Q
  Q -- approve --> PUB
  PUB --> TR[Translate + voice]
  TR --> SSE([SSE publication])
```

- Built with Agent Framework `WorkflowBuilder`: one executor per box. Edges carry Pydantic models generated from the contracts.
- Checkpointing: after every executor, state is saved to Table `checkpoints` (PartitionKey `match_id`, RowKey `<moment_id>:<executor>`), see AGT-13.
- Concurrency: one workflow run per moment; at most 2 runs per match at once; priority 1 moments pre-empt by starting immediately (the older run continues).
- Rate rule: at most one Producer task per 8 s of match time, except priority 1 (goal, red card, penalty, own goal).

## 4. Packet shapes

The wire contracts are in `packages/contracts` ([docs/contracts.md](../contracts.md)). Internal workflow packets live in `packages/agents/matchcast_agents/messages.py`:

```text
ProducerTask   moment_id, match_id, event_ids[], up_to_sequence, priority 1|2|3,
               personas[], deadline_ms, reason
Skip           moment_id, reason (quiet_play | rate_limited | duplicate_moment | low_score)
DraftLine      line_id, claim_ids[], persona, text, max_chars
Verdict        line_id, verdict verified|review|rejected, reason_code, checks[] (name, passed, detail)
RepairRequest  line_id, target analyst|narrator, verdict, attempt 1
```

`reason_code` values: `number_mismatch`, `unknown_player`, `unknown_source`, `stale_state`, `unsupported_statement`, `unsafe_content`, `length_exceeded`, `citation_missing`.

`fallback_reason` values (written with audit action `fallback_used`, ADR-0014): `timeout` (20 s), `rate_limited` (429 after one retry), `model_error` (5xx or invalid structured output), `circuit_open`, `tool_error` (an MCP tool call failed; the Analyst uses the in-process tool twin).

Audit `action` values (closed list; add new ones here first): `event_rejected`, `moment_skipped`, `claim_created`, `line_drafted`, `line_verified`, `line_review`, `line_rejected`, `line_repair_requested`, `line_abstained`, `line_approved`, `line_edited`, `line_killed`, `publication_created`, `translation_rejected`, `fallback_used`, `recap_created`, `ask_answered`, `talk_answered`, `export_created`, `safety_blocked`.

## 5. Verifier checks (in order)

| # | Check | Rule | Tolerance |
| --- | --- | --- | --- |
| 1 | Sources exist | Every `source_event_id` exists in `events` at the cited revision | exact |
| 2 | Freshness | Claim snapshot revision ≥ current revision − 5 and match time within 30 s | as stated |
| 3 | Numbers | Every number in the line appears in a claim, and each claim value is recomputed with `get_metrics` | counts 0; ratios 0.01; km/h 0.5; metres 0.5 |
| 4 | Names | Every player or club name is in the roster for this match | exact, case-insensitive |
| 5 | Persona rules | Length limit and number limit per persona (casual ≤ 1 number) | exact |
| 6 | Citations (Ask only) | Every sentence carries `[kb:…]` or `[claim:…]` | exact |
| 7 | Safety | Content Safety text:analyze, all categories severity < 2 | as stated |
| 8 | Meaning (model) | Does the line say only what the claims support? Returns supported, unclear or unsupported | unclear gives `review` |

Checks 1 to 7 are deterministic and run first. Check 8 runs only if 1 to 7 pass. In rules mode check 8 is skipped and the verdict is `verified` only if the line came from a template; otherwise `review`.

## 6. Tools (MCP server)

All tools are served by `services/mcp` over Streamable HTTP. Every call carries `match_id` and `up_to_sequence`, so an agent can never read the future. Each result is at most 20 KB.

| Tool | Parameters | Returns | Source |
| --- | --- | --- | --- |
| `get_state` | match_id, up_to_sequence | score, clock, possession, players on pitch, cards, last 10 events | Table `matchstate` |
| `get_events` | match_id, from_seq, to_seq, kinds[] (max 200) | contract events | Table `events` |
| `get_metrics` | match_id, names[], window_s, team_id?, player_id? | values with units and `derivation_version` | `packages/metrics` on `events` |
| `get_evidence` | claim_id | source events, tool calls, formula inputs | Tables `claims`, `events` |
| `get_replay_clip` | event_id | event window ±5 s for the explain replay | Table `events` |
| `predict_danger` | match_id, event_id | probability of a shot within 10 s, model version | ONNX from Blob `models/danger/` |
| `query_season` | sql (SELECT only), limit ≤ 1,000 | rows, columns, sql_hash, elapsed_ms | DuckDB over Blob `season/v1/*.parquet` |
| `describe_views` | none | allowed views and columns | DuckDB catalogue |
| `search_kb` | query, corpus?, top ≤ 8 | chunks with ids and scores | AI Search `kb-matchcast-v1` |

Copilot Agent Mode uses the same server through the external route (Easy Auth), configured in `.vscode/mcp.json` (AGT-10, PLT-11).

## 7. Model access

- Endpoint `FOUNDRY_PROJECT_ENDPOINT`, deployment `FOUNDRY_MODEL_DEPLOYMENT=gpt-6-luna`, embeddings `FOUNDRY_EMBEDDING_DEPLOYMENT=text-embedding-3-small`. Auth with `id-matchcast` (role Azure AI User). No API key.
- Output format: JSON Schema structured output generated from the packet models. If the deployment rejects structured output, use JSON mode and validate; invalid JSON counts as a failure.
- Budgets per call: 20 s timeout; 1 retry on 429 honouring `Retry-After`; circuit breaker opens after 3 failures in 60 s, half-opens after 30 s.
- Every call logs `gen_ai.usage.input_tokens` and `output_tokens` (see [15-observability.md](15-observability.md)).

## 8. Prompts

Each prompt file has these sections, in this order: `# Role`, `# Inputs`, `# Rules` (numbered, testable), `# Output schema`, `# Examples` (2 good, 1 bad with the reason). The first line is `version: <semver>`. The version goes into `derivation_version` as `<agent>@<version>`, for example `narrator@1.2.0`. A prompt change that alters output needs a minor version bump and a re-run of `eval/compare.py`.

## 9. Package layout

```text
packages/agents/
  matchcast_agents/
    workflow.py        WorkflowBuilder graph, edges, checkpoint store
    executors/         producer.py analyst.py narrator.py verifier.py publisher.py repair.py
    rules/             deterministic twins of each executor (ported from apps/unified/agents.js)
    tools/             MCP client wrapper, in-process fallback for tests
    verify/            deterministic checks 1-7, number and name extraction (check 8 lives in executors/verifier.py)
    ask/               router, retrieval, answer assembly
    store.py           claims, publications, audit repositories (Table + in-memory)
    messages.py        workflow packets
  prompts/             producer.md analyst.md narrator.md verifier.md router.md ds.md player.md
  tests/               unit tests per executor, fixtures/match-short.json
```

## 10. How this proves multi-agent value (judging)

| Judges look for | Where we show it |
| --- | --- |
| Distinct roles | Trace panel shows four agents with their own tools and outputs (EXP-6) |
| Shared state and handoffs | Claims ledger: one claim, its Analyst evidence, Narrator lines, Verifier verdict (EXP-10) |
| Failure recovery | Seeded bad claim repaired on cue (`?seedBadClaim=1`); rules fallback chip; kill-and-resume clip (QUA-5) |
| Better than one agent | QUA-4: same 30 moments, one agent vs four, verified-claim rate and hallucinations per 100 lines, real numbers in the README |
| Interoperability | MCP for tools and Copilot; A2A Stats Desk with an Agent Card |
