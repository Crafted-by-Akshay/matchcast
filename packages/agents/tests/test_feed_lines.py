"""The ticker and audio description lines (AB#471, AB#454) go through the Verifier like any line."""

import asyncio

from matchcast_agents.audio_description import Window, spoken_span
from matchcast_agents.context import MatchContext
from matchcast_agents.feed_lines import (
    AUDIO,
    TICKER,
    audio_drafts,
    audio_placements,
    ctx_at,
    metric_claim,
    state_at,
    ticker_drafts,
)
from matchcast_agents.messages import DraftLine
from matchcast_agents.rules.verifier import VerifierRules
from matchcast_agents.state import MatchState


def ctx(match, events=None) -> MatchContext:
    return MatchContext(
        match["roster"]["stream"],
        match["roster"],
        match["names"],
        match["teams"],
        MatchState(),
        tuple(match["events"] if events is None else events),
    )


def verdict(context: MatchContext, line: DraftLine, claims: list[dict]):
    """The Verifier's verdict, judged at the line's own cut, as the workflow judges it on air."""
    upto = claims[0]["max_evidence_sequence"]
    return asyncio.run(VerifierRules().check(ctx_at(context, upto), line, claims))


def test_every_ticker_line_passes_the_verifier_with_its_score_claims(match) -> None:
    drafts = ticker_drafts(ctx(match))
    assert drafts, "the fixture has goals and cards, so the ticker has lines"
    for line, claims in drafts:
        assert line.persona == TICKER
        assert verdict(ctx(match), line, claims).verdict == "verified", line.text


def test_a_ticker_line_with_a_wrong_score_claim_is_refused(match) -> None:
    line, claims = next(
        (line, c)
        for line, c in ticker_drafts(ctx(match))
        if c and line.text.endswith("Harbour United")
    )
    wrong = [dict(c, value=c["value"] + 1) for c in claims]
    result = verdict(ctx(match), line, wrong)
    assert result.verdict == "rejected" and result.reason_code == "number_mismatch"


def test_a_goal_line_quotes_the_score_as_of_its_own_event(match) -> None:
    # the first goal (e10) reads 0-1: a claim taken at the end of the match would read 1-2
    line, claims = next(
        (line, c) for line, c in ticker_drafts(ctx(match)) if line.line_id == "line-ticker-e10"
    )
    assert line.text.endswith("Northgate FC 0-1 Harbour United")
    assert {c["metric"]: c["value"] for c in claims} == {"goals:home": 0, "goals:away": 1}
    assert all(c["snapshot"]["max_evidence_sequence"] == 10 for c in claims)


def test_a_card_line_is_backed_by_the_counters_its_card_moves(match) -> None:
    line, claims = next(
        (line, c) for line, c in ticker_drafts(ctx(match)) if "Red card" in line.text
    )
    assert [c["metric"] for c in claims] == ["cards:away", "red_cards:away"]
    assert line.claim_ids == tuple(c["claim_id"] for c in claims)
    assert verdict(ctx(match), line, claims).verdict == "verified"


def test_the_score_claim_is_recounted_from_the_events_not_from_state(match) -> None:
    state = state_at(ctx(match), 35)
    claim = metric_claim(ctx(match), 1, "goals:away", state, 35)
    assert claim["value"] == 2
    assert claim["units"] == "count"


def test_every_audio_line_passes_the_verifier_and_is_backed_by_its_counter(match) -> None:
    drafts = audio_drafts(ctx(match), [Window(0, 3_000_000)])
    assert drafts, "the fixture has described events that fit a gap"
    for line, claims in drafts:
        assert line.persona == AUDIO
        assert claims and line.claim_ids
        assert verdict(ctx(match), line, claims).verdict == "verified", line.text


def test_an_audio_line_with_no_gap_is_not_written(match) -> None:
    assert audio_drafts(ctx(match), []) == []


def test_two_described_events_in_one_gap_never_talk_over_each_other(match) -> None:
    # e9 (a shot at 36.9 s) takes the gap first; e10 (the goal at 37.8 s) then starts too late
    placed = sorted(
        audio_placements(ctx(match), [Window(0, 3_000_000)]), key=lambda d: d.speak_at_ms
    )
    assert "e9" in {d.source_event_id for d in placed}
    spans = [(d.speak_at_ms, d.speak_at_ms + spoken_span(0, d.text)[1]) for d in placed]
    assert all(end <= start for (_, end), (start, _) in zip(spans, spans[1:]))


def test_checked_against_the_end_of_the_match_an_early_line_is_stale(match) -> None:
    # the freshness rule: a line must be judged at its own cut, or its claims are old
    line, claims = next(
        (line, c) for line, c in ticker_drafts(ctx(match)) if line.line_id == "line-ticker-e10"
    )
    last = max(e["stream_sequence"] for e in match["events"])
    result = asyncio.run(VerifierRules().check(ctx_at(ctx(match), last), line, claims))
    assert result.verdict == "rejected" and result.reason_code == "stale_state"


def test_goal_lines_wait_while_a_goal_is_retracted_but_card_lines_still_air(match) -> None:
    retraction = {
        "event_id": "r1",
        "stream_sequence": 9998,
        "event_time_ms": 240_000,
        "clock": {"period": 1, "period_elapsed_ms": 240_000},
        "payload": {"type": "retraction", "target_event_id": "e10"},
    }
    drafts = ticker_drafts(ctx(match, [*match["events"], retraction]))
    ids = [line.line_id for line, _ in drafts]
    assert not any(line.text.startswith(("Goal:", "Own goal")) for line, _ in drafts)
    assert "line-ticker-e109" in ids  # the red card is not affected by the goal retraction


def test_the_describer_does_not_announce_a_goal_the_engine_has_retracted(match) -> None:
    retraction = {
        "event_id": "r3",
        "stream_sequence": 9998,
        "event_time_ms": 240_000,
        "clock": {"period": 1, "period_elapsed_ms": 240_000},
        "payload": {"type": "retraction", "target_event_id": "e10"},
    }
    placed = audio_placements(ctx(match, [*match["events"], retraction]), [Window(0, 3_000_000)])
    assert "e10" not in {d.source_event_id for d in placed}


def test_a_goal_described_after_its_deadline_is_not_written(match) -> None:
    # the only gap starts 5 s after the goal at 37.8 s: a late goal line is not written
    late_only = [Window(42_778, 60_000)]
    lines = [line.line_id for line, _ in audio_drafts(ctx(match), late_only)]
    assert "line-audio-e10" not in lines


def test_the_describer_does_not_announce_a_goal_the_engine_has_corrected(match) -> None:
    correction = {
        "event_id": "c3",
        "stream_sequence": 9998,
        "event_time_ms": 240_000,
        "clock": {"period": 1, "period_elapsed_ms": 240_000},
        "payload": {"type": "correction", "target_event_id": "e10"},
    }
    placed = audio_placements(ctx(match, [*match["events"], correction]), [Window(0, 3_000_000)])
    assert "e10" not in {d.source_event_id for d in placed}


def test_a_late_goal_reserves_no_gap_so_the_lines_after_it_keep_their_times(match) -> None:
    # e10 (37.8 s) is placed late, its only gap starting at 41 s, so it must not move the lines
    # after it: their times match a match without e10 at all
    window = [Window(41_000, 3_000_000)]
    with_goal = audio_placements(ctx(match), window)
    assert "e10" not in {d.source_event_id for d in with_goal}
    without = [e for e in match["events"] if e["event_id"] != "e10"]
    alone = audio_placements(ctx(match, without), window)
    times = {d.source_event_id: d.speak_at_ms for d in with_goal}
    assert times == {d.source_event_id: d.speak_at_ms for d in alone}


def test_a_goal_correction_holds_every_score_line_while_the_recount_counts_it(match) -> None:
    correction = {
        "event_id": "c4",
        "stream_sequence": 9998,
        "event_time_ms": 240_000,
        "clock": {"period": 1, "period_elapsed_ms": 240_000},
        "payload": {"type": "correction", "target_event_id": "e10"},
    }
    drafts = ticker_drafts(ctx(match, [*match["events"], correction]))
    assert not any(line.text.startswith(("Goal:", "Own goal")) for line, _ in drafts)
    assert "line-ticker-e109" in [line.line_id for line, _ in drafts]


def test_a_goal_is_not_displaced_by_an_earlier_shot_in_the_same_gap(match) -> None:
    # e9 (a shot at 36.9 s) comes before the goal e10 (37.8 s) in the stream: the goal goes first,
    # so it is spoken on time and the shot is placed after it or not at all
    window = [Window(36_000, 3_000_000)]
    placed = {d.source_event_id: d for d in audio_placements(ctx(match), window)}
    assert "e10" in placed
    assert placed["e10"].late is False
    assert placed["e10"].speak_at_ms == match_event_time(match, "e10")


def test_a_non_goal_more_than_ten_seconds_late_is_not_written(match) -> None:
    # e4 is a tackle at 17.9 s; the only gap starts at 36 s, 18 s later: it is not described
    placed = audio_placements(ctx(match), [Window(36_000, 3_000_000)])
    assert "e4" not in {d.source_event_id for d in placed}


def match_event_time(match, event_id: str) -> int:
    return next(e for e in match["events"] if e["event_id"] == event_id)["event_time_ms"]
