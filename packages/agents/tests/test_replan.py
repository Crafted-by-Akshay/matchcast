"""The Showrunner's stall replan in the workflow (CREW-1.2): one rundown entry and the replay
specialist's crew_spawn frames per replan, and a second stall falls back to the rules storyline."""

import asyncio

import matchcast_agents.workflow as workflow_mod
from conftest import run
from matchcast_agents.stall import STALL_S, StallClock


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def stalled_flow(make_workflow, match):
    flow = make_workflow()
    run(flow.ingest(match["events"][:5]))
    clock = Clock()
    flow._stall = StallClock(clock=clock)  # the replan is driven by this fake clock
    return flow, clock


def replan_frames(flow) -> list[dict]:
    return [
        e.data
        for e in flow.hub.history()
        if e.event == "crew_spawn" and e.data["moment_id"].startswith("replan-")
    ]


def test_a_stall_replans_once_with_one_rundown_entry_and_spawn_frames(make_workflow, match) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    before = len(flow.rundown)
    clock.now += STALL_S
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    assert len(flow.rundown) == before + 1
    entry = flow.rundown[-1]
    assert entry["moment_id"].startswith("replan-")
    assert entry["called"] == [] and entry["skipped"] == ["replay"]
    assert entry["routed_by"] == "rules"
    assert entry["why"].startswith("stall: match flow -> ")
    assert replan_frames(flow) == []  # assigned, not run: no spawn frame claims a run


def test_a_second_stall_with_no_line_falls_back_to_the_rules_storyline(
    make_workflow, match
) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    clock.now += STALL_S
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    clock.now += STALL_S
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    assert flow.rundown[-1]["why"].endswith("(rules storyline)")
    assert flow._plan == "fallback:rules"


def test_the_stall_check_runs_through_the_event_path(make_workflow, match) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    before = len(flow.rundown)
    clock.now += STALL_S
    run(flow._process_event(match["events"][5]))
    assert len(flow.rundown) == before + 1
    assert flow.rundown[-1]["moment_id"].startswith(f"replan-{match['events'][5]['event_id']}-")


def test_a_workflow_built_long_before_kick_off_does_not_replan_on_its_first_event(
    make_workflow, match
) -> None:
    clock = Clock()
    flow = make_workflow(stall_clock=clock)
    clock.now += 10 * STALL_S  # time passes before any event
    before = len(flow.rundown)
    run(flow._process_event(match["events"][0]))
    assert len(flow.rundown) == before


def test_a_verified_line_resets_the_stall_clock(make_workflow, match) -> None:
    clock = Clock()
    flow = make_workflow(stall_clock=clock)
    run(flow.ingest(match["events"]))  # the fixture aires lines, so this is a real run
    aired = next(
        e
        for e in match["events"]
        if f"m-{e['event_id']}"
        in {
            ln.moment_id
            for ln in flow.store.lines(flow.sk)
            if ln.status in ("verified", "approved", "published")
        }
    )
    clock.now += STALL_S - 10  # 50 s of quiet
    flow._note_aired(aired)  # a verified line of this moment aired
    clock.now += 20  # 70 s after the start, but only 20 s after the line
    assert flow._stall.next_step() == "wait"


def test_no_stall_no_replan(make_workflow, match) -> None:
    flow, clock = stalled_flow(make_workflow, match)
    clock.now += STALL_S - 1
    before = len(flow.rundown)
    flow._replan_if_stalled(flow._ctx(), match["events"][4])
    assert len(flow.rundown) == before and replan_frames(flow) == []


def test_the_stall_timer_replans_a_silent_feed(make_workflow, match, monkeypatch) -> None:
    import asyncio

    import matchcast_agents.workflow as workflow_mod

    monkeypatch.setattr(workflow_mod, "STALL_CHECK_S", 0.01)
    clock = Clock()
    flow = make_workflow(stall_clock=clock)

    before = 0

    async def silent_feed() -> None:
        nonlocal before
        await flow.ingest(match["events"][:5])
        before = len(flow.rundown)  # the feed then goes quiet
        clock.now += STALL_S + 1  # wall time passes with no event at all
        for _ in range(400):  # the timer looks at the clock; wait for its replan, up to 2 s
            await asyncio.sleep(0.005)
            if len(flow.rundown) > before:
                break
        flow._stall_task.cancel()

    run(silent_feed())
    assert len(flow.rundown) > before
    assert flow.rundown[-1]["moment_id"].startswith("replan-")


def full_time(match) -> dict:
    """The final period's end: the match is over, and the stall timer stops."""
    last = match["events"][-1]
    seq = last["stream_sequence"] + 1
    return {
        **last,
        "stream_sequence": seq,
        "event_id": f"full-time-{seq}",
        "event_time_ms": last["event_time_ms"] + 1,
        "clock": {"period": 2, "period_elapsed_ms": last["event_time_ms"] + 1},
        "payload": {"type": "period_boundary", "boundary": "ended"},
    }


def test_the_timer_stops_at_full_time(make_workflow, match, monkeypatch) -> None:
    monkeypatch.setattr(workflow_mod, "STALL_CHECK_S", 0.0)
    clock = Clock()
    flow = make_workflow(stall_clock=clock)
    run(flow.ingest([*match["events"], full_time(match)]))
    clock.now += STALL_S * 3  # the silence after the final whistle
    before = len(flow.rundown)
    run(asyncio.wait_for(flow._stall_watch(), 2))  # returns; it does not run on forever
    assert len(flow.rundown) == before


def test_a_failing_tick_keeps_the_timer_running(make_workflow, match, monkeypatch) -> None:
    monkeypatch.setattr(workflow_mod, "STALL_CHECK_S", 0.0)
    flow, clock = stalled_flow(make_workflow, match)
    clock.now += STALL_S
    real = flow._replan_if_stalled
    calls: list[dict] = []

    def flaky(ctx, event):
        calls.append(event)
        if len(calls) == 1:
            raise RuntimeError("transient hub failure")
        real(ctx, event)

    flow._replan_if_stalled = flaky
    flow._match_over = lambda: len(calls) >= 2  # stop the loop after the second look
    before = len(flow.rundown)
    run(asyncio.wait_for(flow._stall_watch(), 2))
    assert len(calls) == 2  # the loop went on past the failure
    assert len(flow.rundown) == before + 1


def test_a_resumed_workflow_starts_the_timer_without_a_new_event(make_workflow, match) -> None:
    first = make_workflow()
    run(first.ingest(match["events"][:5]))
    clock = Clock()
    resumed = make_workflow(stall_clock=clock, store=first.store)

    async def resumed_feed() -> None:
        await resumed.ingest(match["events"][:5])  # already stored: no event is processed
        assert resumed._stall_task is not None
        clock.now += STALL_S
        assert await resumed._stall_tick()

    def replans() -> int:
        return sum(e["moment_id"].startswith("replan-") for e in resumed.rundown)

    before = replans()
    run(resumed_feed())
    assert replans() == before + 1
