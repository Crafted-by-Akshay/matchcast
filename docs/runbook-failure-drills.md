# Failure drills

Rehearsals for the demo and for judges who ask "what happens when it breaks". Each drill says what to do, what you should see, and whether it has been run. Local drills need only the api (`cd services/api && ../../.venv/bin/uvicorn app.main:app --port 8000`) and the ten-minute fixture; the Azure drills need the live deployment and have **not been run** (no deployment yet, 22 Oct).

| # | Drill | Where | Status |
| --- | --- | --- | --- |
| 1 | Malformed event is refused with a problem document | local | Run 22 Oct |
| 2 | The same batch twice is accepted once | local | Run 22 Oct |
| 3 | Seeded bad claim is caught and repaired | local | Not run here (covered by api tests and the QUA-5 clip) |
| 4 | Model unavailable: lines continue from the rules implementation | Azure | Not run |
| 5 | Kill the api replica mid-match and resume from the stored events | Azure | Not run |
| 6 | Event Hubs backlog wakes the api from zero | Azure | Not run (needs DAT-1 replay publisher; see docs/infra.md, Scaling proof) |
| 7 | Cost alert fires | Azure | Not run (see docs/runbook-shutdown.md) |

## 1. Malformed event
Create a match, then post a batch whose first event lacks `payload` (`POST /v1/matches/{id}/events?session_id=...`).
Expect: `422`, `code: contract_invalid`, `path: /events/0`, detail `'payload' is a required property`. Nothing from the batch is stored.
Observed 22 Oct on the local api in rules mode.

## 2. Duplicate batch
Post the same first 50 fixture events twice.
Expect: both calls return `202` with `last_sequence: 50`; the audit trail holds one set of `claim_created` / `line_*` records, not two (events are keyed by `stream_sequence`, so a replay is a no-op).
Observed 22 Oct: both calls return 202, and the audit counts after two posts equal those after one post on a fresh match (16 `claim_created`, 12 each of `line_drafted`, `line_verified`, `line_approved`, `publication_created`). After the Oct 24 change those two Stats Desk comparisons are `a2a_call` records with `compared_with: all season teams` and `requested_team_id: home` (the fixture's club names are not season clubs; a season club is compared by its code); before it they were `a2a_failed` with "no team rows for team 'home'". The line publishes either way, so this is the designed degrade, not a duplicate.

## 3. Seeded bad claim
Create a match with header `x-matchcast-seed-bad-claim: 1` (the value must be exactly `1`; or `seed_bad_claim: true` in the body, cue at `seed_bad_claim_at_ms`, default 12:00). The Producer drafts a line with a wrong number, the Verifier recounts from the stored events and rejects it, the line is repaired once or abstained (04-agents.md; F2).
Expect: a `line_rejected` audit record followed by a repaired `line_verified`, and the rejected line never reaches a `publication`.

## 4. Model unavailable (Azure)
The deployed api runs with `MATCHCAST_AGENT_MODE=rules` (containerapps.bicep), so the model is never called until you also set `MATCHCAST_AGENT_MODE=live`. Do that first, then set `FOUNDRY_MODEL_DEPLOYMENT` to a name that does not exist on the api container app (`az containerapp update ... --set-env-vars`), post events.
Expected by design (not yet observed): after the timeout or error each step runs its rules implementation, audit shows `fallback_used` with a `fallback_reason`, the UI shows the rules chip, the circuit breaker opens after 3 failures in 60 s. Restore the setting afterwards and confirm the chip clears. The "Fallback spike" alert needs more than 20% rules lines for 10 minutes.

## 5. Kill and resume (Azure)
Mid-replay, run `az containerapp replica list` then restart the revision (`az containerapp revision restart`).
Expected by design (not yet observed): the SSE stream reconnects with `Last-Event-ID`, state is rebuilt from the Table Storage rows (`MATCHCAST_STORE=table`), no line is published twice. In-memory mode (`MATCHCAST_STORE` unset) loses the match on restart, which is why Azure sets it to `table`.

## 6 and 7
See docs/infra.md (Scaling proof) and docs/runbook-shutdown.md for the exact commands. Record each result in `docs/evidence/` with the date.
