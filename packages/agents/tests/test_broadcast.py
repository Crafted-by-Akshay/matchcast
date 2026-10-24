"""Broadcast Copilot picks (ADR-0019): ranked in code, cited to events, never on the live loop."""

from pathlib import Path

import pytest
from conftest import run
from matchcast_agents import broadcast
from matchcast_agents.ask import Assistant, Bm25Index, load_kb
from matchcast_agents.context import MatchContext
from matchcast_agents.state import MatchState

KB = Path(__file__).parents[3] / "kb"


@pytest.fixture(scope="module")
def assistant():
    return Assistant(Bm25Index(load_kb(KB)))


@pytest.fixture
def flow(make_workflow, match):
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    return flow


def synthetic(events, score=None, now_ms=None):
    """A context over hand-written events, so each rule can be checked on its own."""
    names = {"r4": "Tom Hale", "h9": "Ivan Ruiz"}
    last = events[-1]["event_time_ms"] if events else 0
    state = MatchState(score=score or {}, event_time_ms=now_ms if now_ms is not None else last)
    return MatchContext(
        stream={},
        roster={"team_ids": ["northgate", "rivertown"]},
        names=names,
        clubs={"northgate": "Northgate FC", "rivertown": "Rivertown United"},
        state=state,
        events=tuple(events),
    )


def event(event_id, at_ms, payload, period=1):
    return {
        "event_id": event_id,
        "event_time_ms": at_ms,
        "clock": {"period": period, "period_elapsed_ms": at_ms},
        "payload": payload,
    }


def goal(event_id, at_ms, player, own_goal=False):
    return event(
        event_id,
        at_ms,
        {"type": "goal", "player_id": player, "team_id": "northgate", "own_goal": own_goal},
    )


def test_intents_are_read_from_the_question() -> None:
    assert broadcast.intent_for("Give me the highlights so far") == "highlights"
    assert broadcast.intent_for("Where should the camera go next?") == "focus"
    assert broadcast.intent_for("What is the production plan for the next ten minutes?") == "plan"
    assert broadcast.intent_for("How many shots has Northgate FC had?") is None
    assert broadcast.intent_for("Write a story about Ivan Ruiz") is None
    assert broadcast.intent_for("What should I know about Northgate FC?") is None


def test_highlights_are_the_goal_first_and_cite_their_events(flow) -> None:
    ctx = flow._ctx()
    picks = broadcast.highlights(ctx)
    assert picks, "the fixture has a goal, so there is at least one highlight"
    assert picks[0]["kind"] == "goal"
    ids = {e["event_id"] for e in ctx.events}
    assert all(p["event_id"] in ids for p in picks)
    assert [p["score"] for p in picks] == sorted((p["score"] for p in picks), reverse=True)


def test_highlight_reasons_use_only_roster_names_and_event_minutes(flow) -> None:
    ctx = flow._ctx()
    for pick in broadcast.highlights(ctx):
        if pick["player_id"]:
            assert ctx.player_name(pick["player_id"]) in pick["reason"]
        assert f"{pick['minute']}'" in pick["reason"]


def test_own_goal_names_no_hero_and_is_not_a_focus_target() -> None:
    ctx = synthetic([goal("e1", 30 * 60_000, "r4", own_goal=True)])
    pick = broadcast.highlights(ctx)[0]
    assert pick["label"] == "Own goal"
    assert "Tom Hale" not in pick["reason"]
    assert broadcast.focus(ctx)["target"] == "zone"


def test_period_end_is_half_time_then_full_time() -> None:
    first = event("e1", 45 * 60_000, {"type": "period_boundary", "boundary": "ended"}, period=1)
    second = event("e2", 90 * 60_000, {"type": "period_boundary", "boundary": "ended"}, period=2)
    labels = [p["label"] for p in broadcast.highlights(synthetic([first, second]))]
    assert labels == ["Full time", "Half time"]


def test_focus_only_looks_back_three_minutes() -> None:
    old = goal("e1", 5 * 60_000, "h9")
    quiet = event("e2", 30 * 60_000, {"type": "pass", "player_id": "r4", "team_id": "northgate"})
    ctx = synthetic([old, quiet])
    assert broadcast.focus(ctx)["target"] == "zone"
    recent = goal("e3", 29 * 60_000 + 30_000, "h9")
    pick = broadcast.focus(synthetic([old, recent, quiet]))
    assert pick["target"] == "player" and pick["event_id"] == "e3"


def test_plan_does_not_reair_an_old_goal() -> None:
    old = goal("e1", 5 * 60_000, "h9")
    late_pass = event(
        "e2", 85 * 60_000, {"type": "pass", "player_id": "r4", "team_id": "northgate"}
    )
    steps, cited = broadcast.plan(synthetic([old, late_pass], score={"northgate": 1}))
    assert all("Ivan Ruiz" not in step for step in steps)
    assert "e1" not in cited


def test_plan_cites_the_events_it_names() -> None:
    recent = goal("e1", 20 * 60_000, "h9")
    steps, cited = broadcast.plan(synthetic([recent], score={"northgate": 1}))
    assert steps[-1].startswith("Camera:")
    assert cited == ["e1"]


def test_plan_ends_with_the_camera_step(flow) -> None:
    steps, _cited = broadcast.plan(flow._ctx())
    assert steps and steps[-1].startswith("Camera:")


def test_empty_match_gives_quiet_picks_without_crashing() -> None:
    ctx = synthetic([], score={})
    assert broadcast.highlights(ctx) == []
    assert broadcast.focus(ctx)["target"] == "zone"
    steps, cited = broadcast.plan(ctx)
    assert steps and cited == []


def test_broadcast_surface_answers_highlights_with_citations(assistant, flow) -> None:
    result = run(assistant.ask(flow, "What are the highlights?", "broadcast", surface="broadcast"))
    assert result.intent == "highlights" and not result.abstained
    assert result.broadcast and result.broadcast["highlights"]
    assert all(c["type"] == "event" for c in result.citations)


def test_broadcast_surface_keeps_the_routers_declines(assistant, flow) -> None:
    result = run(
        assistant.ask(flow, "Write a story about Ivan Ruiz", "broadcast", surface="broadcast")
    )
    assert result.broadcast is None


def test_ask_surface_is_unchanged_for_plain_questions(assistant, flow) -> None:
    result = run(
        assistant.ask(flow, "How many shots has Northgate FC had so far?", surface="broadcast")
    )
    assert result.broadcast is None


def test_default_surface_ignores_broadcast_cues(assistant, flow) -> None:
    result = run(assistant.ask(flow, "What are the highlights?"))
    assert result.broadcast is None
