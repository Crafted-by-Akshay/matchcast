# 03 Runtime flows

Status: **Agreed design**. Last reviewed 22 Oct 2026.

Each flow is a sequence diagram plus numbered rules. Names in `code` are real endpoints, tables, tools or files. Timings are the budgets from [01-goals-and-constraints.md](01-goals-and-constraints.md) §5.

| Flow | Trigger | Budget |
| --- | --- | --- |
| [F1 Live match loop](#f1-live-match-loop) | Simulator emits an event | p95 ≤ 6 s to screen |
| [F2 Line lifecycle](#f2-line-lifecycle-verify-repair-abstain-fallback) | Any drafted line | 1 repair maximum |
| [F3 Producer approval](#f3-producer-approval) | Producer mode on | Human |
| [F4 Ask the chatbot](#f4-ask-the-chatbot-rag--live-tools) | Viewer question | p95 ≤ 8 s |
| [F5 Talk to a player by voice](#f5-talk-to-a-player-by-voice) | Push-to-talk | p95 ≤ 8 s |
| [F6 Translation and voice](#f6-translation-and-voice-for-a-publication) | Verified publication | translated line ≤ 3 s after English, first audio ≤ 2 s |
| [F7 Vision identification](#f7-vision-identification-ocr) | Vision mode on | ≤ 15 OCR calls a minute |
| [F8 Full-time recap](#f8-full-time-recap) | `period_boundary` full time | ≤ 60 s |
| [F9 Cold start and resume](#f9-cold-start-and-resume-after-a-crash) | Replica start | ≤ 60 s to resume |
| [F10 Data Scientist query](#f10-data-scientist-query) | Analyst asks | p95 ≤ 10 s |
| [F11 Build-time data pipeline](#f11-build-time-data-pipeline) | Data lane runs it | Once |

## F1 Live match loop

Exported image: [img/3-life-of-one-claim.png](img/3-life-of-one-claim.png) (regenerate with `scripts/export_diagrams.sh`).

```mermaid
sequenceDiagram
  autonumber
  participant E as Simulator (browser)
  participant L as live.js bus
  participant A as api edge
  participant H as Event Hubs
  participant C as api consumer
  participant R as reducer
  participant W as agent workflow
  participant M as mcp tools
  participant S as Tables
  E->>L: contract event (seq n)
  L->>A: POST /v1/matches/{id}/events (batch ≤ 50, every 500 ms, goal/card/penalty sent at once)
  A->>A: validate (contracts v1.1 + roster)
  A->>H: publish, partition key = match_id
  A-->>L: 202 {accepted, last_sequence}
  H-->>C: deliver (consumer group $Default, checkpoint eh-checkpoints/api)
  C->>C: drop if seq ≤ state.last_sequence
  C->>R: reduce(state, event)
  R->>S: matchstate current + rev row
  C->>W: new state revision + moment score
  W->>M: get_state / get_events / get_metrics
  W->>S: claims, audit (hash chain)
  W->>S: publications
  A-->>L: SSE claim, verdict, publication, audit
  L-->>E: postMessage to Watch, Broadcast, Analyst
```

Rules:
1. The browser engine is the only match source (EXP-2). Broadcast and Analyst render from the bus.
2. `api` publishes to Event Hubs **before** it acknowledges; a publish failure returns 503 and the browser retries the same batch with the same IDs (idempotent).
3. The consumer is the only writer of `matchstate`. It applies an event only if `stream_sequence > state.last_sequence`; corrections and retractions follow [docs/contracts.md](../contracts.md).
4. The workflow runs for a revision only when the Producer's rate rule allows it (one task per 8 s of match time, or immediately for priority 1). See [04-agents.md](04-agents.md).
5. Tracking frames from the engine stay in the browser. Only semantic events cross the network.
6. In rules mode (`MATCHCAST_AGENT_MODE=rules`) steps 10 to 12 run the deterministic implementations; everything else is identical.

## F2 Line lifecycle (verify, repair, abstain, fallback)

```mermaid
stateDiagram-v2
  [*] --> drafted: Narrator writes a line from the Analyst's claims
  drafted --> verifying
  verifying --> verified: all checks pass
  verifying --> review: meaning unclear (model check)
  verifying --> rejected: number, name, source or safety fails
  rejected --> repairing: first rejection only
  repairing --> verifying: repaired by Analyst (numbers) or Narrator (wording)
  rejected --> abstained: second rejection
  verified --> approved: demo mode auto-approve, or Producer approves
  review --> approved: Producer approves
  review --> killed: Producer kills
  verified --> killed: Producer kills
  approved --> published
  published --> [*]
  abstained --> [*]
  killed --> [*]
```

Rules:
1. The states are the `lines.status` values in [07-data-and-storage.md](07-data-and-storage.md) §4; verdicts and approvals belong to lines, not claims (ADR-0013). Every transition writes one audit record from the closed list in [04-agents.md](04-agents.md) §4 (`line_drafted`, `line_verified`, `line_review`, `line_rejected`, `line_repair_requested`, `line_abstained`, `line_approved`, `line_killed`, `publication_created`, `fallback_used`); the Analyst's claim writes `claim_created` first.
2. Only `published` lines reach any screen, voice or translation.
3. When a model call fails (timeout 20 s, 429 after one retry, 5xx, or the circuit is open), the same step runs its rules implementation, the claim's or line's `derivation_version` gets the suffix `+rules`, and the audit action `fallback_used` is written. The UI shows the "Rules fallback" chip.
4. Content Safety runs inside `verifying`; severity ≥ 2 in any category gives `rejected` with reason `unsafe_content`, and is never repaired.

## F3 Producer approval

```mermaid
sequenceDiagram
  autonumber
  participant P as Producer (Analyst or Broadcast view)
  participant EA as Easy Auth
  participant A as api
  participant V as Verifier
  participant S as Tables
  A-->>P: SSE claim (verified or review) appears in queue
  P->>EA: POST /v1/lines/{line_id}/approve or edit or kill
  EA->>A: request + X-MS-CLIENT-PRINCIPAL
  A->>A: roles contain Producer or Admin? else 403
  alt edit
    A->>V: verify edited text
    V-->>A: verdict
  end
  A->>S: claim status + audit (actor_kind person, display name)
  A-->>P: SSE publication (if approved and verified)
```

Rules: producer mode is a per-match setting (`matches.approval_mode = auto | producer`). The demo default is `auto`. An edit that fails verification is not published and the original stays in the queue.

## F4 Ask the chatbot (RAG + live tools)

```mermaid
sequenceDiagram
  autonumber
  participant U as Viewer
  participant A as api /ask
  participant CS as Content Safety (Prompt Shields)
  participant Q as Router
  participant K as AI Search kb-matchcast-v1
  participant M as mcp tools
  participant AN as Analyst
  participant N as Narrator
  participant V as Verifier
  U->>A: POST /v1/matches/{id}/ask {question ≤ 300 chars, persona, language}
  A->>CS: shield prompt
  CS-->>A: attack? then 400 refused
  A->>Q: classify: live | knowledge | both | out_of_scope
  par knowledge
    Q->>K: hybrid search (BM25 + vector), top 5 chunks
  and live
    Q->>AN: Analyst with MCP tools
    AN->>M: get_state / get_metrics / get_events / query_season
  end
  AN-->>N: claims + chunks
  N-->>V: answer with citations [kb:chunk_id] and [claim:id]
  V-->>A: verified | rejected (repair once) | abstain
  A-->>U: answer, citations, claim IDs, trace ID
```

Rules: out-of-scope questions get "I can only answer questions about this match and MatchCast." Abstain text: "I can't confirm that from the match data yet." 5 questions a minute per browser session. Full design in [05-assistant-rag.md](05-assistant-rag.md).

## F5 Talk to a player by voice

```mermaid
sequenceDiagram
  autonumber
  participant U as Viewer (browser)
  participant A as api
  participant SP as Speech
  participant W as role agent + Verifier
  U->>A: GET /v1/speech/token
  A->>SP: issue token (managed identity)
  A-->>U: token (10 min), region
  U->>SP: speech-to-text in browser (Speech SDK)
  SP-->>U: utterance text
  U->>A: POST /v1/matches/{id}/talk {target, utterance, language}
  A->>W: Prompt Shields, role agent with get_metrics only, Verifier
  W-->>A: reply ≤ 60 words (verified)
  A->>SP: synthesize with the target's voice from voices.json
  A-->>U: reply text + audio URL
```

Orders that change play ("press higher") are a game feature labelled "Game mode". They change the simulator's behaviour but never edit past events.

## F6 Translation and voice for a publication

```mermaid
sequenceDiagram
  autonumber
  participant W as workflow
  participant T as Translator
  participant V as Verifier (deterministic)
  participant SP as Speech
  participant B as Blob audio/
  W->>W: English publication verified and approved
  loop for each language in {es, hi} with ≥ 1 active viewer
    W->>T: translate, player names wrapped in translate=no spans
    T-->>W: text
    W->>V: same numbers and names as English?
    V-->>W: pass, or drop this language for this line
  end
  W->>SP: synthesize per language (en-GB-RyanNeural, es-ES-ElviraNeural, hi-IN-SwaraNeural)
  SP-->>B: mp3 audio/{match_id}/{publication_id}.{lang}.mp3
  W-->>W: SSE publication with per-language text and audio
```

A language with no viewers costs nothing. Lines older than 5 s are captioned but not voiced.

## F7 Vision identification (OCR)

```mermaid
sequenceDiagram
  autonumber
  participant R as 3D render canvas
  participant VT as vision tracker (browser)
  participant A as api /vision/identify
  participant CV as AI Vision Read
  participant L as live.js
  R->>VT: frame every 0.2 s (640x360)
  VT->>VT: detect players and ball, pitch homography, track IDs
  VT->>VT: identity confidence < 0.8? crop torso 128x128
  VT->>A: POST crop (≤ 15 a minute in total)
  A->>CV: Read OCR
  CV-->>A: text + confidence
  A-->>VT: shirt number, confidence
  VT->>VT: roster lookup by team colour + number
  VT->>L: vision events on stream session_id "<session>.vision"
  L->>L: compare with engine truth, accuracy panel
```

Vision events use the existing contracts on a separate stream, so they can never overwrite engine truth. Full design in [09-vision-identification.md](09-vision-identification.md).

## F8 Full-time recap

```mermaid
sequenceDiagram
  autonumber
  participant H as Event Hubs
  participant F as fn-recap
  participant A as api /internal/v1/recaps
  participant W as workflow (recap mode)
  participant B as Blob recaps/
  H-->>F: period_boundary phase = full_time ($Default, checkpoints eh-checkpoints/recap)
  F->>A: POST /internal/v1/recaps {match_id} (managed identity token)
  A->>W: Producer top 5 to 8 moments, Analyst stats, Narrator per persona, Verifier
  W->>B: recaps/{match_id}/{persona}.json (+ broadcast audio)
  A-->>A: SSE recap_ready
```

The function holds no agent logic. It only triggers the `api`, so all agent code lives in one place.

## F9 Cold start and resume after a crash

1. `api` starts with zero replicas. The first HTTP request or an Event Hubs backlog of 50 or more starts one replica (KEDA). The browser shows "Warming up the match engine" until `/ready` returns 200.
2. On start, for every match with `matches.status = live`, the consumer loads `matchstate/current`, then the Agent Framework checkpoint from `checkpoints`, then resumes Event Hubs from the Blob checkpoint.
3. Events at or below `last_sequence` are skipped. Claims use the idempotent key `claim_id = sha256(match_id, moment_id, agent, derivation_version)[:24]`, so a replayed step overwrites with the same row and never duplicates.
4. Readiness returns 200 only after resume finishes. Target: claims resume within 60 s (AGT-13).

## F10 Data Scientist query

```mermaid
sequenceDiagram
  autonumber
  participant U as Analyst view
  participant A as api /v1/ds/ask
  participant D as Data Scientist agent
  participant M as mcp query_season
  participant V as Verifier
  U->>A: question about the season
  A->>D: question + view catalogue
  D->>M: SELECT on allowed views only
  M-->>D: rows (≤ 1,000) + SQL hash
  D-->>V: answer + chart spec (Vega-Lite) + SQL
  V->>M: re-run the same SQL, compare numbers
  V-->>A: verified or rejected
  A-->>U: answer, table, chart, SQL shown
```

## F11 Build-time data pipeline

```mermaid
flowchart LR
  sim[services/simulation<br/>headless engine] -- 240 scenes --> scenes[(Blob scenes/v1 Parquet)]
  sim -- 28-match season --> season[(Blob season/v1 Parquet)]
  wy[Wyscout CC BY 4.0<br/>shots, temp folder] --> fit[Databricks fit-xg]
  scenes --> train[Databricks train-danger]
  fit --> mlf[(MLflow + Unity Catalog)]
  train --> mlf
  fit --> xg[(data/calibration/xg.json)]
  train --> onnx[(Blob models/danger/v/model.onnx<br/>+ model-card.json)]
  onnx --> mcp[mcp predict_danger]
  season --> mcp2[mcp query_season, Stats Desk]
  kb[kb/*.md] --> ing[scripts/build_kb.py] --> srch[(AI Search kb-matchcast-v1)]
  eh[(Event Hubs)] --> es[Fabric Eventstream] --> evh[(Eventhouse events)] --> rtd[Real-Time Dashboard]
```
