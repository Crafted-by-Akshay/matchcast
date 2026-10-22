"""Match-state reducer (DAT-2): pure, idempotent, and correction-aware.

`reduce(state, event)` returns the next state. An event whose `stream_sequence` is not greater than
`state.max_sequence` is dropped, so a duplicate delivery or a replay from the start leaves the
state (and its revision counter) unchanged. An event that arrives ahead of a gap is held in
`pending` and applied as soon as the missing sequences arrive; `missing()` names them. If more
than MAX_PENDING events wait, the gap is given up: it is recorded in `skipped` and the run
continues. Corrections replace a goal's payload and retractions remove it; score, counts and
possession are always derived from the events still in force. A correction or retraction whose
target is unknown or already at another revision is applied as a no-op and still counts as a
revision, so the audit trail shows it arrived.
"""

from __future__ import annotations

from typing import Any

from matchcast_agents.state import MatchState, counted
from pydantic import BaseModel

POSSESSION_TYPES = ("pass", "carry", "shot")
MAX_PENDING = 500


class Entry(BaseModel):
    """One logical event as currently in force."""

    sequence: int
    revision: int
    payload: dict[str, Any]
    retracted: bool = False


class StreamState(MatchState):
    ledger: dict[str, Entry] = {}
    pending: dict[int, dict[str, Any]] = {}
    skipped: list[list[int]] = []

    def missing(self) -> list[int]:
        """Sequences not yet seen between max_sequence and the earliest held event."""
        if not self.pending:
            return []
        return list(range(self.max_sequence + 1, min(self.pending)))


def stream_key(event: dict[str, Any]) -> str:
    s = event["stream"]
    return f"{s['tenant_id']}|{s['session_id']}|{s['match_id']}"


def _derive(state: StreamState) -> None:
    """Rebuild score, counts and possession from the entries in force (used after a revision)."""
    state.score = {}
    state.counts = {m: {} for m in state.counts}
    state.possession = None
    for entry in sorted(state.ledger.values(), key=lambda e: e.sequence):
        if entry.retracted:
            continue
        _count(state, entry.payload)


def _count(state: StreamState, payload: dict[str, Any]) -> None:
    for metric, team in counted(payload):
        state.counts[metric][team] = state.counts[metric].get(team, 0) + 1
    if payload["type"] == "goal":
        team = payload["team_id"]
        state.score[team] = state.score.get(team, 0) + 1
    if payload["type"] == "possession_change":
        state.possession = payload["to_team_id"]
    elif payload["type"] in POSSESSION_TYPES:
        state.possession = payload["team_id"]


def _apply(nxt: StreamState, event: dict[str, Any]) -> None:
    payload = event["payload"]
    kind = payload["type"]
    revised = False
    if kind in ("correction", "retraction"):
        target = nxt.ledger.get(payload["target_event_id"])
        if target and target.revision == payload["target_revision"]:
            target.revision = payload["new_revision"]
            if kind == "correction":
                target.payload = payload["replacement"]
            else:
                target.retracted = True
            revised = True
    else:
        nxt.ledger[event["event_id"]] = Entry(
            sequence=event["stream_sequence"], revision=event["revision"], payload=payload
        )
        _count(nxt, payload)
    if revised:
        _derive(nxt)
    nxt.revision += 1
    nxt.max_sequence = event["stream_sequence"]
    nxt.event_time_ms = max(nxt.event_time_ms, event["event_time_ms"])
    nxt.period = max(nxt.period, event["clock"]["period"])
    nxt.last_events = [*nxt.last_events, event["event_id"]][-10:]


def _drain(nxt: StreamState) -> None:
    while nxt.pending:
        want = nxt.max_sequence + 1
        if want in nxt.pending:
            _apply(nxt, nxt.pending.pop(want))
        elif len(nxt.pending) > MAX_PENDING:
            first = min(nxt.pending)
            nxt.skipped.append([want, first - 1])
            _apply(nxt, nxt.pending.pop(first))
        else:
            break


def reduce(state: StreamState, event: dict[str, Any]) -> StreamState:
    """Apply one event envelope; return `state` itself when nothing changes. An event ahead of a
    gap comes back as a new state with the event in `pending` and an unchanged revision."""
    seq = event.get("stream_sequence")
    if event.get("kind") != "event" or seq <= state.max_sequence or seq in state.pending:
        return state
    nxt = state.model_copy(deep=True)
    if seq > state.max_sequence + 1:  # sequences start at 1
        nxt.pending[seq] = event
    else:
        _apply(nxt, event)
    _drain(nxt)
    return nxt


def revision_packet(state: StreamState, event: dict[str, Any]) -> dict[str, Any]:
    """The `state_revision` packet for a committed state (contracts v1.1)."""
    return {
        "kind": "state_revision",
        "schema_version": "1.0.0",
        "stream": event["stream"],
        "snapshot": state.snapshot(),
    }
