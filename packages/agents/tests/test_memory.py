"""Shared match memory: only verified lines are remembered; agents see the latest two."""

from conftest import run
from matchcast_agents.context import MatchContext
from matchcast_agents.live import LiveNarrator, ScriptedModelClient
from matchcast_agents.memory import already_said, storylines
from matchcast_agents.messages import LineRecord, ProducerTask
from matchcast_agents.state import MatchState


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


def test_only_verified_lines_are_remembered(match) -> None:
    g = goal(match)
    ctx = context(
        match,
        [
            line("a", g, "A verified goal line.", "verified"),
            line("b", g, "A rejected goal line.", "rejected"),
        ],
    )
    assert [beat["text"] for beat in already_said(ctx, g["payload"])] == ["A verified goal line."]


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
