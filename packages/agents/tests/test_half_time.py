"""Half-time explainer (CREW-7.4, AB#465): cut at the first half, quote only first-half numbers."""

from matchcast_agents import half_time
from matchcast_agents.context import MatchContext
from matchcast_agents.feeds import FEEDS
from matchcast_agents.state import MatchState

HOME, AWAY = "northgate", "southfield"
MAX_SECONDS = next(f.max_seconds for f in FEEDS if f.key == "half_time")


def ev(seq, at_ms, payload, period=1):
    return {
        "stream_sequence": seq,
        "event_id": f"e{seq}",
        "event_time_ms": at_ms,
        "clock": {"period": period, "period_elapsed_ms": at_ms},
        "payload": payload,
    }


def goal(seq, at_ms, team, player, own_goal=False, period=1):
    payload = {"type": "goal", "team_id": team, "player_id": player, "own_goal": own_goal}
    return ev(seq, at_ms, payload, period)


def shot(seq, at_ms, team, on_target, period=1):
    payload = {"type": "shot", "team_id": team, "player_id": "r4", "on_target": on_target}
    return ev(seq, at_ms, payload, period)


def boundary(seq, at_ms, period):
    return ev(seq, at_ms, {"type": "period_boundary", "boundary": "ended"}, period)


def retraction(seq, target):
    return ev(seq, 13 * 60_000, {"type": "retraction", "target_event_id": target, "reason": "x"})


def correction(seq, target):
    return ev(seq, 13 * 60_000, {"type": "correction", "target_event_id": target})


HALF_END = boundary(90, 45 * 60_000, period=1)


def ctx(events, names=None, clubs=None):
    return MatchContext(
        stream={"stream_id": "demo"},
        roster={"team_ids": [HOME, AWAY]},
        names=names or {"h9": "Tom Hale", "r4": "Ruben Ortiz"},
        clubs=clubs or {HOME: "Northgate", AWAY: "Southfield"},
        state=MatchState(),
        events=tuple(events),
    )


def first_half():
    return [
        goal(1, 12 * 60_000, HOME, "h9"),
        shot(2, 20 * 60_000, HOME, True),
        shot(3, 30 * 60_000, HOME, False),
        shot(4, 40 * 60_000, AWAY, True),
        HALF_END,
    ]


def second_half():
    return [
        goal(91, 50 * 60_000, AWAY, "a1", period=2),
        shot(92, 60 * 60_000, AWAY, True, period=2),
        shot(93, 70 * 60_000, AWAY, True, period=2),
        shot(94, 80 * 60_000, AWAY, True, period=2),
        boundary(95, 90 * 60_000, period=2),
    ]


def test_no_piece_until_the_first_half_has_ended() -> None:
    assert half_time.build(ctx(first_half()[:-1])) is None


def test_a_full_time_boundary_alone_is_not_the_half_time_cut() -> None:
    assert half_time.build(ctx([boundary(5, 90 * 60_000, period=2)])) is None


def test_the_cut_is_the_end_of_the_first_half() -> None:
    piece = half_time.build(ctx(first_half() + second_half()))
    assert piece.cut_sequence == 90
    assert "At half-time, Northgate 1, Southfield 0." in piece.text
    assert "Tom Hale" in piece.text and "a1" not in piece.text


def test_second_half_events_never_change_the_piece() -> None:
    alone = half_time.build(ctx(first_half()))
    full = half_time.build(ctx(first_half() + second_half()))
    assert alone.text == full.text


def test_numbers_are_the_first_half_counts() -> None:
    piece = half_time.build(ctx(first_half() + second_half()))
    assert "Shots: Northgate 2 (1 on target), Southfield 1 (1 on target)." in piece.text
    assert "Southfield 4" not in piece.text


def test_goal_sentences_name_the_scorer_from_the_roster() -> None:
    piece = half_time.build(ctx(first_half()))
    assert piece.sentences[1] == ("Tom Hale scored for Northgate.", ("goals:northgate",))


def test_each_sentence_lists_exactly_the_metrics_it_quotes() -> None:
    piece = half_time.build(ctx(first_half()))
    headline, goal_line, shots, closing = (metrics for _, metrics in piece.sentences)
    assert headline == (f"goals:{HOME}", f"goals:{AWAY}")
    assert goal_line == (f"goals:{HOME}",)
    assert shots == (
        f"shots:{HOME}",
        f"shots:{AWAY}",
        f"shots_on_target:{HOME}",
        f"shots_on_target:{AWAY}",
    )
    assert closing == (f"shots:{HOME}", f"shots:{AWAY}")


def test_the_closing_line_names_the_side_with_more_shots() -> None:
    home_lead = half_time.build(ctx(first_half()))
    away_lead = half_time.build(
        ctx(
            [
                shot(1, 10 * 60_000, HOME, True),
                shot(2, 20 * 60_000, AWAY, True),
                shot(3, 30 * 60_000, AWAY, False),
                HALF_END,
            ]
        )
    )
    level = half_time.build(
        ctx([shot(1, 10 * 60_000, HOME, True), shot(2, 20 * 60_000, AWAY, True), HALF_END])
    )
    assert home_lead.sentences[-1][0] == "Northgate had more of the shots."
    assert away_lead.sentences[-1][0] == "Southfield had more of the shots."
    assert level.sentences[-1][0] == "The shots were level."


def test_own_goals_count_in_the_score_and_are_not_named() -> None:
    events = [goal(1, 10 * 60_000, HOME, "a1", own_goal=True), HALF_END]
    piece = half_time.build(ctx(events))
    assert "At half-time, Northgate 1, Southfield 0." in piece.text
    assert "a1" not in piece.text
    assert "e1" in piece.source_event_ids


def test_only_three_goals_are_named_and_the_fourth_is_left_out() -> None:
    names = {"h1": "Alpha Player", "h2": "Beta Player", "h3": "Gamma Player", "h4": "Delta Player"}
    events = [goal(i, i * 60_000, HOME, f"h{i}") for i in range(1, 5)] + [HALF_END]
    piece = half_time.build(ctx(events, names=names))
    assert len(piece.sentences) == 6  # headline, three goals, shots, closing
    assert "Gamma Player scored for Northgate." in piece.text
    assert "Delta Player" not in piece.text
    assert "e4" in piece.source_event_ids  # the fourth goal is counted, only not named


def test_a_retracted_goal_is_not_counted_or_named() -> None:
    events = [*first_half()[:1], retraction(5, "e1"), *first_half()[1:]]
    piece = half_time.build(ctx(events))
    assert "At half-time, Northgate 0, Southfield 0." in piece.text
    assert "Tom Hale" not in piece.text
    assert "e1" not in piece.source_event_ids


def test_a_retraction_after_the_cut_still_removes_the_goal() -> None:
    piece = half_time.build(ctx([*first_half(), *second_half(), retraction(96, "e1")]))
    assert "At half-time, Northgate 0, Southfield 0." in piece.text
    assert "Tom Hale" not in piece.text


def test_a_correction_to_a_first_half_event_holds_the_piece() -> None:
    assert half_time.build(ctx([*first_half(), correction(5, "e1")])) is None


def test_a_correction_after_the_cut_also_holds_the_piece() -> None:
    assert half_time.build(ctx([*first_half(), correction(96, "e1")])) is None


def test_a_retracted_half_time_boundary_gives_no_piece() -> None:
    assert half_time.build(ctx([*first_half(), retraction(96, "e90")])) is None


def test_a_retracted_half_time_boundary_gives_no_piece_even_with_a_later_end() -> None:
    later = boundary(120, 47 * 60_000, period=1)
    assert half_time.build(ctx([*first_half(), retraction(96, "e90"), later])) is None


def test_a_correction_to_a_second_half_event_does_not_hold_the_piece() -> None:
    alone = half_time.build(ctx([*first_half(), *second_half()]))
    corrected = half_time.build(ctx([*first_half(), *second_half(), correction(96, "e91")]))
    assert corrected is not None
    assert corrected.text == alone.text


def test_a_started_boundary_is_not_the_half_time_cut() -> None:
    started = ev(90, 45 * 60_000, {"type": "period_boundary", "boundary": "started"}, period=1)
    assert half_time.build(ctx([goal(1, 12 * 60_000, HOME, "h9"), started])) is None


def test_the_earliest_ended_boundary_is_the_cut() -> None:
    later = boundary(120, 47 * 60_000, period=1)
    piece = half_time.build(ctx([*first_half(), later]))
    assert piece.cut_sequence == 90


def test_a_period_two_event_with_an_early_sequence_stays_out() -> None:
    late_goal = goal(2, 55 * 60_000, AWAY, "a1", period=2)
    piece = half_time.build(ctx([goal(1, 12 * 60_000, HOME, "h9"), late_goal, HALF_END]))
    assert "At half-time, Northgate 1, Southfield 0." in piece.text
    assert "Tom Hale" in piece.text
    assert "a1" not in piece.text
    assert "e2" not in piece.source_event_ids


def test_the_piece_fits_the_feed_spoken_limit() -> None:
    piece = half_time.build(ctx(first_half()))
    assert piece.word_count == len(piece.text.split())
    assert piece.seconds <= MAX_SECONDS


def test_long_names_trim_the_last_named_goal_to_the_limit() -> None:
    long_tail = " ".join(["Marcus"] * 70)
    names = {"h9": f"Alpha {long_tail}", "h8": f"Beta {long_tail}", "h7": f"Gamma {long_tail}"}
    events = [
        goal(1, 10 * 60_000, HOME, "h9"),
        goal(2, 20 * 60_000, HOME, "h8"),
        goal(3, 30 * 60_000, HOME, "h7"),
        boundary(90, 45 * 60_000, period=1),
    ]
    piece = half_time.build(ctx(events, names=names))
    assert piece.word_count <= half_time.WORD_LIMIT
    assert "Beta" in piece.text and "Gamma" not in piece.text  # the third goal is the one dropped
    assert piece.sentences[-2][0].startswith("Shots:")  # the closing lines always stay
    assert len(piece.sentences) == 5  # headline, two goals, shots, closing


def test_a_club_name_too_long_to_fit_gives_no_piece() -> None:
    clubs = {HOME: " ".join(["Northgate"] * 300), AWAY: "Southfield"}
    assert half_time.build(ctx(first_half(), clubs=clubs)) is None


def test_source_events_are_the_counted_first_half_events_and_the_half_time_event() -> None:
    piece = half_time.build(ctx(first_half() + second_half()))
    assert piece.source_event_ids == ("e1", "e2", "e3", "e4", "e90")


def test_source_events_follow_the_stream_order_not_the_list_order() -> None:
    events = [shot(2, 20 * 60_000, HOME, True), goal(1, 12 * 60_000, HOME, "h9"), HALF_END]
    piece = half_time.build(ctx(events))
    assert piece.source_event_ids == ("e1", "e2", "e90")


def test_a_goalless_scoreless_half_still_cites_the_half_time_event() -> None:
    piece = half_time.build(ctx([HALF_END]))
    assert piece.source_event_ids == ("e90",)
    assert piece.text.startswith("At half-time, Northgate 0, Southfield 0.")
