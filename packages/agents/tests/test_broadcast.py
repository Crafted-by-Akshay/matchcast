"""Broadcast Copilot picks (ADR-0018): ranked in code, cited to events, never on the live loop."""

from pathlib import Path

import pytest
from conftest import run
from matchcast_agents import broadcast
from matchcast_agents.ask import Assistant, Bm25Index, load_kb

KB = Path(__file__).parents[3] / "kb"


@pytest.fixture(scope="module")
def assistant():
    return Assistant(Bm25Index(load_kb(KB)))


@pytest.fixture
def flow(make_workflow, match):
    flow = make_workflow()
    run(flow.ingest(match["events"]))
    return flow


def test_intents_are_read_from_the_question() -> None:
    assert broadcast.intent_for("Give me the highlights so far") == "highlights"
    assert broadcast.intent_for("Where should the camera go next?") == "focus"
    assert broadcast.intent_for("What is the production plan for the next ten minutes?") == "plan"
    assert broadcast.intent_for("How many shots has Northgate FC had?") is None


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


def test_focus_points_at_a_recent_player_or_falls_back_to_a_wide_shot(flow) -> None:
    pick = broadcast.focus(flow._ctx())
    assert pick["camera"] in {"player", "wide"}
    if pick["target"] == "player":
        assert pick["player_id"] and pick["event_id"]
    else:
        assert pick["camera"] == "wide"


def test_plan_ends_with_the_camera_step(flow) -> None:
    steps = broadcast.plan(flow._ctx())
    assert steps and steps[-1].startswith("Camera:")


def test_broadcast_surface_answers_highlights_with_citations(assistant, flow) -> None:
    result = run(assistant.ask(flow, "What are the highlights?", "broadcast", surface="broadcast"))
    assert result.intent == "highlights" and not result.abstained
    assert result.broadcast and result.broadcast["highlights"]
    assert all(c["type"] == "event" for c in result.citations)


def test_ask_surface_is_unchanged_for_plain_questions(assistant, flow) -> None:
    result = run(
        assistant.ask(flow, "How many shots has Northgate FC had so far?", surface="broadcast")
    )
    assert result.broadcast is None


def test_default_surface_ignores_broadcast_cues(assistant, flow) -> None:
    result = run(assistant.ask(flow, "What are the highlights?"))
    assert result.broadcast is None
