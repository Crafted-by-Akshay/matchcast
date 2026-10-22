"""State repository (ADR-0015): `current` row plus one row per revision for replay.

`MemoryStateRepo` backs tests and rules mode. The Table Storage implementation (`matchstate`,
PartitionKey = stream key, RowKey = `current` or the zero-padded revision) goes behind the same
protocol.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol

from .reducer import StreamState, reduce, revision_packet, stream_key


class StateRepo(Protocol):
    def get(self, sk: str) -> StreamState | None: ...
    def save(self, sk: str, state: StreamState) -> None: ...
    def revisions(self, sk: str) -> list[StreamState]: ...


class MemoryStateRepo:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, StreamState]] = {}

    def get(self, sk: str) -> StreamState | None:
        row = self._rows.get(sk, {}).get("current")
        return row.model_copy(deep=True) if row else None

    def save(self, sk: str, state: StreamState) -> None:
        rows = self._rows.setdefault(sk, {})
        copy = state.model_copy(deep=True)
        rows["current"] = copy
        rows[f"{state.revision:010d}"] = copy

    def revisions(self, sk: str) -> list[StreamState]:
        rows = self._rows.get(sk, {})
        return [rows[k] for k in sorted(rows) if k != "current"]


def process(repo: StateRepo, events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """The consumer's core step: reduce each event into its stream's state, save, and return one
    StateRevisionPacket per revision. Duplicates, stale events and events held behind a gap
    produce no packet."""
    packets = []
    for event in events:
        if event.get("kind") != "event":
            continue
        sk = stream_key(event)
        state = repo.get(sk) or StreamState()
        nxt = reduce(state, event)
        if nxt is state:
            continue
        repo.save(sk, nxt)
        if nxt.revision != state.revision:
            packets.append(revision_packet(nxt, event))
    return packets


def process_applied(
    repo: StateRepo, events: Iterable[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """`process`, and also the events that became applied, in stream order (ADR-0017).

    An event ahead of a gap is held and comes back from a later call, once the gap closes; a
    sequence given up on in `skipped` never comes back. The api passes these to the workflow
    so the reducer is the only writer of `matchstate`."""
    packets: list[dict[str, Any]] = []
    applied: list[dict[str, Any]] = []
    for event in events:
        if event.get("kind") != "event":
            continue
        sk = stream_key(event)
        state = repo.get(sk) or StreamState()
        nxt = reduce(state, event)
        if nxt is state:
            continue
        repo.save(sk, nxt)
        if nxt.revision != state.revision:
            packets.append(revision_packet(nxt, event))
        known = {**state.pending, event["stream_sequence"]: event}
        gaps = [(lo, hi) for lo, hi in nxt.skipped]
        for seq in range(state.max_sequence + 1, nxt.max_sequence + 1):
            if seq in known and not any(lo <= seq <= hi for lo, hi in gaps):
                applied.append(known[seq])
    return packets, applied
