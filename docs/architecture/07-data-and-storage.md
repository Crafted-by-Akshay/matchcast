# 07 Data model and storage design

Status: **Agreed design**. Last reviewed 22 Oct 2026. Wire formats are defined in `packages/contracts` ([docs/contracts.md](../contracts.md)); this file defines how they are stored.

## 1. Store choices

| Store | Holds | Why this store |
| --- | --- | --- |
| Azure Table Storage | Matches, events, match state, claims, lines, publications, audit, checkpoints, conversations | Key-value by match; pennies a month; managed identity. Cosmos DB was dropped for cost (cost plan, 18 Oct) |
| Azure Blob Storage | Season and scene Parquet, models, audio, recaps, KB fallback, vision crops, exports, Event Hubs checkpoints | Files and large objects |
| Event Hubs `match-events` | The live event log, 1-day retention | Fan-out to `api`, `fn-recap`, Fabric |
| AI Search `kb-matchcast-v1` | Knowledge base chunks and vectors | Hybrid retrieval, see [05-assistant-rag.md](05-assistant-rag.md) |
| DuckDB (in `mcp`, read-only) | SQL over the season Parquet | Data Scientist and Stats Desk queries without a database server |
| Fabric Eventhouse `matchcast` | Copy of events for the Real-Time Dashboard | Build-time only; paused after filming |
| Databricks Unity Catalog + MLflow | Training data views, experiments, registered models | Build-time only |

## 2. Keys

The contracts identify a stream by the tuple `(tenant_id, session_id, match_id)`. Identifiers use `[A-Za-z0-9._:-]`, so `|` can never appear inside one.

- **Stream key** `sk = tenant_id + "|" + session_id + "|" + match_id`. Every Table partition and every Blob path for match data uses it.
- **Blob path prefix** `{tenant_id}/{session_id}/{match_id}/`.
- Where a backlog story writes `{match_id}` in a key or path, it means the stream key or this prefix.
- The demo tenant is `demo`. Vision output uses `session_id = <session>.vision` (see [09-vision-identification.md](09-vision-identification.md)).
- Sequence row keys are zero-padded to 10 digits, so they sort as text.

## 3. Logical model

```mermaid
erDiagram
  MATCH ||--o{ EVENT : has
  MATCH ||--o{ STATE_REVISION : has
  MATCH ||--o{ MOMENT : has
  MOMENT ||--o{ CLAIM : produces
  CLAIM }o--o{ EVENT : cites
  CLAIM ||--o{ LINE : "worded as"
  LINE ||--o| PUBLICATION : "becomes"
  PUBLICATION ||--o{ LANGUAGE_VARIANT : has
  MATCH ||--o{ AUDIT_RECORD : logs
  MATCH ||--o{ CHECKPOINT : resumes
  MATCH ||--o{ CONVERSATION_TURN : answers
  MATCH ||--o| RECAP : summarises
  TEAM ||--o{ PLAYER : fields
  MATCH }o--|| TEAM : home
  MATCH }o--|| TEAM : away
  MATCH }o--|| VENUE : at

  MATCH { string sk PK  int seed  string engine_version  string status  string approval_mode }
  EVENT { string sk PK  int stream_sequence PK  string event_id  string kind  int revision }
  STATE_REVISION { string sk PK  int revision PK  int last_sequence }
  MOMENT { string moment_id PK  int priority  string reason }
  CLAIM { string claim_id PK  string metric  float value  string units  string verdict  string approval_status }
  LINE { string line_id PK  string persona  string text  string status  string reason_code }
  PUBLICATION { string publication_id PK  datetime published_at  datetime expires_at }
  LANGUAGE_VARIANT { string language PK  string text  string audio_blob }
  AUDIT_RECORD { int sequence PK  string action  string prev_hash  string hash }
  CHECKPOINT { string moment_executor PK  string state_json }
  CONVERSATION_TURN { int turn PK  string question  string answer }
  RECAP { string persona PK  string blob }
  TEAM { string team_id PK  string name }
  PLAYER { string player_id PK  int shirt  string position  int rating }
  VENUE { string venue_id PK  string city }
```

A **claim** is one measured fact (Analyst). A **line** is the Narrator's text for one persona, built from one or more claims; the Verifier gives each line a verdict, and the Producer approves lines. A claim's contract field `approval_status` becomes `approved` when any line built on it is approved. A **publication** is an approved, verified line with its language variants and audio.

## 4. Tables

All tables live in `stmatchcastdev`. Columns hold JSON as strings where noted. A string column is at most 60 KB; anything larger goes to Blob `overflow/{prefix}/{table}/{RowKey}.json` and the column holds `blob:<path>`.

| Table | PartitionKey | RowKey | Columns | Written by | Read by |
| --- | --- | --- | --- | --- | --- |
| `matches` | `tenant_id` | `session_id|match_id` | seed, engine_version, home_team_id, away_team_id, venue_id, kickoff_local, approval_mode (`auto`, `producer`), status (`scheduled`, `live`, `full_time`, `abandoned`), languages_active (JSON), score_home, score_away, created_at, ended_at | `api` | all |
| `events` | `sk` | `stream_sequence` (10 digits) | event_id, kind, revision, event_time_ms, period, team_id, player_id, payload (JSON), emitted_at, ingested_at | `api` consumer | `mcp`, `api` |
| `matchstate` | `sk` | `current` or `rev:<revision 10 digits>` | revision, last_sequence, state (JSON), updated_at | `api` consumer (only writer) | `mcp`, `api` |
| `claims` | `sk` | `claim_id` | moment_id, agent, metric, value, units, source_event_ids (JSON), tool_call_ids (JSON), formula_inputs (JSON), derivation_version, snapshot_revision, verdict, reason_code, approval_status, created_at | workflow | `api`, `mcp` (`get_evidence`) |
| `lines` | `sk` | `line_id` | claim_ids (JSON), persona, text, status (`drafted`, `verifying`, `verified`, `review`, `rejected`, `repairing`, `abstained`, `approved`, `killed`, `published`), reason_code, checks (JSON), repair_of, created_at, decided_by | workflow, Producer actions | `api` |
| `publications` | `sk` | `publication_id` | line_id, persona, variants (JSON: language → text, audio_blob, verifier_pass), match_time_ms, published_at, expires_at | workflow | `api` (SSE replay) |
| `audit` | `sk` | `sequence` (10 digits) | audit_id, time, actor_kind, actor_id, action, subject_id, details (JSON ≤ 2 KB), prev_hash, hash | everything, through `append_audit()` | `api` (`/audit`) |
| `checkpoints` | `sk` | `<moment_id>:<executor>` | checkpoint (JSON), created_at | workflow | workflow on resume |
| `conversations` | `sk|browser_session_id` | `turn` (4 digits) | question, persona, answer, citations (JSON), verdict, created_at | `api /ask` | `api /ask` |

Write rules:
1. Idempotent keys: `claim_id = sha256(sk, moment_id, agent, derivation_version)[:24]`; `line_id = sha256(claim_ids, persona, attempt)[:24]`; `publication_id = sha256(line_id)[:24]`. Upserts with the same key are safe on replay.
2. `audit.sequence` is assigned by a single writer per match (the `api` replica) with an optimistic insert; a 409 Conflict means another writer won, so re-read the tail and retry once.
3. `matchstate/current` is updated with an ETag check (`If-Match`), so a stale writer fails instead of overwriting.

## 5. Blob containers

| Container | Path | Content | Lifecycle |
| --- | --- | --- | --- |
| `season` | `v1/{matches,events,players,team_match_stats,player_match_stats}.parquet` | 28-match season | Kept |
| `scenes` | `v1/part-*.parquet` | 240 labelled scenes | Kept |
| `models` | `danger/{version}/model.onnx`, `danger/{version}/model-card.json` | Danger model | Kept |
| `audio` | `{prefix}/{publication_id}.{lang}.mp3`, `{prefix}/recap.{lang}.mp3` | Voice | Delete after 30 days |
| `recaps` | `{prefix}/{persona}.json` | Full-time recaps | Kept |
| `kb` | `v1/chunks.jsonl` | Search fallback copy | Kept |
| `vision` | `{prefix}/{yyyyMMddHHmm}/crop-{n}.png` | OCR crops | Delete after 1 day |
| `exports` | `{prefix}/{export_id}.{csv,json}` | Analyst exports with SHA-256 | Delete after 7 days |
| `overflow` | see §4 | Large JSON values | With the row |
| `eh-checkpoints` | SDK-managed, one folder per reader (`api`, `recap`) | Event Hubs offsets | SDK-managed |

## 6. Season database (DuckDB in `mcp`)

The `mcp` container opens an in-memory DuckDB at start, reads the season Parquet from Blob with the managed identity, and creates these read-only views. `query_season` accepts only one `SELECT` statement over these views; it rejects any other statement, function or table, applies `LIMIT 1000`, and stops after 5 s.

| View | Grain | Key columns |
| --- | --- | --- |
| `matches` | one row per match | match_id, date, home_team_id, away_team_id, score_home, score_away, venue_id, weather |
| `events` | one row per event | match_id, stream_sequence, kind, team_id, player_id, x, y, event_time_ms, outcome, xg |
| `players` | one row per player | player_id, team_id, name, shirt, position, rating |
| `team_match_stats` | team × match | goals, shots, xg, passes, pass_pct, duels, possession_pct, ppda |
| `player_match_stats` | player × match | minutes, goals, shots, xg, passes, key_passes, tackles, distance_km |
| `player_vectors` | one row per player | per-90 vector of 12 metrics, used for similarity |

## 7. Event Hubs

- Namespace `evhns-matchcast-dev`, Basic tier, hub `match-events`, 1 partition, 1-day retention, partition key `sk`, local auth disabled.
- Basic allows **one consumer group** (Microsoft Learn, "Compare Event Hubs tiers"). All readers use `$Default`: `api` and `fn-recap` each keep their own checkpoint folder in `eh-checkpoints`, and the Fabric Eventstream tracks its own position. A consumer group allows up to 5 readers per partition, and we use 3. See ADR-0006.

## 8. Fabric Eventhouse

Table `events` (KQL): `tenant_id: string, session_id: string, match_id: string, stream_sequence: long, event_id: string, kind: string, team_id: string, player_id: string, x: real, y: real, event_time_ms: long, period: int, payload: dynamic, ingested_at: datetime`. Queries for the four dashboard tiles are in `data/fabric/queries.kql`.

## 9. Databricks Unity Catalog

Catalog `matchcast`: schema `raw` (external volumes over Blob `scenes` and `season`), schema `calib` (table `xg_fit`), schema `ml` (registered model `matchcast.ml.danger`). Everything is built by the `train-danger` and `fit-xg` jobs; nothing is edited by hand.

## 10. Retention and privacy

- No personal data is generated: all players and clubs are fictional.
- Personal data we do hold: the Producer's Entra display name and object ID in `audit`, and text that viewers type into Ask or Talk. `conversations` rows older than 24 hours are deleted by an hourly sweep in `api`. Vision crops are deleted after 1 day.
- Everything is deleted at shutdown with `azd down --purge` on 11 Nov 2026 (runbook, PLT-10).
