"""The ticker and audio description lines (AB#471, AB#454) go through the Verifier like any line."""

import asyncio

from matchcast_agents.audio_description import Window
from matchcast_agents.context import MatchContext
from matchcast_agents.feed_lines import (
    AUDIO,
    TICKER,
    audio_drafts,
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
    return asyncio.run(VerifierRules().check(context, line, claims))


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
