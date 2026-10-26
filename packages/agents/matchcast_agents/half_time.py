"""Half-time explainer (CREW-7.4, AB#465): one whole-feed piece about the first half.

Deterministic and templated, like the full-time recap. The first half is cut at the earliest
period_boundary that ends period 1; a retracted one gives no piece. Only period-1 events up to
that cut are folded, so no second-half event can reach the piece. A retraction leaves its
target out, wherever it sits in the stream. A correction to a first-half event holds the
piece (None): nothing folds corrections yet, so such a piece stays held until a fold exists.

Each sentence lists the metrics it quotes. claims() turns those metrics into claim packets
counted from the first-half events only, and drafts() turns the sentences into DraftLines
that cite those claims, so the Verifier recounts each number from the same events. feeds.py
sets the feed's 90 seconds; WORDS_PER_SECOND here turns that into a word limit. Own goals are
counted in the score but not named.
"""

from dataclasses import dataclass
from typing import Any

from .context import MatchContext
from .feeds import FEEDS
from .messages import DraftLine
from .metrics_spec import METRIC_UNITS, derivation_version
from .state import MatchState, apply

WORDS_PER_SECOND = 2.5  # spoken pace for the explainer's length check
MAX_SECONDS = next(feed.max_seconds for feed in FEEDS if feed.key == "half_time")
WORD_LIMIT = int(MAX_SECONDS * WORDS_PER_SECOND)
HALF_TIME_MAX_CHARS = 280  # one sentence of the piece, as the analyst voice's limit
MAX_GOALS_NAMED = 3
CONTROLS = ("correction", "retraction")

Sentence = tuple[str, tuple[str, ...]]  # (text, the metrics it quotes as "metric:team")


@dataclass(frozen=True)
class HalfTime:
    text: str
    sentences: tuple[Sentence, ...]
    cut_sequence: int  # the stream sequence of the half-time event
    source_event_ids: tuple[str, ...]  # the goals and shots counted, then the half-time event
    word_count: int
    seconds: float
    events: tuple[dict[str, Any], ...]  # the first-half events the piece is counted from
    state: MatchState  # the state those events give; the claims' snapshot


def half_time_event(events: tuple[dict[str, Any], ...]) -> dict[str, Any] | None:
    """The earliest period_boundary that ends period 1, or None before the half is over."""
    ended = [
        e
        for e in events
        if e["payload"]["type"] == "period_boundary"
        and e["payload"]["boundary"] == "ended"
        and e["clock"]["period"] == 1
    ]
    return min(ended, key=lambda e: e["stream_sequence"], default=None)


def first_half_state(events: tuple[dict[str, Any], ...]) -> MatchState:
    state = MatchState()
    for event in events:
        state = apply(state, event)
    return state


def _targets(events: list[dict[str, Any]], kind: str) -> set[str]:
    return {e["payload"]["target_event_id"] for e in events if e["payload"]["type"] == kind}


def _goal_sentence(ctx: MatchContext, event: dict[str, Any]) -> Sentence:
    payload = event["payload"]
    who = ctx.player_name(payload["player_id"])
    club = ctx.club_name(payload["team_id"])
    return f"{who} scored for {club}.", (f"goals:{payload['team_id']}",)


def _shots(ctx: MatchContext, state: MatchState) -> Sentence:
    h, a = ctx.home, ctx.away
    sh, sa = state.count("shots", h), state.count("shots", a)
    oh, oa = state.count("shots_on_target", h), state.count("shots_on_target", a)
    text = (
        f"Shots: {ctx.club_name(h)} {sh} ({oh} on target), "
        f"{ctx.club_name(a)} {sa} ({oa} on target)."
    )
    metrics = tuple(f"{m}:{t}" for m in ("shots", "shots_on_target") for t in (h, a))
    return text, metrics


def _closing(ctx: MatchContext, state: MatchState) -> Sentence:
    h, a = ctx.home, ctx.away
    sh, sa = state.count("shots", h), state.count("shots", a)
    metrics = (f"shots:{h}", f"shots:{a}")
    if sh == sa:
        return "The shots were level.", metrics
    lead = ctx.club_name(h if sh > sa else a)
    return f"{lead} had more of the shots.", metrics


def sentences(ctx: MatchContext, state: MatchState, goals: list[dict[str, Any]]) -> list[Sentence]:
    h, a = ctx.home, ctx.away
    headline = (
        f"At half-time, {ctx.club_name(h)} {state.count('goals', h)}, "
        f"{ctx.club_name(a)} {state.count('goals', a)}.",
        (f"goals:{h}", f"goals:{a}"),
    )
    named = [_goal_sentence(ctx, event) for event in goals[:MAX_GOALS_NAMED]]
    return [headline, *named, _shots(ctx, state), _closing(ctx, state)]


def _words(rows: list[Sentence]) -> int:
    return sum(len(text.split()) for text, _ in rows)


def build(ctx: MatchContext) -> HalfTime | None:
    """The explainer for a match's first half, or None when it is not ready to write.

    None means no piece yet: before the half is over, when the half-time boundary is retracted,
    when a first-half correction is not folded yet, or when the fixed lines alone would not
    fit the feed's limit.
    """
    ordered = sorted(ctx.events, key=lambda e: e["stream_sequence"])
    retracted = _targets(ordered, "retraction")  # controls after the cut still apply
    corrected = _targets(ordered, "correction")
    ended = half_time_event(tuple(ordered))
    if ended is None or ended["event_id"] in retracted:
        return None  # no half-time end on the ledger, or the end itself was retracted
    live = tuple(e for e in ordered if e["event_id"] not in retracted)
    cut = ended["stream_sequence"]
    first = tuple(
        e
        for e in live
        if e["stream_sequence"] <= cut
        and e["clock"]["period"] == 1
        and e["payload"]["type"] not in CONTROLS
    )
    if corrected & {e["event_id"] for e in first}:
        return None
    state = first_half_state(first)
    goals = [
        e for e in first if e["payload"]["type"] == "goal" and not e["payload"].get("own_goal")
    ]
    counted = [e["event_id"] for e in first if e["payload"]["type"] in ("goal", "shot")]
    rows = sentences(ctx, state, goals)
    # the headline and the two closing sentences stay; named goals go from the end until it fits
    while len(rows) > 3 and _words(rows) > WORD_LIMIT:
        rows.pop(-3)
    words = _words(rows)
    if words > WORD_LIMIT:
        return None
    return HalfTime(
        text=" ".join(text for text, _ in rows),
        sentences=tuple(rows),
        cut_sequence=cut,
        source_event_ids=(*counted, ended["event_id"]),
        word_count=words,
        seconds=round(words / WORDS_PER_SECOND, 1),
        events=first,
        state=state,
    )


def claims(piece: HalfTime, stream: dict[str, str]) -> list[dict[str, Any]]:
    """One claim per metric the piece quotes, counted from the first-half state."""
    snapshot = piece.state.snapshot()
    metrics = list(dict.fromkeys(m for _, quoted in piece.sentences for m in quoted))
    packets = []
    for index, metric in enumerate(metrics, start=1):
        name, _, team = metric.partition(":")
        packets.append(
            {
                "kind": "claim",
                "schema_version": "1.1.0",
                "stream": stream,
                "claim_id": f"claim-halftime-{index}",
                "source": {
                    "type": "interval",
                    "from_event_time_ms": 0,
                    "to_event_time_ms": snapshot["event_time_ms"],
                    "from_stream_sequence": 1,
                    "to_stream_sequence": snapshot["max_evidence_sequence"],
                },
                "metric": metric,
                "value": piece.state.count(name, team),
                "units": METRIC_UNITS[name],
                "derivation_version": derivation_version(name),
                "snapshot": snapshot,
                "max_evidence_sequence": snapshot["max_evidence_sequence"],
                "approval_status": "pending",
            }
        )
    return packets


def drafts(piece: HalfTime, packets: list[dict[str, Any]]) -> list[DraftLine]:
    """One DraftLine per sentence, citing the claim for each metric it quotes."""
    claim_for = {packet["metric"]: packet["claim_id"] for packet in packets}
    return [
        DraftLine(
            line_id=f"line-halftime-{index}",
            claim_ids=tuple(claim_for[metric] for metric in quoted),
            persona="half_time",
            text=text,
            max_chars=HALF_TIME_MAX_CHARS,
        )
        for index, (text, quoted) in enumerate(piece.sentences, start=1)
    ]
