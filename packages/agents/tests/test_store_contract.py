"""One contract suite for every store: MemoryStore and TableStore (on a fake) must agree.

``MATCHCAST_AZURITE_CONNECTION`` (optional) adds a third run of the same suite against Azurite.
"""

import json
import os
import uuid

import pytest
from fake_tables import FakeContainer, FakeTableService
from matchcast_agents.messages import LineRecord
from matchcast_agents.state import MatchState
from matchcast_agents.store import MemoryStore, stream_key
from matchcast_agents.tables import MAX_COLUMN_UNITS, BufferedTableStore, TableStore, build_store
from matchcast_contracts import audit

# a fresh match id per run, so a reused Azurite store never sees rows of an earlier run
MATCH = f"m-{uuid.uuid4().hex[:8]}"
STREAM = {"tenant_id": "demo", "session_id": "s1", "match_id": MATCH}
SK = stream_key(STREAM)
OTHER = stream_key({**STREAM, "match_id": "m2"})


def _azurite() -> TableStore:  # pragma: no cover - needs the emulator
    from azure.data.tables import TableServiceClient

    return TableStore(
        TableServiceClient.from_connection_string(os.environ["MATCHCAST_AZURITE_CONNECTION"])
    )


STORES = {
    "memory": MemoryStore,
    "table-fake": lambda: TableStore(FakeTableService(), FakeContainer()),
    "table-buffered": lambda: BufferedTableStore(TableStore(FakeTableService(), FakeContainer())),
}
if os.environ.get("MATCHCAST_AZURITE_CONNECTION"):  # pragma: no cover
    STORES["azurite"] = _azurite
    STORES["azurite-buffered"] = lambda: BufferedTableStore(_azurite())


@pytest.fixture(params=sorted(STORES))
def store(request, monkeypatch):
    # a fresh match per test, so a persistent store (Azurite) never hands one test another's rows
    stream = {**STREAM, "match_id": f"m-{uuid.uuid4().hex[:8]}"}
    monkeypatch.setitem(globals(), "STREAM", stream)
    monkeypatch.setitem(globals(), "SK", stream_key(stream))
    monkeypatch.setitem(globals(), "OTHER", stream_key({**stream, "match_id": "m2"}))
    made = STORES[request.param]()
    yield made
    if isinstance(made, BufferedTableStore):
        made.flush()  # a background write that failed fails the test that made it
        made.close()


def event(seq: int, event_id: str | None = None, revision: int = 0) -> dict:
    return {
        "kind": "event", "schema_version": "1.1.0", "stream": STREAM,
        "event_id": event_id or f"e{seq}", "stream_sequence": seq, "revision": revision,
        "event_time_ms": seq * 1000, "emitted_at": "2026-10-22T10:00:00.000Z",
        "clock": {"period": 1, "period_elapsed_ms": seq * 1000},
        "payload": {"type": "pass", "team_id": "home", "player_id": "p1"},
    }  # fmt: skip


def line(line_id: str, text: str = "A line.") -> LineRecord:
    return LineRecord(
        line_id=line_id, moment_id="mo1", claim_ids=["c1"], persona="casual", text=text,
        status="drafted", created_at="2026-10-22T10:00:00Z", snapshot_revision=1,
    )  # fmt: skip


def audit_fields(action: str) -> dict:
    return {
        "stream": STREAM, "actor_kind": "person", "actor_id": "u1", "action": action,
        "subject_id": "l1", "details": {"n": 1}, "time": "2026-10-22T10:00:00Z",
    }  # fmt: skip


def test_match_round_trip_and_isolation(store) -> None:
    assert store.get_match(SK) is None
    store.put_match(SK, {"roster": {"home": ["p1"]}, "names": {"p1": "A One"}})
    assert store.get_match(SK) == {"roster": {"home": ["p1"]}, "names": {"p1": "A One"}}
    assert store.get_match(OTHER) is None


def test_events_idempotent_ordered_and_scoped(store) -> None:
    assert store.add_event(SK, event(1)) is True
    assert store.add_event(SK, event(1)) is False  # a retry of the same (event_id, revision)
    assert store.add_event(SK, event(2)) is True
    assert store.add_event(SK, event(3, event_id="e2", revision=1)) is True  # a correction
    assert [e["stream_sequence"] for e in store.events(SK)] == [1, 2, 3]
    assert [e["stream_sequence"] for e in store.events(SK, up_to_sequence=2)] == [1, 2]
    assert store.events(SK, up_to_sequence=0) == []
    assert store.events(OTHER) == []


def test_correction_keeping_its_sequence_is_kept_beside_the_original(store) -> None:
    assert store.add_event(SK, event(5)) is True
    assert store.add_event(SK, event(5, event_id="e5", revision=1)) is True
    assert store.add_event(SK, event(5, event_id="e5", revision=1)) is False  # its own retry
    assert store.add_event(SK, event(6)) is True
    assert [(e["stream_sequence"], e["revision"]) for e in store.events(SK)] == [
        (5, 0),
        (5, 1),
        (6, 0),
    ]
    assert [(e["stream_sequence"], e["revision"]) for e in store.events(SK, up_to_sequence=5)] == [
        (5, 0),
        (5, 1),
    ]


def test_a_resent_event_under_another_sequence_is_not_stored_twice(store) -> None:
    """The Verifier recounts from the stored events, so a duplicate would be counted twice."""
    assert store.add_event(SK, event(1)) is True
    assert store.add_event(SK, event(9, event_id="e1")) is False
    assert [e["stream_sequence"] for e in store.events(SK)] == [1]


def test_state_defaults_and_copies(store) -> None:
    assert store.get_state(SK) == MatchState()
    state = MatchState(revision=3, max_sequence=9, score={"home": 1})
    store.put_state(SK, state)
    got = store.get_state(SK)
    assert got == state
    got.score["home"] = 99  # a returned state is a copy
    assert store.get_state(SK).score == {"home": 1}


def test_claims_keep_insertion_order_and_upsert_in_place(store) -> None:
    for cid in ("c9", "c1", "c5"):
        store.put_claim(SK, {"claim_id": cid, "value": 1}, {"tool_call_ids": ["t"]})
    store.put_claim(SK, {"claim_id": "c1", "value": 2}, {"tool_call_ids": ["t"]})
    assert [c["packet"]["claim_id"] for c in store.claims(SK)] == ["c9", "c1", "c5"]
    assert store.get_claim(SK, "c1")["packet"]["value"] == 2
    assert store.get_claim(SK, "c1")["tool_call_ids"] == ["t"]
    assert store.get_claim(SK, "nope") is None
    assert store.claims(OTHER) == []


def test_lines_round_trip_in_order(store) -> None:
    store.put_line(SK, line("l2", "Second."))
    store.put_line(SK, line("l1"))
    store.put_line(SK, line("l2", "Second, edited."))
    assert [x.line_id for x in store.lines(SK)] == ["l2", "l1"]
    assert store.get_line(SK, "l2").text == "Second, edited."
    assert store.get_line(SK, "zz") is None


def test_publications_are_idempotent_by_id(store) -> None:
    store.put_publication(SK, {"publication_id": "p1", "text": "a"})
    store.put_publication(SK, {"publication_id": "p2", "text": "b"})
    store.put_publication(SK, {"publication_id": "p1", "text": "a2"})  # replayed step
    rows = store.publications(SK)
    assert sorted(r["publication_id"] for r in rows) == ["p1", "p2"]
    assert [r["text"] for r in rows if r["publication_id"] == "p1"] == ["a2"]
    assert rows[-1]["publication_id"] == "p1"  # moved to the end, as MemoryStore does


def test_recaps_by_persona(store) -> None:
    assert store.get_recap(SK, "casual") is None
    store.put_recap(SK, "casual", {"text": "Full time."})
    assert store.get_recap(SK, "casual") == {"text": "Full time."}
    assert store.get_recap(SK, "analyst") is None


def test_checkpoint_overwrites(store) -> None:
    assert store.get_checkpoint(SK) is None
    store.put_checkpoint(SK, {"processed_sequence": 4, "state": {}, "producer": None})
    store.put_checkpoint(SK, {"processed_sequence": 7, "state": {"x": 1}, "producer": {"m": 1}})
    assert store.get_checkpoint(SK) == {
        "processed_sequence": 7, "state": {"x": 1}, "producer": {"m": 1}
    }  # fmt: skip
    assert store.get_checkpoint(OTHER) is None


def test_audit_chain_and_paging(store) -> None:
    first = store.append_audit(SK, **audit_fields("line_approved"))
    second = store.append_audit(SK, **audit_fields("line_killed"))
    assert (first["sequence"], second["sequence"]) == (1, 2)
    assert second["prev_hash"] == first["hash"]
    records = store.audit_records(SK)
    assert [r["sequence"] for r in records] == [1, 2]
    assert [r["sequence"] for r in store.audit_records(SK, from_sequence=2)] == [2]
    assert [r["sequence"] for r in store.audit_records(SK, limit=1)] == [1]
    assert audit.verify_chain(records)["valid"]
    assert store.audit_records(OTHER) == []


# ---- TableStore only ---------------------------------------------------------------------


def test_large_values_go_to_blob_overflow_and_come_back() -> None:
    service, container = FakeTableService(), FakeContainer()
    store = TableStore(service, container)
    big = {"claim_id": "c1", "blob": "x" * (MAX_COLUMN_UNITS + 10)}
    store.put_claim(SK, big, {})
    row = service.tables["claims"].rows[(SK, "c1")]
    assert row["doc"].startswith("blob:")
    assert len(container.blobs) == 1
    assert store.get_claim(SK, "c1")["packet"] == big


def test_large_value_without_overflow_container_is_refused() -> None:
    store = TableStore(FakeTableService())
    with pytest.raises(ValueError, match="UTF-16"):
        store.put_claim(SK, {"claim_id": "c1", "blob": "x" * (MAX_COLUMN_UNITS + 10)}, {})


def test_audit_conflict_retries_once_then_fails() -> None:
    service = FakeTableService()
    store = TableStore(service)
    store.append_audit(SK, **audit_fields("claim_created"))
    table = service.tables["audit"]
    real_create = table.create_entity
    calls = {"n": 0}

    def racing(entity, **kw):
        calls["n"] += 1
        if calls["n"] == 1:  # another writer took the sequence between our read and our insert
            other = store.audit_records(SK)[-1]
            rival = audit.append_audit(other, **audit_fields("line_edited"))
            real_create({"PartitionKey": SK, "RowKey": f"{rival['sequence']:010d}",
                         "doc": json.dumps(rival)})  # fmt: skip
        return real_create(entity, **kw)

    table.create_entity = racing
    record = store.append_audit(SK, **audit_fields("line_drafted"))
    assert record["sequence"] == 3 and record["action"] == "line_drafted"
    assert [r["action"] for r in store.audit_records(SK)] == [
        "claim_created",
        "line_edited",
        "line_drafted",
    ]


def test_row_keys_are_the_documented_ones() -> None:
    service = FakeTableService()
    store = TableStore(service)
    store.put_match(SK, {})
    store.add_event(SK, event(12))
    store.put_state(SK, MatchState())
    store.append_audit(SK, **audit_fields("claim_created"))
    assert ("demo", f"s1|{MATCH}") in service.tables["matches"].rows
    assert (SK, "0000000012.0000") in service.tables["events"].rows
    assert (SK, "current") in service.tables["matchstate"].rows
    assert (SK, "0000000001") in service.tables["audit"].rows


def test_build_store_picks_by_name(monkeypatch) -> None:
    assert isinstance(build_store("memory"), MemoryStore)
    monkeypatch.setenv("MATCHCAST_STORE", "memory")
    assert isinstance(build_store(), MemoryStore)
    with pytest.raises(ValueError, match="table or memory"):
        build_store("redis")


def _buffered(service: FakeTableService, container: FakeContainer) -> BufferedTableStore:
    return BufferedTableStore(TableStore(service, container))


def test_buffered_store_survives_a_restart() -> None:
    service, container = FakeTableService(), FakeContainer()
    first = _buffered(service, container)
    first.put_match(SK, {"roster": {}})
    first.add_event(SK, event(1))
    first.add_event(SK, event(1, event_id="e1", revision=1))
    first.put_state(SK, MatchState(revision=2, max_sequence=1))
    first.put_claim(SK, {"claim_id": "c1", "value": 1}, {"agent": "analyst"})
    first.put_line(SK, line("l1"))
    first.put_publication(SK, {"publication_id": "p1"})
    first.append_audit(SK, **audit_fields("claim_created"))
    first.append_audit(SK, **audit_fields("line_drafted"))
    first.put_checkpoint(SK, {"processed_sequence": 1, "state": {}, "producer": None})
    first.flush()
    first.close()

    second = _buffered(service, container)  # a new process on the same tables
    assert second.get_match(SK) == {"roster": {}}
    assert [(e["stream_sequence"], e["revision"]) for e in second.events(SK)] == [(1, 0), (1, 1)]
    assert second.get_state(SK).max_sequence == 1
    assert second.get_claim(SK, "c1")["agent"] == "analyst"
    assert [x.line_id for x in second.lines(SK)] == ["l1"]
    assert [p["publication_id"] for p in second.publications(SK)] == ["p1"]
    assert second.get_checkpoint(SK)["processed_sequence"] == 1
    assert second.add_event(SK, event(1)) is False  # already stored
    chain = second.audit_records(SK)
    assert [r["action"] for r in chain] == ["claim_created", "line_drafted"]
    third = second.append_audit(SK, **audit_fields("line_edited"))  # the chain continues
    assert third["sequence"] == 3 and third["prev_hash"] == chain[-1]["hash"]
    second.flush()
    assert len(TableStore(service, container).audit_records(SK)) == 3
    second.close()


def test_buffered_store_does_not_block_the_caller_on_slow_storage() -> None:
    import time

    service = FakeTableService()
    store = _buffered(service, FakeContainer())
    store.hydrate(SK)
    real = TableStore.add_event

    def slow(self, sk, ev):
        time.sleep(0.05)
        return real(self, sk, ev)

    TableStore.add_event = slow
    try:
        started = time.perf_counter()
        for seq in range(1, 21):
            store.add_event(SK, event(seq))
        assert time.perf_counter() - started < 0.5  # 20 writes at 50 ms each would take 1 s
        store.flush()
        assert len(store._t.events(SK)) == 20
    finally:
        TableStore.add_event = real
        store.close()


def test_buffered_store_raises_a_failed_background_write_and_keeps_order() -> None:
    service = FakeTableService()
    store = _buffered(service, FakeContainer())
    real = TableStore.put_state

    def broken(self, sk, state):
        raise RuntimeError("storage down")

    TableStore.put_state = broken
    try:
        store.add_event(SK, event(1))
        store.put_state(SK, MatchState())
        store.put_checkpoint(SK, {"processed_sequence": 1, "state": {}, "producer": None})
        with pytest.raises(RuntimeError, match="storage down"):
            store.flush()
        with pytest.raises(RuntimeError, match="storage down"):
            store.add_event(SK, event(2))  # the next call raises it too
    finally:
        TableStore.put_state = real
        store.close()
    assert TableStore(service).get_checkpoint(SK) is None  # nothing landed after the failure
