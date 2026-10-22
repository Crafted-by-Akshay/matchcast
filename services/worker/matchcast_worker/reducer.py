"""Match-state reducer (DAT-2): pure, idempotent, and correction-aware.

`reduce(state, event)` returns the next state. An event whose `stream_sequence` is not greater than
`state.max_sequence` is dropped, so a duplicate delivery or a replay from the start leaves the
state (and its revision counter) unchanged. Corrections replace a goal's payload and retractions
remove it;
score, counts and possession are always derived from the events still in force.
"""

from __future__ import annotations

from typing import Any

from matchcast_agents.state import MatchState, counted
from pydantic import BaseModel

POSSESSION_TYPES = ("pass", "carry", "shot")


class Entry(BaseModel):
    """One logical event as currently in force."""

    sequence: int
    revision: int
    payload: dict[str, Any]
    retracted: bool = False


class StreamState(MatchState):
    ledger: dict[str, Entry] = {}


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


def reduce(state: StreamState, event: dict[str, Any]) -> StreamState:
    """Apply one event envelope; return `state` itself when nothing changes."""
    if event.get("kind") != "event" or event["stream_sequence"] <= state.max_sequence:
        return state
    payload = event["payload"]
    nxt = state.model_copy(deep=True)
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
    nxt.period = event["clock"]["period"]
    nxt.last_events = [*nxt.last_events, event["event_id"]][-10:]
    return nxt


def revision_packet(state: StreamState, event: dict[str, Any]) -> dict[str, Any]:
    """The `state_revision` packet for a committed state (contracts v1.1)."""
    return {
        "kind": "state_revision",
        "schema_version": "1.0.0",
        "stream": event["stream"],
        "snapshot": state.snapshot(),
    }
