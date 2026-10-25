"""Shared match memory: only verified lines are remembered; agents see the latest two."""

import pytest
from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.context import MatchContext
from matchcast_agents.live import LiveNarrator, LiveProducer, ScriptedModelClient
from matchcast_agents.memory import already_said, storylines
from matchcast_agents.messages import LineRecord, ProducerTask
from matchcast_agents.rules import ProducerRules
from matchcast_agents.state import MatchState
from matchcast_agents.store import MemoryStore


def goal(match) -> dict:
    return next(e for e in match["events"] if e["payload"]["type"] == "goal")


def context(match, lines: list[LineRecord]) -> MatchContext:
    ctx = MatchContext(
        match["roster"]["stream"],
        match["roster"],
        match["names"],
        match["teams"],
        MatchState(),
        tuple(match["events"]),
    )
    ctx.extra["storylines"] = storylines(ctx, lines)
    return ctx


def line(line_id: str, moment: dict, text: str, status: str) -> LineRecord:
    return LineRecord(
        line_id=line_id,
        moment_id=f"m-{moment['event_id']}",
        claim_ids=["c-1"],
        persona="casual",
        text=text,
        status=status,
        created_at="2026-10-25T12:00:00.000Z",
        snapshot_revision=1,
    )


@pytest.mark.parametrize("status", ["verified", "approved", "published"])
def test_lines_that_passed_a_check_or_a_person_are_remembered(match, status) -> None:
    g = goal(match)
    ctx = context(match, [line("a", g, "A passed goal line.", status)])
    assert [beat["text"] for beat in already_said(ctx, g["payload"])] == ["A passed goal line."]


@pytest.mark.parametrize("status", ["drafted", "verifying", "review", "rejected", "killed"])
def test_lines_not_yet_passed_are_never_remembered(match, status) -> None:
    g = goal(match)
    ctx = context(match, [line("a", g, "An unchecked goal line.", status)])
    assert already_said(ctx, g["payload"]) == []


def test_numbers_are_replaced_so_no_model_can_copy_them(match) -> None:
    g = goal(match)
    ctx = context(match, [line("a", g, "Northgate FC lead 2-1 after 37 minutes.", "verified")])
    assert already_said(ctx, g["payload"]) == [{"text": "Northgate FC lead #-# after # minutes."}]


def test_the_storylines_are_the_same_after_a_restart(match) -> None:
    store = MemoryStore()

    def build() -> MatchWorkflow:
        return MatchWorkflow(
            stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
            clubs=match["teams"], agents=rules_agents(), config=WorkflowConfig(), store=store,
            clock=fixed_clock(),
        )  # fmt: skip

    first = build()
    run(first.ingest(match["events"]))
    before = first._ctx().extra.get("storylines")
    assert before, "a goal should have left a verified line in memory"
    assert build()._ctx().extra.get("storylines") == before


def test_the_producer_is_told_what_was_already_said(match) -> None:
    g = goal(match)
    ctx = context(match, [line("a", g, "Northgate FC lead.", "verified")])
    shot = next(
        e for e in match["events"] if e["payload"]["type"] == "shot" and e["payload"]["on_target"]
    )
    client = ScriptedModelClient(
        [{"action": "narrate", "personas": ["casual"], "call_stats_desk": False, "why": "Shot."}]
    )
    run(LiveProducer(client, ProducerRules()).decide(ctx, shot))
    assert client.calls, "an on-target shot is a priority 2 moment, so the model decides it"
    assert '"already_said_about_this_play"' in client.calls[0]["user"]


def test_agents_see_at_most_the_latest_two_lines(match) -> None:
    g = goal(match)
    ctx = context(
        match,
        [line(k, g, f"Line {k}.", "published") for k in ("one", "two", "three")],
    )
    assert [beat["text"] for beat in already_said(ctx, g["payload"])] == [
        "Line two.",
        "Line three.",
    ]


def test_the_narrator_is_told_what_was_already_said(match) -> None:
    g = goal(match)
    ctx = context(match, [line("a", g, "Northgate FC lead.", "verified")])
    client = ScriptedModelClient(
        [{"lines": [{"persona": "casual", "text": "A new line about the goal."}]}]
    )
    task = ProducerTask(
        moment_id=f"m-{g['event_id']}",
        match_id=match["roster"]["stream"]["match_id"],
        event_ids=(g["event_id"],),
        up_to_sequence=g["stream_sequence"],
        priority=1,
        personas=("casual",),
        reason="goal",
    )
    claims = [{"claim_id": "c-1", "metric": "goals:home", "value": 1, "units": "count"}]
    run(LiveNarrator(client).write(ctx, task, claims))
    assert '"already_said_about_this_play"' in client.calls[0]["user"]
    assert "Northgate FC lead." in client.calls[0]["user"]
