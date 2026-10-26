"""Draft lines for the fan feeds with no persona yet: the ticker (AB#471) and audio (AB#454).

The writers make the sentences. This module makes them DraftLines the Verifier checks like any
other line. Every line is backed by claims: the counters its event moves (a card is cards:team),
valued from the stored events. The Verifier's adversarial pass refuses a line it cannot decide,
and it cannot decide a line with no claim. A ticker goal also quotes the score, so it carries the
two score claims. Catch-me-up (AB#460) is a whole-feed piece and goes through the recap path.
"""

from dataclasses import replace
from typing import Any

from .audio_description import Description, Window, describe, spoken_span, take
from .context import MatchContext
from .messages import DraftLine
from .metrics_spec import METRIC_UNITS, derivation_version
from .state import MatchState, apply, counted
from .ticker import TickerItem, ticker_items
from .verify.checks import recompute

TICKER = "ticker"
AUDIO = "audio_description"
TICKER_MAX_CHARS = 140
AUDIO_MAX_CHARS = 140

Claim = dict[str, Any]


def state_at(ctx: MatchContext, upto: int) -> MatchState:
    """The match state after the events up to a stream sequence.

    The Verifier judges a claim's freshness against the context's state, so a line is checked
    against the state at its own cut (see ``ctx_at``), the way the workflow checks it when it
    airs. Checked against the end of the match, an early line is stale.
    """
    state = MatchState()
    for event in sorted(ctx.events, key=lambda e: e["stream_sequence"]):
        if event["stream_sequence"] <= upto:
            state = apply(state, event)
    return state


def ctx_at(ctx: MatchContext, upto: int) -> MatchContext:
    """The context as it stood at a stream sequence: the state and nothing later."""
    return replace(ctx, state=state_at(ctx, upto))


def metric_claim(
    ctx: MatchContext, claim_id: str, metric: str, state: MatchState, upto: int
) -> Claim:
    """A claim for one metric as of a state, valued from the stored events up to its sequence."""
    name = metric.split(":", 1)[0]
    snapshot = state.snapshot()
    snapshot["max_evidence_sequence"] = upto
    return {
        "kind": "claim",
        "schema_version": "1.1.0",
        "stream": ctx.stream,
        "claim_id": claim_id,
        "source": {
            "type": "interval",
            "from_event_time_ms": 0,
            "to_event_time_ms": state.event_time_ms,
            "from_stream_sequence": 1,
            "to_stream_sequence": upto,
        },
        "metric": metric,
        "value": recompute(ctx.events, metric, upto, ctx.home),
        "units": METRIC_UNITS[name],
        "derivation_version": derivation_version(name),
        "snapshot": snapshot,
        "max_evidence_sequence": upto,
        "approval_status": "pending",
    }


def event_metrics(payload: dict[str, Any]) -> list[str]:
    """The counters one event moves, as metric:team; a line about the event is backed by these."""
    return [f"{metric}:{team}" for metric, team in counted(payload)]


def _claims(ctx: MatchContext, line_id: str, metrics: list[str], upto: int) -> list[Claim]:
    state = state_at(ctx, upto)
    return [
        metric_claim(ctx, f"claim-{line_id}-{i}", metric, state, upto)
        for i, metric in enumerate(metrics, 1)
    ]


def _goal_retracted(ctx: MatchContext) -> bool:
    """Whether any goal in the match is retracted. The Verifier's recount still counts a retracted
    goal (quality lane: verify/checks.py recompute), so a score line after one would be refused
    as a number mismatch. The line is not written instead, and it stays unwritten until the
    recount skips retracted events."""
    targets = {
        e["payload"]["target_event_id"] for e in ctx.events if e["payload"]["type"] == "retraction"
    }
    return any(e["event_id"] in targets and e["payload"]["type"] == "goal" for e in ctx.events)


def ticker_drafts(ctx: MatchContext) -> list[tuple[DraftLine, list[Claim]]]:
    """One DraftLine per ticker item, backed by its event's counters and, on a goal, the score.

    Goal lines are not written while a goal is retracted (see _goal_retracted). Card lines are.
    """
    retracted = _goal_retracted(ctx)
    return [
        _ticker_line(ctx, item)
        for item in ticker_items(ctx)
        if not (retracted and item.kind in ("goal", "own_goal"))
    ]


def _ticker_line(ctx: MatchContext, item: TickerItem) -> tuple[DraftLine, list[Claim]]:
    event = next(e for e in ctx.events if e["event_id"] == item.source_event_id)
    upto = event["stream_sequence"]
    line_id = f"line-ticker-{item.source_event_id}"
    metrics = event_metrics(event["payload"])
    if item.kind in ("goal", "own_goal"):  # the score is in the text, so both sides are claims
        metrics = list(dict.fromkeys([f"goals:{ctx.home}", f"goals:{ctx.away}", *metrics]))
    claims = _claims(ctx, line_id, metrics, upto)
    line = DraftLine(
        line_id=line_id,
        claim_ids=tuple(c["claim_id"] for c in claims),
        persona=TICKER,
        text=item.text,
        max_chars=TICKER_MAX_CHARS,
        origin="template",
    )
    return line, claims


def audio_placements(ctx: MatchContext, windows: list[Window]) -> list[Description]:
    """The described events, placed in the gaps left after the lines before each one.

    A placed line uses its time, so a later line cannot be talked over. An event that moves no
    counter is not placed (no claim would back its line), and neither is an event a retraction or
    a correction holds: the describer must not announce what the engine has taken back.
    """
    held = {
        e["payload"]["target_event_id"]
        for e in ctx.events
        if e["payload"]["type"] in ("retraction", "correction")
    }
    free = list(windows)
    placed = []
    for event in sorted(ctx.events, key=lambda e: e["stream_sequence"]):
        if event["event_id"] in held or not event_metrics(event["payload"]):
            continue
        described = describe(ctx, event, free)
        if described is None:
            continue
        _, length = spoken_span(0, described.text)
        free = take(free, described.speak_at_ms, described.speak_at_ms + length)
        placed.append(described)
    return placed


def audio_drafts(ctx: MatchContext, windows: list[Window]) -> list[tuple[DraftLine, list[Claim]]]:
    """One DraftLine per placed description, backed by the counters of its event.

    A goal described late (its gap starts more than 3 s after it) is not written: the goal's
    description must be spoken within the deadline, so a late one would only mislead.
    """
    events = {e["event_id"]: e for e in ctx.events}
    drafts = []
    for described in audio_placements(ctx, windows):
        if described.late:
            continue
        event = events[described.source_event_id]
        line_id = f"line-audio-{event['event_id']}"
        claims = _claims(ctx, line_id, event_metrics(event["payload"]), event["stream_sequence"])
        line = DraftLine(
            line_id=line_id,
            claim_ids=tuple(c["claim_id"] for c in claims),
            persona=AUDIO,
            text=described.text,
            max_chars=AUDIO_MAX_CHARS,
            origin="template",
        )
        drafts.append((line, claims))
    return drafts
