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


def after_match(match, offset: int, payload: dict, period: int = 2) -> dict:
    """A stored-style event `offset` sequences after the fixture's last event."""
    last = match["events"][-1]
    seq = last["stream_sequence"] + offset
    return {
        **last,
        "stream_sequence": seq,
        "event_id": f"x-{seq}",
        "event_time_ms": last["event_time_ms"] + offset,
        "clock": {"period": period, "period_elapsed_ms": last["event_time_ms"] + offset},
        "payload": payload,
    }


def full_time(match) -> dict:
    """The second half's end: the match is over, and the stall timer stops."""
    return after_match(match, 1, {"type": "period_boundary", "boundary": "ended"})


def test_the_timer_stops_at_full_time(make_workflow, match, monkeypatch) -> None:
    monkeypatch.setattr(workflow_mod, "STALL_CHECK_S", 0.0)
    clock = Clock()
    flow = make_workflow(stall_clock=clock)
    run(flow.ingest([*match["events"], full_time(match)]))
    clock.now += STALL_S * 3  # the silence after the final whistle
    before = len(flow.rundown)
    run(asyncio.wait_for(flow._stall_watch(), 2))  # returns; it does not run on forever
    assert len(flow.rundown) == before


def test_extra_time_after_the_regulation_end_replans_again(make_workflow, match) -> None:
    # regulation's end is not the end of the match when extra time follows: the timer picks up
    # again with the period-3 start, and a silent extra-time feed replans
    flow = make_workflow(stall_clock=(clock := Clock()))
    extra = after_match(match, 2, {"type": "period_boundary", "boundary": "started"}, period=3)
    run(flow.ingest([*match["events"], full_time(match), extra]))
    clock.now += STALL_S * 3

    async def look() -> bool:
        return await flow._stall_tick()

    before = len(flow.rundown)
    assert run(look()) is True
    assert len(flow.rundown) == before + 1


def test_a_retracted_full_time_does_not_stop_the_timer(make_workflow, match) -> None:
    flow = make_workflow(stall_clock=(clock := Clock()))
    ft = full_time(match)
    payload = {
        "type": "retraction",
        "target_event_id": ft["event_id"],
        "target_stream_sequence": ft["stream_sequence"],
        "target_revision": 1,
        "new_revision": 2,
        "reason": "Synthetic test: full time disallowed",
    }
    retract = after_match(match, 2, payload)
    run(flow.ingest([*match["events"], ft, retract]))
    clock.now += STALL_S * 3

    async def look() -> bool:
        return await flow._stall_tick()

    before = len(flow.rundown)
    assert run(look()) is True
    assert len(flow.rundown) == before + 1


def correction(match, target: dict, replacement: dict, offset: int) -> dict:
    return after_match(
        match,
        offset,
        {
            "type": "correction",
            "target_event_id": target["event_id"],
            "target_stream_sequence": target["stream_sequence"],
            "target_revision": 0,
            "new_revision": 1,
            "replacement": replacement,
            "reason": "Synthetic test: boundary corrected",
        },
    )


def test_a_correction_that_reinstates_play_puts_the_timer_back_on(make_workflow, match) -> None:
    flow = make_workflow(stall_clock=(clock := Clock()))
    ft = full_time(match)
    reinstated = correction(match, ft, {"type": "period_boundary", "boundary": "started"}, 2)
    run(flow.ingest([*match["events"], ft, reinstated]))
    assert not flow._match_over()
    clock.now += STALL_S * 3

    async def look() -> bool:
        return await flow._stall_tick()

    before = len(flow.rundown)
    assert run(look()) is True
    assert len(flow.rundown) == before + 1


def test_a_correction_that_ends_the_match_stops_the_timer(make_workflow, match) -> None:
    flow = make_workflow()
    started = after_match(match, 1, {"type": "period_boundary", "boundary": "started"})
    ended = correction(match, started, {"type": "period_boundary", "boundary": "ended"}, 2)
    run(flow.ingest([*match["events"], started, ended]))
    assert flow._match_over()


def test_a_closed_workflow_does_not_restart_its_timer(make_workflow, match) -> None:
    flow = make_workflow()
    flow.close()
    run(flow.ingest(match["events"][:5]))
    assert flow._stall_task is None


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


def test_a_resumed_workflow_starts_the_timer_without_a_new_event(
    make_workflow, match, monkeypatch
) -> None:
    monkeypatch.setattr(workflow_mod, "STALL_CHECK_S", 0.01)
    first = make_workflow()
    run(first.ingest(match["events"][:5]))
    clock = Clock()
    resumed = make_workflow(stall_clock=clock, store=first.store)

    def replans() -> int:
        return sum(e["moment_id"].startswith("replan-") for e in resumed.rundown)

    before = replans()

    async def resumed_feed() -> None:
        await resumed.ingest(match["events"][:5])  # already stored: no event is processed
        assert resumed._stall_task is not None
        clock.now += STALL_S
        for _ in range(400):  # the timer's own loop looks at the clock; wait up to 2 s
            await asyncio.sleep(0.005)
            if replans() > before:
                break
        resumed._stall_task.cancel()

    run(resumed_feed())
    assert replans() == before + 1


def test_replan_ids_do_not_repeat_after_a_restart(make_workflow, match) -> None:
    clock = Clock()
    first = make_workflow(stall_clock=clock)
    run(first.ingest(match["events"][:5]))
    clock.now += STALL_S

    async def stall(flow) -> None:
        assert await flow._stall_tick()  # the timer's look checkpoints the replan

    run(stall(first))
    restarted = make_workflow(stall_clock=clock, store=first.store)
    run(restarted.ingest(match["events"][:5]))  # already stored: the restart reads the checkpoint
    clock.now += STALL_S * 3
    run(stall(restarted))
    ids = [e["moment_id"] for e in restarted.rundown if e["moment_id"].startswith("replan-")]
    assert len(ids) == len(set(ids)) == 2, ids


def test_the_timer_does_not_checkpoint_an_event_that_was_never_processed(
    make_workflow, match
) -> None:
    clock = Clock()
    flow = make_workflow(stall_clock=clock)
    run(flow.ingest(match["events"][:5]))
    # a stored event whose processing failed: it is in the store, not in the checkpoint
    flow.store.add_event(flow.sk, match["events"][5])
    before = flow.store.get_checkpoint(flow.sk)["processed_sequence"]
    clock.now += STALL_S * 3

    async def look() -> bool:
        return await flow._stall_tick()

    assert run(look())
    assert flow.store.get_checkpoint(flow.sk)["processed_sequence"] == before
    assert not [e for e in flow.rundown if e["moment_id"].startswith("replan-")]
