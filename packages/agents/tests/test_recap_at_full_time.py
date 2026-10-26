"""With recap_at_full_time the workflow writes the recaps when period 2 ends (AB#499), because no
recap function sees the match end in direct mode. No test here reaches a model."""

import copy

import pytest
from conftest import run
from matchcast_agents.workflow import WorkflowError
from test_feed_air import flow_with

CUT = 137  # the first half's last event, per test_half_time_flow.py


def with_full_time(match):
    """The fixture stops at half time. Its halves are 10 minutes: a period-2 start and then its
    end, both after the first-half end, are full time."""
    ended = next(
        e
        for e in match["events"]
        if e["payload"]["type"] == "period_boundary" and e["payload"].get("boundary") == "ended"
    )
    started = next(
        e
        for e in match["events"]
        if e["payload"]["type"] == "period_boundary" and e["payload"].get("boundary") == "started"
    )
    last = max(e["stream_sequence"] for e in match["events"])
    second_start = copy.deepcopy(started)
    second_start.update(event_id=f"e{last + 1}", stream_sequence=last + 1)
    second_start.update(emitted_at="2026-10-22T10:10:00.000Z")
    second_start["clock"] = {"period": 2, "period_elapsed_ms": 0}
    second_start["event_time_ms"] = 600_000
    full_time = copy.deepcopy(ended)
    full_time.update(event_id=f"e{last + 2}", stream_sequence=last + 2)
    full_time.update(emitted_at="2026-10-22T10:20:00.000Z")
    full_time["clock"] = {"period": 2, "period_elapsed_ms": 600_000}
    full_time["event_time_ms"] = 1_200_000
    return match["events"] + [second_start, full_time]


def counted_writes(flow):
    writes = []
    write = flow._write_recap

    async def counted(*args, **kwargs):
        writes.append(1)
        return await write(*args, **kwargs)

    flow._write_recap = counted
    return writes


def test_direct_mode_writes_the_recaps_when_full_time_comes(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True
    run(flow.ingest(with_full_time(match)))
    assert flow.store.get_recap(flow.sk, "casual") is not None
    assert flow.store.get_recap(flow.sk, "analyst") is not None


def test_a_duplicate_batch_is_dropped_before_the_hook(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True
    writes = counted_writes(flow)
    events = with_full_time(match)
    run(flow.ingest(events))
    run(flow.ingest(events))  # the event store drops every duplicate, so the hook is not reached
    assert len(writes) == 1


def test_a_replayed_full_time_writes_no_recap_again(match) -> None:
    """A catch-up replay or a fresh process runs the boundary through the hook once more; recap()
    skips the personas it has, so the stored recaps and the audit do not change."""
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True
    events = with_full_time(match)
    writes = counted_writes(flow)
    run(flow.ingest(events))
    recaps = {p: flow.store.get_recap(flow.sk, p) for p in ("casual", "analyst")}
    assert all(recaps.values()), "the first full time must write the recaps this replay checks"
    audit = len(flow.store.audit_records(flow.sk))
    run(flow._recap_at_full_time(events[-1]))
    assert len(writes) == 2  # the hook ran again, and recap() wrote nothing new
    assert {p: flow.store.get_recap(flow.sk, p) for p in recaps} == recaps
    assert len(flow.store.audit_records(flow.sk)) == audit


def test_nothing_is_written_before_full_time(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True
    writes = counted_writes(flow)
    run(flow.ingest([e for e in match["events"] if e["stream_sequence"] <= CUT]))
    assert writes == []
    assert flow.store.get_recap(flow.sk, "casual") is None


def test_the_library_default_writes_no_recap(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    run(flow.ingest(with_full_time(match)))
    assert flow.store.get_recap(flow.sk, "casual") is None


@pytest.mark.parametrize(
    "error", [WorkflowError("recap_unavailable", "the tool is down"), RuntimeError("a bug")]
)
def test_a_failed_recap_does_not_stop_the_match(match, error) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True

    calls = []

    async def down(*args, **kwargs):
        calls.append(1)
        raise error

    flow._write_recap = down
    events = with_full_time(match)
    run(flow.ingest(events))  # no error reaches the caller, whatever the recap raised
    assert len(calls) == 1, "the full-time hook must have reached the recap"
    assert flow.store.get_state(flow.sk).max_sequence == max(e["stream_sequence"] for e in events)
