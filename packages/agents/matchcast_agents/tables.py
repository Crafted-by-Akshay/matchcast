"""``TableStore``: the repositories of ``store.py`` on Azure Table Storage (07 §4, §11, ADR-0015).

The service client is passed in (``matchcast_shared.azure_clients.table_service_client()`` in
Azure, a fake in unit tests), so no key or connection string is handled here. One table per
repository; PartitionKey is the stream key ``sk`` (``matches`` uses the tenant id). Each row keeps
the whole record as JSON in ``doc`` beside its key columns. A value over 32,000 UTF-16 units
goes to the Blob ``overflow`` container and ``doc`` holds ``blob:<path>``. Rows that must keep
insertion order (claims, lines, publications) carry ``ord``, a zero-padded nanosecond clock kept
on re-writes.

Known gap: ``put_state`` is a plain upsert; the ``If-Match`` check of 07 §4 rule 3 needs an ETag
in the ``StateRepo`` signature and comes with the second writer.
"""

import copy
import hashlib
import json
import os
import time
from typing import Any, Protocol

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from matchcast_contracts import audit

from .messages import LineRecord
from .state import MatchState

# A Table Storage string property holds 64 KB of UTF-16, 32,768 units; stay a little under.
MAX_COLUMN_UNITS = 32_000
BLOB_PREFIX = "blob:"
TABLES = (
    "matches", "events", "matchstate", "claims", "lines", "publications", "recaps",
    "checkpoints", "audit",
)  # fmt: skip


class BlobContainer(Protocol):
    """The two ``ContainerClient`` calls the overflow rule needs."""

    def upload_blob(self, name: str, data: bytes, overwrite: bool = ...) -> Any: ...
    def download_blob(self, blob: str) -> Any: ...


class TableStore:
    def __init__(self, service: Any, overflow: BlobContainer | None = None) -> None:
        self._service = service
        self._overflow = overflow
        self._tables: dict[str, Any] = {}
        self._audit_tail: dict[str, dict[str, Any]] = {}

    # ---- plumbing ----------------------------------------------------------------------------

    def _table(self, name: str) -> Any:
        if name not in self._tables:
            self._service.create_table_if_not_exists(name)
            self._tables[name] = self._service.get_table_client(name)
        return self._tables[name]

    def ensure_tables(self) -> None:
        for name in TABLES:
            self._table(name)

    def _pack(self, table: str, pk: str, rk: str, value: Any) -> str:
        text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        if len(text.encode("utf-16-le")) // 2 <= MAX_COLUMN_UNITS:
            return text
        if self._overflow is None:
            raise ValueError(
                f"{table} row {rk} is over 32,000 UTF-16 units and no overflow container is set"
            )
        data = text.encode("utf-8")
        # content-addressed, so a writer that loses an audit race cannot overwrite the winner's blob
        digest = hashlib.sha256(data).hexdigest()[:16]
        path = f"{pk}/{table}/{rk}.{digest}.json".replace("|", "_")
        self._overflow.upload_blob(path, data, overwrite=True)
        return BLOB_PREFIX + path

    def _unpack(self, text: str) -> Any:
        if text.startswith(BLOB_PREFIX):
            if self._overflow is None:
                raise ValueError("row points at overflow Blob but no container is set")
            text = self._overflow.download_blob(text[len(BLOB_PREFIX) :]).readall().decode("utf-8")
        return json.loads(text)

    def _get(self, table: str, pk: str, rk: str) -> dict[str, Any] | None:
        try:
            return self._table(table).get_entity(partition_key=pk, row_key=rk)
        except ResourceNotFoundError:
            return None

    def _rows(self, table: str, pk: str, extra: str = "") -> list[dict[str, Any]]:
        rows = self._table(table).query_entities(
            query_filter="PartitionKey eq @pk" + (f" and {extra}" if extra else ""),
            parameters={"pk": pk},
        )
        return sorted(rows, key=lambda r: r["RowKey"])

    def _put(self, table: str, pk: str, rk: str, value: Any, **columns: Any) -> None:
        entity = {
            "PartitionKey": pk,
            "RowKey": rk,
            "doc": self._pack(table, pk, rk, value),
            **columns,
        }
        self._table(table).upsert_entity(entity)

    def _put_ordered(self, table: str, pk: str, rk: str, value: Any, *, keep: bool) -> None:
        """Upsert keeping the first ``ord`` (``keep``) or taking a new one, the list position."""
        existing = self._get(table, pk, rk) if keep else None
        order = existing["ord"] if existing else f"{time.time_ns():020d}"
        self._put(table, pk, rk, value, ord=order)

    def _ordered(self, table: str, pk: str) -> list[Any]:
        rows = sorted(self._rows(table, pk), key=lambda r: (r["ord"], r["RowKey"]))
        return [self._unpack(r["doc"]) for r in rows]

    # ---- matches -----------------------------------------------------------------------------

    @staticmethod
    def _match_keys(sk: str) -> tuple[str, str]:
        tenant, _, rest = sk.partition("|")
        return tenant, rest

    def put_match(self, sk: str, info: dict[str, Any]) -> None:
        pk, rk = self._match_keys(sk)
        self._put("matches", pk, rk, info)

    def get_match(self, sk: str) -> dict[str, Any] | None:
        row = self._get("matches", *self._match_keys(sk))
        return self._unpack(row["doc"]) if row else None

    # ---- events ------------------------------------------------------------------------------

    @staticmethod
    def _event_key(sequence: int, revision: int) -> str:
        return f"{int(sequence):010d}.{int(revision):04d}"

    def add_event(self, sk: str, event: dict[str, Any]) -> bool:
        """Store a semantic event once per (event_id, revision); False for a retry.

        Rows are keyed by ``stream_sequence`` and ``revision``, so a correction that keeps its
        sequence is a second row (as in MemoryStore). A marker row per (event_id, revision) in the
        partition ``<sk>#ids`` catches a re-send under another sequence, as MemoryStore does.
        """
        marker = f"{event['event_id']}:{int(event['revision']):04d}"
        if self._get("events", f"{sk}#ids", marker) is not None:
            return False
        rk = self._event_key(event["stream_sequence"], event["revision"])
        self._put("events", sk, rk, event, event_id=event["event_id"], revision=event["revision"])
        self._put("events", f"{sk}#ids", marker, {"sequence": event["stream_sequence"]})
        return True

    def events(self, sk: str, up_to_sequence: int | None = None) -> list[dict[str, Any]]:
        # "~" sorts after "." so every revision of the last wanted sequence is included
        extra = "" if up_to_sequence is None else f"RowKey le '{up_to_sequence:010d}~'"
        return [self._unpack(r["doc"]) for r in self._rows("events", sk, extra)]

    # ---- state -------------------------------------------------------------------------------

    def get_state(self, sk: str) -> MatchState:
        row = self._get("matchstate", sk, "current")
        return MatchState.model_validate(self._unpack(row["doc"])) if row else MatchState()

    def put_state(self, sk: str, state: MatchState) -> None:
        doc = state.model_dump(mode="json")
        self._put("matchstate", sk, "current", doc, revision=state.revision,
                  last_sequence=state.max_sequence)  # fmt: skip

    # ---- claims, lines, publications, recaps -------------------------------------------------

    def put_claim(self, sk: str, claim: dict[str, Any], meta: dict[str, Any]) -> None:
        self._put_ordered("claims", sk, claim["claim_id"], {"packet": claim, **meta}, keep=True)

    def get_claim(self, sk: str, claim_id: str) -> dict[str, Any] | None:
        row = self._get("claims", sk, claim_id)
        return self._unpack(row["doc"]) if row else None

    def claims(self, sk: str) -> list[dict[str, Any]]:
        return self._ordered("claims", sk)

    def put_line(self, sk: str, line: LineRecord) -> None:
        self._put_ordered("lines", sk, line.line_id, line.model_dump(mode="json"), keep=True)

    def get_line(self, sk: str, line_id: str) -> LineRecord | None:
        row = self._get("lines", sk, line_id)
        return LineRecord.model_validate(self._unpack(row["doc"])) if row else None

    def lines(self, sk: str) -> list[LineRecord]:
        return [LineRecord.model_validate(d) for d in self._ordered("lines", sk)]

    def put_publication(self, sk: str, publication: dict[str, Any]) -> None:
        """Idempotent by publication_id; a replayed step moves it to the end, as in MemoryStore."""
        self._put_ordered(
            "publications", sk, publication["publication_id"], publication, keep=False
        )

    def publications(self, sk: str) -> list[dict[str, Any]]:
        return self._ordered("publications", sk)

    def put_recap(self, sk: str, persona: str, recap: dict[str, Any]) -> None:
        self._put("recaps", sk, persona, recap)

    def get_recap(self, sk: str, persona: str) -> dict[str, Any] | None:
        row = self._get("recaps", sk, persona)
        return self._unpack(row["doc"]) if row else None

    # ---- checkpoint --------------------------------------------------------------------------

    def put_checkpoint(self, sk: str, row: dict[str, Any]) -> None:
        self._put("checkpoints", sk, "current", row, processed_sequence=row["processed_sequence"])

    def get_checkpoint(self, sk: str) -> dict[str, Any] | None:
        row = self._get("checkpoints", sk, "current")
        return self._unpack(row["doc"]) if row else None

    # ---- audit -------------------------------------------------------------------------------

    def _tail(self, sk: str) -> dict[str, Any] | None:
        """Last record: from memory after our own append, else one scan (cold start, lost race)."""
        if sk in self._audit_tail:
            return self._audit_tail[sk]
        rows = self._rows("audit", sk)
        return self._unpack(rows[-1]["doc"]) if rows else None

    def append_audit(self, sk: str, **fields: Any) -> dict[str, Any]:
        """Single writer per match; a 409 on the sequence means another writer won: retry once."""
        for attempt in (1, 2):
            record = audit.append_audit(self._tail(sk), **fields)
            if self._create_audit(sk, record):
                return record
            self._audit_tail.pop(sk, None)  # another writer won: re-read the tail
            if attempt == 2:
                raise ResourceExistsError(f"audit sequence {record['sequence']} already written")
        raise AssertionError("unreachable")

    def write_audit(self, sk: str, record: dict[str, Any]) -> None:
        """Persist a record built elsewhere; writing the same record again is a no-op."""
        if self._create_audit(sk, record):
            return
        rk = f"{int(record['sequence']):010d}"
        have = self._get("audit", sk, rk)
        if have is None or self._unpack(have["doc"]) != record:
            raise ResourceExistsError(f"audit sequence {record['sequence']} holds another record")

    def _create_audit(self, sk: str, record: dict[str, Any]) -> bool:
        rk = f"{int(record['sequence']):010d}"
        entity = {"PartitionKey": sk, "RowKey": rk, "doc": self._pack("audit", sk, rk, record)}
        try:
            self._table("audit").create_entity(entity)
        except ResourceExistsError:
            return False
        self._audit_tail[sk] = record
        return True

    def audit_records(self, sk: str, from_sequence: int = 1, limit: int = 1000) -> list[dict]:
        rows = self._rows("audit", sk, f"RowKey ge '{from_sequence:010d}'")
        return [self._unpack(r["doc"]) for r in rows[:limit]]


class BufferedTableStore:
    """``TableStore`` behind a memory cache with an ordered write-behind queue (07 §11).

    The Azure SDK clients are synchronous and the api calls the store from async code, so a
    direct ``TableStore`` blocks the event loop on every call. Here every read comes from memory
    and every write lands in memory at once and in Table Storage from one worker thread, in the
    order it was made (so a checkpoint is never durable before the events it covers). A match is
    loaded from the tables the first time it is touched (``hydrate`` does that off the loop), so
    after a restart the stored events, lines and audit chain are back. A failed background write
    is raised from the next call, and ``flush`` waits for the queue. Cost: the last few writes are
    lost if the process dies; the checkpoint only trails the durable events, so the Event Hubs
    replay fills the gap.
    """

    def __init__(self, backing: TableStore) -> None:
        from concurrent.futures import ThreadPoolExecutor
        from threading import RLock

        from .store import MemoryStore

        self._t = backing
        self._m = MemoryStore()
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="table-writer")
        self._lock = RLock()
        self._loaded: set[str] = set()
        self._error: BaseException | None = None
        self._last: Any = None

    # ---- plumbing ----------------------------------------------------------------------------

    def _guard(self) -> None:
        """Refuse a change once a background write has failed, before memory is changed."""
        if self._error is not None:
            raise self._error

    def _write(self, fn: Any, *args: Any) -> None:
        self._guard()
        self._last = self._pool.submit(self._run, fn, *args)

    def _run(self, fn: Any, *args: Any) -> None:
        if self._error is not None:
            return  # an earlier write failed: later ones must not land ahead of it
        try:
            fn(*args)
        except BaseException as error:  # noqa: BLE001 - surfaced from the next call
            self._error = error

    def flush(self) -> None:
        """Wait until every queued write is in Table Storage; raise the first failure."""
        last = self._last
        if last is not None:
            last.result()
        if self._error is not None:
            raise self._error

    def close(self) -> None:
        self._pool.shutdown(wait=True)

    @property
    def pending_error(self) -> BaseException | None:
        return self._error

    def hydrate(self, sk: str) -> None:
        """Load a match from the tables once; async code awaits ``to_thread(hydrate)``."""
        with self._lock:
            if sk in self._loaded:
                return
            m, t = self._m, self._t
            for event in t.events(sk):
                m.add_event(sk, event)
            row = t.get_checkpoint(sk)
            if row is not None:
                m.put_checkpoint(sk, row)
            m.put_state(sk, t.get_state(sk))
            for doc in t.claims(sk):
                m.put_claim(sk, doc["packet"], {k: v for k, v in doc.items() if k != "packet"})
            for line in t.lines(sk):
                m.put_line(sk, line)
            for publication in t.publications(sk):
                m.put_publication(sk, publication)
            chain = t.audit_records(sk, 1, 10**9)
            m._audit[sk] = chain
            self._loaded.add(sk)

    # ---- matches -----------------------------------------------------------------------------

    def put_match(self, sk: str, info: dict[str, Any]) -> None:
        self._guard()
        self._m.put_match(sk, info)
        self._write(self._t.put_match, sk, copy.deepcopy(info))

    def get_match(self, sk: str) -> dict[str, Any] | None:
        info = self._m.get_match(sk)
        if info is None:  # a match of an earlier process: read through once
            info = self._t.get_match(sk)
            if info is not None:
                self._m.put_match(sk, info)
        return info

    # ---- events and state --------------------------------------------------------------------

    def add_event(self, sk: str, event: dict[str, Any]) -> bool:
        self._guard()
        self.hydrate(sk)
        if not self._m.add_event(sk, event):
            return False
        self._write(self._t.add_event, sk, copy.deepcopy(event))
        return True

    def events(self, sk: str, up_to_sequence: int | None = None) -> list[dict[str, Any]]:
        self.hydrate(sk)
        return self._m.events(sk, up_to_sequence)

    def get_state(self, sk: str) -> MatchState:
        self.hydrate(sk)
        return self._m.get_state(sk)

    def put_state(self, sk: str, state: MatchState) -> None:
        self._guard()
        self.hydrate(sk)
        self._m.put_state(sk, state)
        self._write(self._t.put_state, sk, state.model_copy(deep=True))

    # ---- claims, lines, publications, recaps -------------------------------------------------

    def put_claim(self, sk: str, claim: dict[str, Any], meta: dict[str, Any]) -> None:
        self._guard()
        self.hydrate(sk)
        self._m.put_claim(sk, claim, meta)
        self._write(self._t.put_claim, sk, copy.deepcopy(claim), copy.deepcopy(meta))

    def get_claim(self, sk: str, claim_id: str) -> dict[str, Any] | None:
        self.hydrate(sk)
        return self._m.get_claim(sk, claim_id)

    def claims(self, sk: str) -> list[dict[str, Any]]:
        self.hydrate(sk)
        return self._m.claims(sk)

    def put_line(self, sk: str, line: LineRecord) -> None:
        self._guard()
        self.hydrate(sk)
        self._m.put_line(sk, line)
        self._write(self._t.put_line, sk, line.model_copy(deep=True))

    def get_line(self, sk: str, line_id: str) -> LineRecord | None:
        self.hydrate(sk)
        return self._m.get_line(sk, line_id)

    def lines(self, sk: str) -> list[LineRecord]:
        self.hydrate(sk)
        return self._m.lines(sk)

    def put_publication(self, sk: str, publication: dict[str, Any]) -> None:
        self._guard()
        self.hydrate(sk)
        self._m.put_publication(sk, publication)
        self._write(self._t.put_publication, sk, copy.deepcopy(publication))

    def publications(self, sk: str) -> list[dict[str, Any]]:
        self.hydrate(sk)
        return self._m.publications(sk)

    def put_recap(self, sk: str, persona: str, recap: dict[str, Any]) -> None:
        self._guard()
        self._m.put_recap(sk, persona, recap)
        self._write(self._t.put_recap, sk, persona, copy.deepcopy(recap))

    def get_recap(self, sk: str, persona: str) -> dict[str, Any] | None:
        recap = self._m.get_recap(sk, persona)
        if recap is None:  # recaps are rare and keyed by persona: read through
            recap = self._t.get_recap(sk, persona)
            if recap is not None:
                self._m.put_recap(sk, persona, recap)
        return recap

    # ---- checkpoint and audit ----------------------------------------------------------------

    def put_checkpoint(self, sk: str, row: dict[str, Any]) -> None:
        self._guard()
        self.hydrate(sk)
        self._m.put_checkpoint(sk, row)
        self._write(self._t.put_checkpoint, sk, copy.deepcopy(row))

    def get_checkpoint(self, sk: str) -> dict[str, Any] | None:
        self.hydrate(sk)
        return self._m.get_checkpoint(sk)

    def append_audit(self, sk: str, **fields: Any) -> dict[str, Any]:
        self._guard()
        self.hydrate(sk)
        record = self._m.append_audit(sk, **fields)
        self._write(self._t.write_audit, sk, copy.deepcopy(record))
        return record

    def audit_records(self, sk: str, from_sequence: int = 1, limit: int = 1000) -> list[dict]:
        self.hydrate(sk)
        return self._m.audit_records(sk, from_sequence, limit)


def build_store(kind: str | None = None) -> Any:
    """``MATCHCAST_STORE=table|memory``: table in Azure, memory in tests and locally."""
    from .store import MemoryStore

    kind = kind or os.environ.get("MATCHCAST_STORE", "memory")
    if kind == "memory":
        return MemoryStore()
    if kind != "table":
        raise ValueError(f"MATCHCAST_STORE must be table or memory, not {kind!r}")
    from matchcast_shared import azure_clients

    container = azure_clients.blob_service_client().get_container_client("overflow")
    try:
        container.create_container()
    except ResourceExistsError:
        pass
    store = TableStore(azure_clients.table_service_client(), container)
    store.ensure_tables()
    return BufferedTableStore(store)
