"""Audio description (CREW-7.2, AB#454): a describer speaks only in the commentary gaps."""

import copy

from matchcast_agents.audio_description import (
    GOAL_DEADLINE_MS,
    MIN_GAP_MS,
    Window,
    describe,
    gaps,
    spoken_span,
    x_third,
    y_side,
)
from matchcast_agents.context import MatchContext
from matchcast_agents.state import MatchState


def ctx(match) -> MatchContext:
    return MatchContext(
        match["roster"]["stream"], match["roster"], match["names"], match["teams"], MatchState(), ()
    )


def event(match, event_id: str) -> dict:
    return next(e for e in match["events"] if e["event_id"] == event_id)


def test_a_gap_of_two_seconds_is_the_shortest_that_speaks() -> None:
    assert MIN_GAP_MS == 2_000
    assert gaps([(0, 5_000), (6_999, 9_000)], end_ms=9_000) == []  # a 1999 ms gap is silent
    assert gaps([(0, 5_000), (7_000, 9_000)], end_ms=9_000) == [Window(5_000, 7_000)]


def test_gaps_merge_overlapping_commentary_before_they_are_measured() -> None:
    spans = [(0, 4_000), (3_000, 6_000), (6_500, 8_000)]
    # merged, commentary runs 0-6 s and 6.5-8 s: the 0.5 s gap is too short, the tail is not
    assert gaps(spans, end_ms=10_000) == [Window(8_000, 10_000)]


def test_a_spoken_line_takes_its_words_at_the_booth_pace() -> None:
    start, end = spoken_span(1_000, "one two three four five")
    assert (start, end) == (1_000, 3_000)  # 5 words at 2.5 words a second is 2 seconds


def test_the_describer_names_the_player_and_club_the_engine_reports(match) -> None:
    shot = event(match, "e9")
    windows = [Window(0, 60_000)]
    found = describe(ctx(match), shot, windows)
    assert found is not None
    assert found.source_event_id == "e9"
    assert match["names"][shot["payload"]["player_id"]] in found.text
    assert match["teams"][shot["payload"]["team_id"]] in found.text
    assert "the first third of the pitch" in found.text


def test_the_zone_comes_from_the_engine_position_not_a_guess() -> None:
    assert x_third(10.0, 105.0) == "first"
    assert x_third(52.5, 105.0) == "middle"
    assert x_third(100.0, 105.0) == "last"
    assert y_side(10.0, 68.0) == "left"
    assert y_side(34.0, 68.0) == "centre"
    assert y_side(60.0, 68.0) == "right"


def test_no_describer_line_without_a_gap_that_fits_it(match) -> None:
    shot = event(match, "e9")
    assert describe(ctx(match), shot, []) is None
    assert describe(ctx(match), shot, [Window(0, 500)]) is None


def test_a_goal_is_described_within_three_seconds_when_a_gap_comes_in_time(match) -> None:
    goal = event(match, "e10")
    t = goal["event_time_ms"]
    found = describe(ctx(match), goal, [Window(t + 1_000, t + 10_000)])
    assert found is not None
    assert found.speak_at_ms - t <= GOAL_DEADLINE_MS
    assert found.late is False


def test_a_goal_whose_gap_comes_too_late_is_flagged_late(match) -> None:
    goal = event(match, "e10")
    t = goal["event_time_ms"]
    found = describe(ctx(match), goal, [Window(t + GOAL_DEADLINE_MS + 2_000, t + 20_000)])
    assert found is not None
    assert found.late is True


def test_an_own_goal_names_no_player(match) -> None:
    own = copy.deepcopy(event(match, "e10"))
    own["payload"]["own_goal"] = True
    found = describe(ctx(match), own, [Window(0, 60_000)])
    assert found is not None
    assert match["names"][own["payload"]["player_id"]] not in found.text
    assert found.text.startswith("Own goal, credited to Harbour United")


def test_an_event_without_a_position_is_not_described(match) -> None:
    kick_off = next(e for e in match["events"] if e["payload"]["type"] == "period_boundary")
    assert describe(ctx(match), kick_off, [Window(0, 60_000)]) is None
