"""Table Storage `StateRepo` (ADR-0015, doc 07 §13).

Rows, all with PartitionKey = stream key:

* `matchstate` `current` and `rev:<10 digit revision>`: the counters only (the fields of
  `matchcast_agents.state.MatchState`), so the Agents lane reads them unchanged and a state row
  stays small however long the match runs.
* `streamledger` RowKey = event id: one `Entry` per logical event; written only when it is new
  or revised, so storage grows linearly with the event count, not with its square.
* `streamledger` RowKey = `~pending:<10 digit sequence>`: one row per event held behind a gap, and
  `~skipped` for the given-up gaps.

A save writes the ledger and pending rows first and the `current` row last, so `current` is the
commit point: a crash between the two leaves the previous state in force and the next save
repeats the writes. `revisions()` returns the counter states only (no ledger), which is what replay
needs. One writer per stream (ADR-0005), so there is no ETag check yet.
"""

from __future__ import annotations

import json
from typing import Any

from azure.core.exceptions import ResourceNotFoundError
from matchcast_agents.state import MatchState

from .reducer import Entry, StreamState

PENDING = "~pending:"
SKIPPED = "~skipped"
COUNTER_FIELDS = tuple(MatchState.model_fields)


def _dump(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


class TableStateRepo:
    def __init__(self, service: Any) -> None:
        self._service = service
        self._tables: dict[str, Any] = {}
        # what this process last wrote per stream, so a save writes only what changed
        self._seen: dict[str, dict[str, str]] = {}

    def _table(self, name: str) -> Any:
        if name not in self._tables:
            self._service.create_table_if_not_exists(name)
            self._tables[name] = self._service.get_table_client(name)
        return self._tables[name]

    def _rows(self, table: str, sk: str) -> list[dict[str, Any]]:
        rows = self._table(table).query_entities(
            query_filter="PartitionKey eq @pk", parameters={"pk": sk}
        )
        return sorted(rows, key=lambda r: r["RowKey"])

    def _put(self, table: str, sk: str, rk: str, doc: Any, **columns: Any) -> None:
        self._table(table).upsert_entity(
            {"PartitionKey": sk, "RowKey": rk, "doc": _dump(doc), **columns}
        )

    def get(self, sk: str) -> StreamState | None:
        try:
            current = self._table("matchstate").get_entity(partition_key=sk, row_key="current")
        except ResourceNotFoundError:
            return None
        counters = json.loads(current["doc"])
        ledger: dict[str, Entry] = {}
        pending: dict[int, dict[str, Any]] = {}
        skipped: list[list[int]] = []
        seen: dict[str, str] = {}
        for row in self._rows("streamledger", sk):
            key, doc = row["RowKey"], row["doc"]
            if key == SKIPPED:
                skipped = json.loads(doc)
            elif key.startswith(PENDING):
                pending[int(key[len(PENDING) :])] = json.loads(doc)
            else:
                ledger[key] = Entry.model_validate_json(doc)
            seen[key] = doc
        self._seen[sk] = seen
        return StreamState(**counters, ledger=ledger, pending=pending, skipped=skipped)

    def save(self, sk: str, state: StreamState) -> None:
        seen = self._seen.setdefault(sk, {})
        wanted: dict[str, Any] = {k: e.model_dump(mode="json") for k, e in state.ledger.items()}
        wanted.update({f"{PENDING}{seq:010d}": ev for seq, ev in state.pending.items()})
        if state.skipped:
            wanted[SKIPPED] = state.skipped
        ledger = self._table("streamledger")
        for key, value in wanted.items():
            text = _dump(value)
            if seen.get(key) != text:
                self._put("streamledger", sk, key, value, sequence=_sequence(key, value))
                seen[key] = text
        counters = state.model_dump(mode="json", include=set(COUNTER_FIELDS))
        columns = {"revision": state.revision, "last_sequence": state.max_sequence}
        self._put("matchstate", sk, f"rev:{state.revision:010d}", counters, **columns)
        self._put("matchstate", sk, "current", counters, **columns)  # the commit point
        for key in [k for k in seen if k not in wanted]:  # held events that have since applied
            if key.startswith(PENDING):  # deleted after the commit, so a crash never loses them
                ledger.delete_entity(partition_key=sk, row_key=key)
            del seen[key]

    def revisions(self, sk: str) -> list[StreamState]:
        return [
            StreamState(**json.loads(r["doc"]))
            for r in self._rows("matchstate", sk)
            if r["RowKey"].startswith("rev:")
        ]


def _sequence(key: str, value: Any) -> int:
    if key.startswith(PENDING):
        return int(key[len(PENDING) :])
    return int(value.get("sequence", 0)) if isinstance(value, dict) else 0
