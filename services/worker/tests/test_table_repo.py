"""TableStateRepo and MemoryStateRepo must agree; Table rows must stay small and linear."""

import os
import sys
import uuid
from pathlib import Path

import pytest

# the fake Table service the Agents store tests use
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "packages" / "agents" / "tests"))

from fake_tables import FakeTableService  # noqa: E402
from matchcast_agents.state import MatchState
from matchcast_worker.reducer import StreamState, reduce
from matchcast_worker.repo import MemoryStateRepo, process
from matchcast_worker.table_repo import TableStateRepo
from test_reducer import ev, goal, shot


def _azurite():  # pragma: no cover
    from azure.data.tables import TableServiceClient

    return TableStateRepo(
        TableServiceClient.from_connection_string(os.environ["MATCHCAST_AZURITE_CONNECTION"])
    )


REPOS = {
    "memory": MemoryStateRepo,
    "table-fake": lambda: TableStateRepo(FakeTableService()),
}
if os.environ.get("MATCHCAST_AZURITE_CONNECTION"):  # pragma: no cover
    REPOS["azurite"] = _azurite


@pytest.fixture(params=sorted(REPOS))
def repo(request):
    return REPOS[request.param]()


@pytest.fixture
def sk():
    return f"demo|s|m-{uuid.uuid4().hex[:8]}"


def stamp(events, sk):
    tenant, session, match = sk.split("|")
    for e in events:
        e["stream"] = {**e["stream"], "tenant_id": tenant, "session_id": session, "match_id": match}
    return events


def feed(repo, events, sk):
    return process(repo, stamp(events, sk))


def test_missing_stream_is_none(repo, sk):
    assert repo.get(sk) is None


def test_roundtrip_ledger_pending_and_skipped(repo, sk):
    state = StreamState()
    for e in stamp([ev(1, goal()), ev(2, shot()), ev(4, shot(), event_id="held")], sk):
        state = reduce(state, e)
    state.skipped = [[10, 12]]
    repo.save(sk, state)
    loaded = repo.get(sk)
    assert loaded.model_dump() == state.model_dump()
    assert set(loaded.pending) == {4} and loaded.missing() == [3]


def test_reload_continues_like_a_process_that_never_restarted(repo, sk):
    events = [ev(i, goal() if i % 3 == 0 else shot()) for i in range(1, 13)]
    feed(repo, events[:7], sk)
    if isinstance(repo, TableStateRepo):  # a new process: fresh object, same table
        repo = TableStateRepo(repo._service)
    feed(repo, events[7:], sk)
    expected = StreamState()
    for e in stamp(events, sk):
        expected = reduce(expected, e)
    assert repo.get(sk).model_dump() == expected.model_dump()


def test_duplicate_and_late_events_change_nothing(repo, sk):
    events = [ev(1, goal()), ev(2, shot())]
    feed(repo, events, sk)
    before = repo.get(sk).model_dump()
    assert feed(repo, events, sk) == []
    assert repo.get(sk).model_dump() == before


def rows(service):
    return service.tables["matchstate"].rows


def test_pending_row_is_removed_when_the_gap_fills(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(1, goal()), ev(3, shot())], sk)
    assert any(k[1].startswith("p:") for k in rows(service))
    feed(repo, [ev(2, shot())], sk)
    assert not any(k[1].startswith("p:") for k in rows(service))
    assert repo.get(sk).max_sequence == 3


def test_state_rows_hold_only_counters_the_agents_lane_can_read(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(i, shot()) for i in range(1, 6)], sk)
    import json

    row = rows(service)[(sk, "current")]
    doc = json.loads(row["doc"])
    assert set(doc) == set(MatchState.model_fields)
    assert MatchState.model_validate(doc).revision == 5
    assert row["revision"] == 5 and row["last_sequence"] == 5
    assert len(repo.revisions(sk)) == 5


def test_storage_is_linear_in_events(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(1, shot())], sk)
    table = service.tables["matchstate"]
    original, ledger_writes = table.submit_transaction, []

    def counting(operations, **kw):
        ledger_writes.extend(e["RowKey"] for _, e in operations if e["RowKey"].startswith("l:"))
        return original(operations, **kw)

    table.submit_transaction = counting
    feed(repo, [ev(i, shot()) for i in range(2, 41)], sk)
    assert len(ledger_writes) == 39  # one new ledger row per event, none rewritten


def test_a_failed_transaction_leaves_the_previous_state_and_the_next_save_recovers(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(1, goal(), event_id="g1")], sk)
    table = service.tables["matchstate"]
    original = table.submit_transaction

    def boom(operations, **kw):
        raise RuntimeError("storage down")

    table.submit_transaction = boom
    correction = ev(2, {"type": "correction", "target_event_id": "g1", "target_revision": 0,
                        "new_revision": 1, "replacement": goal("away")})  # fmt: skip
    with pytest.raises(RuntimeError):
        feed(repo, [correction], sk)
    table.submit_transaction = original
    survivor = TableStateRepo(service).get(sk)  # another process reads the truth
    assert survivor.ledger["g1"].revision == 0 and survivor.score == {"home": 1}
    feed(repo, [correction], sk)  # the redelivery applies cleanly
    assert repo.get(sk).score == {"away": 1}


def test_a_second_writer_is_noticed_through_the_revision(sk):
    service = FakeTableService()
    one, two = TableStateRepo(service), TableStateRepo(service)
    feed(one, [ev(1, shot())], sk)
    assert two.get(sk).max_sequence == 1
    feed(one, [ev(2, shot())], sk)
    assert two.get(sk).max_sequence == 2  # revision moved, so it reads the partition again


def test_a_drain_over_the_transaction_limit_is_split_and_complete(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    held = [ev(i, shot()) for i in range(2, 250)]
    feed(repo, held, sk)  # all held behind the missing sequence 1
    assert len(repo.get(sk).pending) == 248
    feed(repo, [ev(1, shot())], sk)
    state = repo.get(sk)
    assert state.max_sequence == 249 and not state.pending and len(state.ledger) == 249


def test_an_event_too_large_for_a_row_is_refused(sk):
    repo = TableStateRepo(FakeTableService())
    big = ev(1, {**shot(), "note": "x" * 40_000})
    with pytest.raises(ValueError, match="too large"):
        feed(repo, [big], sk)


def test_a_corrected_entry_is_rewritten_once(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(1, goal(), event_id="g1")], sk)
    correction = ev(2, {"type": "correction", "target_event_id": "g1", "target_revision": 0,
                        "new_revision": 1, "replacement": goal("away")})  # fmt: skip
    feed(repo, [correction], sk)
    loaded = repo.get(sk)
    assert loaded.ledger["g1"].revision == 1 and loaded.score == {"away": 1}


def test_held_event_is_stored_then_dropped_when_the_gap_fills(repo, sk):
    feed(repo, [ev(1, goal()), ev(3, shot())], sk)
    assert set(repo.get(sk).pending) == {3}
    feed(repo, [ev(2, shot())], sk)
    state = repo.get(sk)
    assert not state.pending and state.max_sequence == 3
