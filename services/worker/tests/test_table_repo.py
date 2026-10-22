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


def test_pending_row_is_removed_when_the_gap_fills(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(1, goal()), ev(3, shot())], sk)
    assert any(k[1].startswith("~pending") for k in service.tables["streamledger"].rows)
    feed(repo, [ev(2, shot())], sk)
    assert not any(k[1].startswith("~pending") for k in service.tables["streamledger"].rows)
    assert repo.get(sk).max_sequence == 3


def test_state_rows_hold_only_counters_the_agents_lane_can_read(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(i, shot()) for i in range(1, 6)], sk)
    import json

    row = service.tables["matchstate"].rows[(sk, "current")]
    doc = json.loads(row["doc"])
    assert set(doc) == set(MatchState.model_fields)
    assert MatchState.model_validate(doc).revision == 5
    assert row["revision"] == 5 and row["last_sequence"] == 5
    assert len(repo.revisions(sk)) == 5


def test_storage_is_linear_in_events(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    writes = []
    table = None
    for i in range(1, 41):
        feed(repo, [ev(i, shot())], sk)
        if table is None:
            table = service.tables["streamledger"]
            original = table.upsert_entity

            def counting(entity, **kw):
                writes.append(entity["RowKey"])
                return original(entity, **kw)

            table.upsert_entity = counting
    assert len(writes) == 40 - 1  # one new ledger row per later event, none rewritten


def test_a_corrected_entry_is_rewritten_once(sk):
    service = FakeTableService()
    repo = TableStateRepo(service)
    feed(repo, [ev(1, goal(), event_id="g1")], sk)
    correction = ev(2, {"type": "correction", "target_event_id": "g1", "target_revision": 0,
                        "new_revision": 1, "replacement": goal("away")})  # fmt: skip
    feed(repo, [correction], sk)
    loaded = repo.get(sk)
    assert loaded.ledger["g1"].revision == 1 and loaded.score == {"away": 1}
