"""Storylines that pay off later (CREW-3.2) and the replan when the match goes quiet (CREW-1.2)."""

from matchcast_agents.storyline import (
    FALLBACK_PLAN,
    StorylineBook,
    pick_plan,
)


def goal(seq: int, minute: int, player: str) -> dict:
    return {
        "stream_sequence": seq,
        "event_id": f"e{seq}",
        "event_time_ms": minute * 60_000,
        "payload": {"type": "goal", "player_id": player, "team_id": "home"},
    }


def shot(seq: int, minute: int, player: str) -> dict:
    return {
        "stream_sequence": seq,
        "event_id": f"e{seq}",
        "event_time_ms": minute * 60_000,
        "payload": {"type": "shot", "player_id": player, "team_id": "home", "on_target": False},
    }


def test_a_payoff_airs_once_and_cites_both_events() -> None:
    book = StorylineBook()
    book.open("home9", shot(4, 12, "home9"), "shoots wide")
    payoff = book.on_goal(goal(90, 78, "home9"))
    assert payoff is not None
    assert payoff.cites == (4, 90)
    assert "minute 78" in payoff.text and "minute 12" in payoff.text
    assert book.on_goal(goal(95, 80, "home9")) is None  # never again


def test_a_payoff_that_never_happens_closes_at_full_time_with_a_summary() -> None:
    book = StorylineBook()
    book.open("home9", shot(4, 12, "home9"), "shoots wide")
    assert book.on_goal(goal(90, 78, "away2")) is None  # someone else scores: no payoff
    summary = book.close_at_full_time()
    assert [entry["status"] for entry in summary] == ["closed"]
    assert book.close_at_full_time() == []  # closing again adds nothing


def test_pick_plan_prefers_the_player_with_most_remembered_beats() -> None:
    memory = {"player:a": ({}, {}), "player:b": ({}, {}, {}), "club:x": ({},)}
    assert pick_plan(memory) == "player:b"
    assert pick_plan({}) == FALLBACK_PLAN
