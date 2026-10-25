"""Follow my player (CREW-7.7): a standing storyline for one fictional player, from events."""

from dataclasses import replace

from matchcast_agents.context import MatchContext
from matchcast_agents.memory import storylines
from matchcast_agents.messages import LineRecord
from matchcast_agents.player_story import (
    PlayerStory,
    quiet_summary,
    story_line,
    total_check,
    totals,
)
from matchcast_agents.state import MatchState
from matchcast_agents.verify.checks import extract_numbers


def context(match, events=None) -> MatchContext:
    events = tuple(events if events is not None else match["events"])
    state = MatchState(max_sequence=max(e["stream_sequence"] for e in events))
    return MatchContext(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        state=state,
        events=events,
    )


def involved(match) -> dict[str, dict]:
    """The first event that names each player, so a test can pick a real one."""
    first: dict[str, dict] = {}
    for event in match["events"]:
        pid = event["payload"].get("player_id")
        if pid and pid not in first:
            first[pid] = event
    return first


def goal_event(match) -> dict:
    return next(e for e in match["events"] if e["payload"]["type"] == "goal")


def test_totals_are_recounted_up_to_the_sequence(match) -> None:
    goal = goal_event(match)
    player = goal["payload"]["player_id"]
    upto = goal["stream_sequence"]
    assert totals(match["events"], player, upto)["goals"] == 1
    assert totals(match["events"], player, upto - 1)["goals"] == 0
    assert all(v == 0 for v in totals(match["events"], player, 0).values())


def test_goal_line_carries_one_running_total(match) -> None:
    goal = goal_event(match)
    player = goal["payload"]["player_id"]
    ctx = context(match)
    story = PlayerStory(player_id=player)
    line = story_line(ctx, goal, story)
    assert line is not None
    assert ctx.player_name(player) in line
    assert extract_numbers(line) == [1.0]  # one total, within the casual persona's one-number limit
    assert len(line) <= 140


def test_a_line_about_another_player_is_not_written(match) -> None:
    goal = goal_event(match)
    other = next(p for p in involved(match) if p != goal["payload"]["player_id"])
    assert story_line(context(match), goal, PlayerStory(player_id=other)) is None


def test_switching_player_keeps_the_match_and_recounts_for_the_new_player(match) -> None:
    goal = goal_event(match)
    scorer = goal["payload"]["player_id"]
    other = next(p for p in involved(match) if p != scorer)
    story = PlayerStory(player_id=scorer)
    switched = story.switch(other)
    assert switched.player_id == other
    assert totals(match["events"], other, goal["stream_sequence"])["goals"] == 0
    assert story.player_id == scorer  # the old story is unchanged, nothing restarted


def test_quiet_spell_summary_comes_from_memory_only(match) -> None:
    goal = goal_event(match)
    player = goal["payload"]["player_id"]
    base = context(match)
    verified = LineRecord(
        line_id="l1",
        moment_id=f"m-{goal['event_id']}",
        claim_ids=[],
        persona="casual",
        text=f"{base.player_name(player)} scores after a slick move.",
        status="verified",
        created_at="2026-10-25T14:00:00Z",
        snapshot_revision=0,
    )
    ctx = replace(base, extra={"storylines": storylines(base, [verified])})
    last_minute = goal["event_time_ms"] // 60_000
    story = PlayerStory(player_id=player)
    summary = quiet_summary(ctx, story, now_ms=(last_minute + 10) * 60_000)
    assert summary is not None
    assert base.player_name(player) in summary
    assert extract_numbers(summary) == [float(last_minute)]
    # not quiet for ten minutes yet, or nothing remembered: no summary airs
    assert quiet_summary(ctx, story, now_ms=(last_minute + 5) * 60_000) is None
    assert quiet_summary(base, story, now_ms=(last_minute + 30) * 60_000) is None


def test_verifier_recount_accepts_the_stated_total_and_rejects_a_wrong_one(match) -> None:
    goal = goal_event(match)
    player = goal["payload"]["player_id"]
    ctx = context(match)
    story_text = story_line(ctx, goal, PlayerStory(player_id=player))
    assert story_text is not None
    assert total_check(ctx, player, "goals", goal["stream_sequence"], 1).passed
    bad = total_check(ctx, player, "goals", goal["stream_sequence"], 2)
    assert not bad.passed and "recount 1" in bad.detail
