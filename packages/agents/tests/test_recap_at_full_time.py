"""With recap_at_full_time the workflow writes the recaps when period 2 ends (AB#499), because no
recap function sees the match end in direct mode. No test here reaches a model."""

import copy

from conftest import run
from matchcast_agents.workflow import WorkflowError
from test_feed_air import flow_with

CUT = 137  # the first half's last event, per test_half_time_flow.py


def with_full_time(match):
    """The fixture stops at half time. Its first-half end, moved to period 2, is full time."""
    ended = next(
        e
        for e in match["events"]
        if e["payload"]["type"] == "period_boundary" and e["payload"].get("boundary") == "ended"
    )
    last = max(e["stream_sequence"] for e in match["events"])
    full_time = copy.deepcopy(ended)
    full_time["event_id"] = f"e{last + 1}"
    full_time["stream_sequence"] = last + 1
    full_time["clock"]["period"] = 2
    full_time["clock"]["period_elapsed_ms"] = 600_000  # the fixture halves are 10 minutes
    full_time["event_time_ms"] = 1_200_000  # total active time at full time
    return match["events"] + [full_time]


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


def test_the_recap_is_written_once_even_when_the_batch_is_replayed(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True
    writes = counted_writes(flow)
    events = with_full_time(match)
    run(flow.ingest(events))
    run(flow.ingest(events))  # the same events again: nothing new is written
    assert len(writes) == 1


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


def test_a_failed_recap_does_not_stop_the_match(match) -> None:
    flow = flow_with(match, personas=("casual", "analyst"))
    flow.config.recap_at_full_time = True

    async def down(*args, **kwargs):
        raise WorkflowError("recap_unavailable", "the tool is down")

    flow._write_recap = down
    events = with_full_time(match)
    run(flow.ingest(events))  # no error reaches the caller
    assert flow.store.get_state(flow.sk).max_sequence == max(e["stream_sequence"] for e in events)
