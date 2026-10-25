"""Storylines that pay off later (CREW-3.2) and the replan when the match goes quiet (CREW-1.2)."""

from matchcast_agents.storyline import (
    FALLBACK_PLAN,
    StallWatch,
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


MEMORY = {"player:home9": ({}, {})}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


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


def test_stall_replans_once_and_records_the_old_and_new_plan() -> None:
    clock = Clock()
    watch = StallWatch(clock=clock, stall_s=60)
    assert watch.check(MEMORY) is None  # just started, no stall yet
    clock.now += 61
    replan = watch.check(MEMORY)
    assert replan is not None
    assert replan.old_plan is None and replan.new_plan == "player:home9"
    assert replan.specialist == "analyst" and not replan.fallback
    watch.aired()  # a verified line aired: the stall is over
    clock.now += 30
    assert watch.check(MEMORY) is None


def test_a_replan_with_no_line_falls_back_to_the_rules_twin_on_the_next_stall() -> None:
    clock = Clock()
    watch = StallWatch(clock=clock, stall_s=60)
    clock.now += 61
    watch.check(MEMORY)
    clock.now += 61
    replan = watch.check(MEMORY)
    assert replan is not None and replan.fallback
    assert replan.new_plan == FALLBACK_PLAN


def test_pick_plan_prefers_the_player_with_most_remembered_beats() -> None:
    memory = {"player:a": ({}, {}), "player:b": ({}, {}, {}), "club:x": ({},)}
    assert pick_plan(memory) == "player:b"
    assert pick_plan({}) == FALLBACK_PLAN
