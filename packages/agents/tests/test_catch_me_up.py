"""Catch-me-up (CREW-7.3, AB#460): a recap on demand, from the events up to the asked minute."""

from matchcast_agents.catch_me_up import WORD_LIMIT, build
from matchcast_agents.context import MatchContext
from matchcast_agents.state import MatchState


def ctx(match, events=None, names=None) -> MatchContext:
    return MatchContext(
        match["roster"]["stream"],
        match["roster"],
        match["names"] if names is None else names,
        match["teams"],
        MatchState(),
        tuple(match["events"] if events is None else events),
    )


def scorer_sentence(match, event_id: str) -> str:
    event = next(e for e in match["events"] if e["event_id"] == event_id)
    return (
        f"{match['names'][event['payload']['player_id']]} scored for "
        f"{match['teams'][event['payload']['team_id']]}."
    )


def test_a_request_at_minute_three_uses_only_what_happened_by_then(match) -> None:
    recap = build(ctx(match), minute=3)
    assert recap is not None
    assert recap.text.startswith("After 3 minutes, Northgate FC 0-2 Harbour United.")
    # e58 is Northgate's goal at 4:17, after the cut: its scorer is not in the recap
    assert scorer_sentence(match, "e58") not in recap.text
    assert scorer_sentence(match, "e35") in recap.text


def test_the_recap_is_under_the_word_limit_of_the_feed(match) -> None:
    recap = build(ctx(match), minute=90)
    assert recap is not None
    assert WORD_LIMIT == 280
    assert recap.word_count == len(recap.text.split()) <= WORD_LIMIT


def test_the_headline_names_the_metrics_the_verifier_recounts(match) -> None:
    recap = build(ctx(match), minute=90)
    assert recap is not None
    text, metrics = recap.sentences[0]
    assert text == "After 90 minutes, Northgate FC 1-2 Harbour United."
    assert set(metrics) == {"goals:home", "goals:away"}


def test_the_three_most_important_events_are_named_in_match_order(match) -> None:
    # the fixture's three goals outrank its two cards (100 against 90 and 62), and all three fit
    recap = build(ctx(match), minute=90)
    assert recap is not None
    assert [text for text, _ in recap.sentences[1:]] == [
        scorer_sentence(match, "e10"),
        scorer_sentence(match, "e35"),
        scorer_sentence(match, "e58"),
    ]
    for _, metrics in recap.sentences:
        assert metrics, "a sentence with no metric cannot be checked, so it cannot air"


def test_a_retracted_goal_is_left_out_of_the_score_and_the_named_events(match) -> None:
    retraction = {
        "event_id": "r1",
        "stream_sequence": 9998,
        "event_time_ms": 3_000_000,
        "clock": {"period": 2, "period_elapsed_ms": 0},
        "payload": {"type": "retraction", "target_event_id": "e10"},
    }
    recap = build(ctx(match, [*match["events"], retraction]), minute=5)
    assert recap is not None
    # by minute 5 the fixture has e10, e35 and e58; with e10 retracted it reads 1-1
    assert recap.text.startswith("After 5 minutes, Northgate FC 1-1 Harbour United.")
    assert scorer_sentence(match, "e10") not in recap.text


def test_a_correction_to_an_event_before_the_cut_holds_the_recap(match) -> None:
    correction = {
        "event_id": "c1",
        "stream_sequence": 9998,
        "event_time_ms": 3_000_000,
        "clock": {"period": 2, "period_elapsed_ms": 0},
        "payload": {"type": "correction", "target_event_id": "e10"},
    }
    assert build(ctx(match, [*match["events"], correction]), minute=5) is None


def test_a_recap_too_long_for_the_limit_drops_the_lowest_ranked_events(match) -> None:
    # 95-word names: the headline and three named goals would be about 300 words, over the limit
    long_names = {key: " ".join(["Longname"] * 95) for key in match["names"]}
    recap = build(ctx(match, names=long_names), minute=90)
    assert recap is not None
    assert recap.word_count <= WORD_LIMIT
    # goals rank equal, so the most recent ones are kept and the earliest goal is dropped
    assert [text for text, _ in recap.sentences[1:]] == [
        f"{long_names['away2']} scored for Harbour United.",
        f"{long_names['home4']} scored for Northgate FC.",
    ]


def test_the_source_list_holds_the_goals_and_named_events_in_match_order(match) -> None:
    # e34 is an on-target shot before the cut: it is named, so it is cited; e58 is after it
    recap = build(ctx(match), minute=3)
    assert recap is not None
    assert "Arlo Ito had a shot on target" in recap.text
    assert recap.source_event_ids == ("e10", "e34", "e35")
