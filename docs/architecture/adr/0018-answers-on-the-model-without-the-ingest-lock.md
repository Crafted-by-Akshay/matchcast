# ADR-0018: Ask and talk answer on the model, from a snapshot, without waiting for the ingest lock

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decided by:** Agents lane, from the Akshay review of the deployed app (Copilot and talk to players did not answer during a live match)

## Context

Three things stopped a viewer from getting an answer during a live match on the deployed app:

1. `Assistant` (Ask) answers only the metrics its router knows and abstains on the rest. It never called the model, so "who is on top?" got "I can't confirm that from the match data yet."
2. `MatchWorkflow.ask` and `MatchWorkflow.talk` took `self._lock`, the same lock `ingest` holds for a whole batch while the live agents write. A live batch takes tens of seconds, so a question waited behind it, and the shell (8 s) and Watch (9 s) gave up.
3. The player's reply was a template ("N shots so far") and Watch showed a checked reply only when it had facts.

## Options

1. Raise the timeouts. Nothing else changes, and the question still waits behind the batch.
2. Ask and talk read a snapshot of the record and never take the ingest lock. The answer uses the state as it stands: events are immutable, and claims still in review are not used.
3. Keep the lock and give asks a priority queue. More moving parts, and the same wait for a viewer.

## Decision

Option 2, with the model answers checked before they are shown:

- `LiveAnswers` (`packages/agents/matchcast_agents/live/answers.py`) answers from a fact sheet recounted with the Verifier's own code (`recompute`, `player_stats`). An Ask answer must cite fact ids and have at least one number. Each count must be digits bound to its metric ("15 shots" needs "shots 15" in a cited fact), and each capitalised name must appear in a cited fact. A talk reply must pass the Verifier's number-to-metric check, use digits only (no count in words or ordinals), and name only the speaker and the two clubs. The content screen runs on the Ask text. The shell shows the player's reply without a tick.
- A model answer that fails a check, times out (15 s budget) or errors goes to the rules instead (`Assistant` for Ask, `player_reply` for talk). The audit records which one answered (`mode`, and `origin` for talk).
- `ask` and `talk` no longer take `self._lock`. `ingest` keeps it.
- Ask and talk have separate per-session budgets (10 a minute each).

## Consequences

- A question during a live batch is answered within the budget instead of after the batch.
- Ask answers are not written as claims; they cite facts and are audited as `ask_answered`.
- The rules answers are unchanged, so a model outage or a rejected reply gives the same answers as before.
- The snapshot can lag the batch in progress by the events not yet stored. That is the cost of not waiting.
- Each Ask or talk costs one model call (gpt-5-mini, low reasoning). The per-session budget bounds it.

## Affects

- 03-runtime-flows.md (F4, F5)
- 04-agents.md (player persona, Ask pipeline)
- 05-assistant-rag.md (§5 rate limit and the live path)
- 12-api.md (talk and ask rows, rate-limit table)
