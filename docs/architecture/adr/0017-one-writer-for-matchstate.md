# ADR-0017: One writer for the `matchstate` table

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Agents lane (draft); Platform lane accepted 22 Oct 2026 and wired it (Pipeline.handle)

## Context

Two pieces of code can write `matchstate`:

- `TableStore.put_state` (`packages/agents/matchcast_agents/tables.py`), called by the workflow after each event. It writes one row, `current`, with the `MatchState` fields as JSON in `doc` and the `revision` and `last_sequence` columns.
- `TableStateRepo.save` (`services/worker/matchcast_worker/table_repo.py`, merged in #135). It writes the same `current` row in the same shape, plus `rev:<revision>` rows, `l:<event id>` ledger rows, `p:<sequence>` held events and `skipped`, in one entity-group transaction. Its reducer also holds events behind a gap and applies corrections and retractions.

The `current` row is compatible (both are `MatchState` fields in `doc`), so a reader cannot tell them apart. The risk is two writers racing on one row, with no ETag check (07 §4 rule 3 is **Planned**), and a reducer state that disagrees with the workflow's state. Today only the workflow runs in the api consumer (`services/api/app/pipeline.py` calls `flow.ingest`); the reducer is tested but not called. Counting is already one rule: both use `matchcast_agents.state.counted`.

## Options

1. Keep the workflow as the only writer; leave `TableStateRepo` unused. Nothing changes, but gap holding, corrections and the ledger are never used and the worker code is dead.
2. The reducer is the only writer of `matchstate` in pipeline modes (`memory`, `eventhubs`). The consumer runs `process(repo, events)` first and hands the workflow only the events the reducer applied, in order. The workflow keeps its in-memory state and its checkpoint, and does not call `put_state` when a reducer owns the table. In `direct` mode the workflow remains the writer through `TableStore` or `MemoryStore`.
3. Merge the two into one class in `packages/agents` that does both jobs.

## Decision

Option 2. A single writer per mode:

- `direct` mode: the workflow writes `matchstate/current` via `TableStore` (as today).
- `memory` and `eventhubs` modes: `Pipeline.handle` calls `matchcast_worker.repo.process(TableStateRepo or MemoryStateRepo, batch)`; it passes to `flow.ingest` every event of the batch except those the reducer still holds behind a gap (a held event is passed when its gap closes). Duplicates are passed too: the workflow drops them in `store.add_event`, and if the process died between the reducer and the workflow, the Event Hubs replay must still reach the workflow. The workflow stops writing the table through `MATCHCAST_STATE_WRITER=reducer` (default `workflow`), read by `build_store`: `BufferedTableStore(write_state=False)` keeps the working state in memory and restores it from the checkpoint, never from the reducer's row, which may be ahead. The checkpoint (`checkpoints/current`) is unchanged and still holds the workflow's own state and Producer memory.
- A consistency test feeds a shuffled batch with duplicates to the reducer and the same events in sequence order, duplicates kept, to the workflow, and asserts the counters agree; a second test restarts a workflow whose reducer is ahead and asserts the state comes from the checkpoint.
- A correction or retraction updates `matchstate` and the ledger. Lines already published from the old event are **not** retracted yet (Planned); the audit log records a `correction_seen` note.
- Adding the ETag check is out of scope: there is still one writer per mode (ADR-0005).

## Consequences

- No second writer on `matchstate`, so no race; the `current` row shape does not change, so `mcp` and `api` readers do not change.
- Out-of-order batches stop reaching the workflow early, which fixes the late-event ordering gap noted in review.
- State storage stops growing with the square of the event count (ledger rows are separate), which is the debt recorded in 07 §13.
- More moving parts in `Pipeline.handle`: a bug in the reducer now blocks narration. The `direct` mode and the consistency test are the guard.
- Setting `MATCHCAST_STATE_WRITER=reducer` before `Pipeline.handle` calls the reducer, or in `direct` mode, leaves `matchstate` unwritten (nothing reads it directly today). Set it only together with the wiring, in pipeline modes.
- Platform owns the wiring in `pipeline.py` and the Bicep table; Agents built the `MATCHCAST_STATE_WRITER` switch and the consistency test (`services/worker/tests/test_state_writer.py`); Platform sets the variable in Bicep for the pipeline modes.
- A dropped event leaves its sequence unfilled, so later events wait in the reducer until 500 are held (docs/infra.md).

## Affects

- 07-data-and-storage.md §4 and §13
- 03-runtime-flows.md (F1)
- 12-api.md §5
