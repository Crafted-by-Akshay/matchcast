"""The storyline payoff reaches the Narrator (CREW-3.2): a stall picks a player as the storyline,
and that player's goal pays it off once, in the analyst's line, citing both events."""

import matchcast_agents.workflow as workflow_mod
from conftest import run
from matchcast_agents.stall import STALL_S, StallClock
from matchcast_agents.store import MemoryStore
from test_rundown import build


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _first_goal(match) -> dict:
    return next(e for e in match["events"] if e["payload"]["type"] == "goal")


def _analyst_line(flow, goal):
    moment = f"m-{goal['event_id']}"
    analyst = [line for line in flow.store.lines(flow.sk) if line.persona == "analyst"]
    return next(line for line in analyst if line.moment_id == moment)


def test_a_goal_by_the_storyline_player_pays_it_off_in_the_analyst_line(match, monkeypatch) -> None:
    goal = _first_goal(match)
    scorer = goal["payload"]["player_id"]
    monkeypatch.setattr(workflow_mod, "pick_plan", lambda memory: f"player:{scorer}")
    clock = Clock()
    flow = build(match, MemoryStore())
    flow._stall = StallClock(clock=clock)
    run(flow.ingest([e for e in match["events"] if e["stream_sequence"] < goal["stream_sequence"]]))

    async def stall_then_goal() -> None:
        clock.now += STALL_S
        assert await flow._stall_tick()  # the Showrunner replans: the scorer is the storyline
        await flow.ingest(
            [e for e in match["events"] if e["stream_sequence"] >= goal["stream_sequence"]]
        )

    run(stall_then_goal())
    line = _analyst_line(flow, goal)
    assert "storyline" in line.text
    assert line.checks and all(check.passed for check in line.checks)
    assert len(line.text) <= 280


def test_the_casual_line_carries_the_payoff_too(match, monkeypatch) -> None:
    goal = _first_goal(match)
    scorer = goal["payload"]["player_id"]
    monkeypatch.setattr(workflow_mod, "pick_plan", lambda memory: f"player:{scorer}")
    clock = Clock()
    flow = build(match, MemoryStore())
    flow._stall = StallClock(clock=clock)
    run(flow.ingest([e for e in match["events"] if e["stream_sequence"] < goal["stream_sequence"]]))

    async def stall_then_goal() -> None:
        clock.now += STALL_S
        assert await flow._stall_tick()
        await flow.ingest(
            [e for e in match["events"] if e["stream_sequence"] >= goal["stream_sequence"]]
        )

    run(stall_then_goal())
    moment = f"m-{goal['event_id']}"
    casual = next(
        line
        for line in flow.store.lines(flow.sk)
        if line.persona == "casual" and line.moment_id == moment
    )
    assert "Storyline pays off." in casual.text
    assert casual.status == "published" and all(check.passed for check in casual.checks)
    assert len(casual.text) <= 140


def test_an_open_storyline_survives_a_restart_and_still_pays_off(match, monkeypatch) -> None:
    # the storyline opened by a stall is checkpointed with the match: a restart on the same store
    # keeps it open, so the goal after the restart pays it off
    goal = _first_goal(match)
    scorer = goal["payload"]["player_id"]
    monkeypatch.setattr(workflow_mod, "pick_plan", lambda memory: f"player:{scorer}")
    clock = Clock()
    before = build(match, MemoryStore())
    before._stall = StallClock(clock=clock)
    run(
        before.ingest(
            [e for e in match["events"] if e["stream_sequence"] < goal["stream_sequence"]]
        )
    )

    async def stall() -> None:
        clock.now += STALL_S
        assert await before._stall_tick()

    run(stall())
    restarted = build(match, before.store)  # the process restarts on the same store
    run(
        restarted.ingest(
            [e for e in match["events"] if e["stream_sequence"] >= goal["stream_sequence"]]
        )
    )
    assert "storyline" in _analyst_line(restarted, goal).text


def test_a_restart_does_not_open_a_second_storyline_for_the_same_player(match, monkeypatch) -> None:
    from matchcast_agents.storyline import StorylineBook

    book = StorylineBook()
    opening = {"stream_sequence": 1, "event_time_ms": 60_000}
    book.open("home9", opening, "first")
    book.open("home9", opening, "second")  # the same player again: still one open storyline
    assert len(book.to_rows()) == 1
