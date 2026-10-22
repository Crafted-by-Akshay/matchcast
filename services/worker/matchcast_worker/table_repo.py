"""Table Storage `StateRepo` (ADR-0015, doc 07 §13).

One table, `matchstate`, PartitionKey = stream key. Rows:

* `current` and `rev:<10 digit revision>`: the counters only (the fields of
  `matchcast_agents.state.MatchState`), so the Agents lane reads them unchanged and a state row
  stays small however long the match runs.
* `l:<event id>`: one ledger `Entry` per logical event, written only when it is new or revised, so
  storage grows linearly with the event count, not with its square.
* `p:<10 digit sequence>`: one row per event held behind a gap; `skipped`: the given-up gaps.

A save is one entity-group transaction (one partition, up to 100 operations), so a crash leaves
either the old state or the new one, never a ledger ahead of its counters. A save of more than 100
operations (a held run of more than about 95 events draining at once) is split, and only its last
chunk, which holds `current`, is the commit; an earlier chunk that lands alone is repeated by the
redelivery of the same events. `get()` reads the one `current` row first and the rest of the
partition only when another writer has moved it, so a single consumer reads each stream once.
`revisions()` returns counters only. One writer per stream (ADR-0005); no ETag check yet.
"""

from __future__ import annotations

import json
from typing import Any

from azure.core.exceptions import ResourceNotFoundError
from matchcast_agents.state import MatchState

from .reducer import Entry, StreamState

LEDGER, PENDING, SKIPPED = "l:", "p:", "skipped"
COUNTER_FIELDS = tuple(MatchState.model_fields)
MAX_OPS = 100
MAX_COLUMN_UNITS = 32_000  # Table Storage allows 32,768 UTF-16 units in a string property


def _dump(value: Any) -> str:
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if len(text.encode("utf-16-le")) // 2 > MAX_COLUMN_UNITS:
        raise ValueError("a state row is over 32,000 UTF-16 units; the event is too large to hold")
    return text


class TableStateRepo:
    def __init__(self, service: Any) -> None:
        self._service = service
        self._table_client: Any = None
        # per stream: (revision, state, row texts) as last read or written by this process
        self._cache: dict[str, tuple[int, StreamState, dict[str, str]]] = {}

    @property
    def _table(self) -> Any:
        if self._table_client is None:
            self._service.create_table_if_not_exists("matchstate")
            self._table_client = self._service.get_table_client("matchstate")
        return self._table_client

    def _partition(self, sk: str) -> list[dict[str, Any]]:
        rows = self._table.query_entities(query_filter="PartitionKey eq @pk", parameters={"pk": sk})
        return sorted(rows, key=lambda r: r["RowKey"])

    def get(self, sk: str) -> StreamState | None:
        try:
            current = self._table.get_entity(partition_key=sk, row_key="current")
        except ResourceNotFoundError:
            self._cache.pop(sk, None)
            return None
        cached = self._cache.get(sk)
        if cached and cached[0] == current["revision"]:
            return cached[1].model_copy(deep=True)
        ledger: dict[str, Entry] = {}
        pending: dict[int, dict[str, Any]] = {}
        skipped: list[list[int]] = []
        texts: dict[str, str] = {}
        for row in self._partition(sk):
            key, doc = row["RowKey"], row["doc"]
            if key.startswith(LEDGER):
                ledger[key[len(LEDGER) :]] = Entry.model_validate_json(doc)
            elif key.startswith(PENDING):
                pending[int(key[len(PENDING) :])] = json.loads(doc)
            elif key == SKIPPED:
                skipped = json.loads(doc)
            else:
                continue
            texts[key] = doc
        state = StreamState(
            **json.loads(current["doc"]), ledger=ledger, pending=pending, skipped=skipped
        )
        self._cache[sk] = (current["revision"], state.model_copy(deep=True), texts)
        return state

    def save(self, sk: str, state: StreamState) -> None:
        old = self._cache.get(sk)
        texts = dict(old[2]) if old else {}
        if old is None and self._table_has(sk):  # first save in this process: learn what is there
            self.get(sk)
            texts = dict(self._cache[sk][2])
        wanted: dict[str, Any] = {
            f"{LEDGER}{k}": e.model_dump(mode="json") for k, e in state.ledger.items()
        }
        wanted.update({f"{PENDING}{seq:010d}": ev for seq, ev in state.pending.items()})
        if state.skipped:
            wanted[SKIPPED] = state.skipped
        ops: list[tuple[str, dict[str, Any]]] = []
        new_texts: dict[str, str] = {}
        for key, value in wanted.items():
            text = _dump(value)
            new_texts[key] = text
            if texts.get(key) != text:
                ops.append(("upsert", {"PartitionKey": sk, "RowKey": key, "doc": text}))
        for key in texts:
            if key not in wanted:  # a held event that has since applied
                ops.append(("delete", {"PartitionKey": sk, "RowKey": key}))
        counters = _dump(state.model_dump(mode="json", include=set(COUNTER_FIELDS)))
        columns = {"revision": state.revision, "last_sequence": state.max_sequence}
        for key in (f"rev:{state.revision:010d}", "current"):
            row = {"PartitionKey": sk, "RowKey": key, "doc": counters, **columns}
            ops.append(("upsert", row))
        try:
            for start in range(0, len(ops), MAX_OPS):
                self._table.submit_transaction(ops[start : start + MAX_OPS])
        except Exception:
            self._cache.pop(sk, None)  # whatever landed, the next get() reads the truth
            raise
        self._cache[sk] = (state.revision, state.model_copy(deep=True), new_texts)

    def _table_has(self, sk: str) -> bool:
        try:
            self._table.get_entity(partition_key=sk, row_key="current")
        except ResourceNotFoundError:
            return False
        return True

    def revisions(self, sk: str) -> list[StreamState]:
        return [
            StreamState(**json.loads(r["doc"]))
            for r in self._partition(sk)
            if r["RowKey"].startswith("rev:")
        ]
