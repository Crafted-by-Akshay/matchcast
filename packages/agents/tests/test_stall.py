"""The Showrunner's stall rule (CREW-1.2): 60 s of wall time with no verified line replans once,
then falls back instead of looping. No test here runs a match."""

import pytest
from matchcast_agents.stall import STALL_S, StallClock


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> Clock:
    return Clock()


def test_the_match_waits_until_sixty_seconds_pass_without_a_line(clock) -> None:
    stall = StallClock(clock)
    clock.advance(STALL_S - 0.1)
    assert stall.next_step() == "wait"
    clock.advance(0.1)
    assert stall.next_step() == "replan"


def test_a_verified_line_resets_the_clock(clock) -> None:
    stall = StallClock(clock)
    clock.advance(45)
    stall.note_line()
    clock.advance(45)
    assert stall.next_step() == "wait"


def test_a_stall_after_a_replan_falls_back_instead_of_looping(clock) -> None:
    stall = StallClock(clock)
    clock.advance(STALL_S)
    assert stall.next_step() == "replan"
    stall.note_replan()
    assert stall.next_step() == "wait"  # the replan gets its own minute
    clock.advance(STALL_S)
    assert stall.next_step() == "fallback"
    clock.advance(STALL_S)
    assert stall.next_step() == "fallback"  # still no line: keep the rules storyline


def test_a_line_after_a_replan_starts_the_rule_again(clock) -> None:
    stall = StallClock(clock)
    clock.advance(STALL_S)
    stall.note_replan()
    stall.note_line()
    clock.advance(STALL_S)
    assert stall.next_step() == "replan"
