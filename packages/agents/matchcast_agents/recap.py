"""Full-time recap (AGT-15): the same four-agent chain, run once over the finished match.

The Producer step picks the 5 to 8 highest-scoring moments, the Analyst reads final stats
from the tools, the Narrator writes one recap per persona sentence by sentence, and the
Verifier checks every sentence. A sentence that fails is dropped, never shown.
"""

from typing import Any

from .context import MatchContext
from .messages import DraftLine, Persona
from .rules.narrator import MAX_CHARS
from .rules.producer import moment_score
from .tools import InProcessTools

WORD_LIMITS: dict[str, int] = {"casual": 120, "analyst": 250, "broadcast": 150}
MIN_MOMENTS, MAX_MOMENTS = 5, 8
NARRATED = ("goal", "red_card", "yellow_card", "shot_on_target")
RECAP_METRICS = ("goals", "shots", "shots_on_target")


def pick_moments(ctx: MatchContext) -> list[dict[str, Any]]:
    """Producer step: the highest-scoring narratable events, back in match order."""
    scored = []
    for event in ctx.events:
        score, _priority, kind = moment_score(event["payload"])
        if kind in NARRATED:
            scored.append((-score, event["stream_sequence"], event))
    top = sorted(scored, key=lambda row: (row[0], row[1]))[:MAX_MOMENTS]
    return sorted((row[2] for row in top), key=lambda e: e["stream_sequence"])


def recap_metrics(ctx: MatchContext) -> list[str]:
    return [f"{m}:{t}" for m in RECAP_METRICS for t in (ctx.home, ctx.away)]


def final_claims(ctx: MatchContext, tools: InProcessTools) -> list[tuple[dict, str]]:
    """Analyst step: one claim per final stat, each citing the single tool call behind it."""
    names = recap_metrics(ctx)
    call_id, result = tools.get_metrics(names)
    snapshot = ctx.state.snapshot()
    claims = []
    for index, metric in enumerate(names, start=1):
        packet = {
            "kind": "claim",
            "schema_version": "1.1.0",
            "stream": ctx.stream,
            "claim_id": f"claim-recap-{index}",
            "source": {
                "type": "interval",
                "from_event_time_ms": 0,
                "to_event_time_ms": snapshot["event_time_ms"],
                "from_stream_sequence": 1,
                "to_stream_sequence": snapshot["max_evidence_sequence"],
            },
            "metric": metric,
            "value": result["values"][metric]["value"],
            "units": "count",
            "derivation_version": result["values"][metric]["derivation_version"],
            "snapshot": snapshot,
            "max_evidence_sequence": snapshot["max_evidence_sequence"],
            "approval_status": "pending",
        }
        claims.append((packet, call_id))
    return claims


def _moment_sentence(ctx: MatchContext, event: dict[str, Any], persona: str) -> str:
    payload = event["payload"]
    who = ctx.player_name(payload["player_id"])
    club = ctx.club_name(payload["team_id"])
    kind = moment_score(payload)[2]
    if kind == "goal":
        return {
            "casual": f"{who} scored for {club}.",
            "analyst": f"Goal: {who} ({club}).",
            "broadcast": f"{who} found the net for {club}.",
        }[persona]
    if kind == "red_card":
        return {
            "casual": f"{who} was sent off for {club}.",
            "analyst": f"Red card: {who} ({club}).",
            "broadcast": f"{club} lost {who} to a red card.",
        }[persona]
    if kind == "yellow_card":
        return {
            "casual": f"{who} was booked for {club}.",
            "analyst": f"Yellow card: {who} ({club}).",
            "broadcast": f"{who} went into the book for {club}.",
        }[persona]
    return {
        "casual": f"{who} tested the keeper for {club}.",
        "analyst": f"Shot on target: {who} ({club}).",
        "broadcast": f"{who} forced a save for {club}.",
    }[persona]


def _headline(ctx: MatchContext, v: dict[str, int], persona: str) -> tuple[str, tuple[str, ...]]:
    h, a = ctx.club_name(ctx.home), ctx.club_name(ctx.away)
    gh, ga = v[f"goals:{ctx.home}"], v[f"goals:{ctx.away}"]
    ids = (f"goals:{ctx.home}", f"goals:{ctx.away}")
    if persona == "casual":
        if gh == ga:
            return f"{h} and {a} could not be separated.", ids
        winner, loser = (h, a) if gh > ga else (a, h)
        return f"{winner} beat {loser}.", ids
    if persona == "analyst":
        return f"Final score: {h} {gh}, {a} {ga}.", ids
    return f"Full time: {h} {gh}, {a} {ga}.", ids


def _shots(ctx: MatchContext, v: dict[str, int], persona: str) -> tuple[str, tuple[str, ...]]:
    h, a = ctx.club_name(ctx.home), ctx.club_name(ctx.away)
    sh, sa = v[f"shots:{ctx.home}"], v[f"shots:{ctx.away}"]
    ids = (f"shots:{ctx.home}", f"shots:{ctx.away}")
    if persona == "analyst":
        oh, oa = v[f"shots_on_target:{ctx.home}"], v[f"shots_on_target:{ctx.away}"]
        ids += (f"shots_on_target:{ctx.home}", f"shots_on_target:{ctx.away}")
        return f"Shots (on target): {h} {sh} ({oh}), {a} {sa} ({oa}).", ids
    if persona == "broadcast":
        return f"The shots finished {h} {sh}, {a} {sa}.", ids
    lead = h if sh > sa else a if sa > sh else None
    return (f"{lead} had more of the shots." if lead else "The shot count finished level."), ids


def sentences(
    ctx: MatchContext,
    persona: Persona,
    claims: list[dict[str, Any]],
    moments: list[dict[str, Any]],
) -> list[DraftLine]:
    """Narrator step: templated sentences, each carrying only the claims it quotes."""
    by_metric = {c["metric"]: c for c in claims}
    v = {m: c["value"] for m, c in by_metric.items()}
    drafts: list[tuple[str, tuple[str, ...]]] = [_headline(ctx, v, persona)]
    for event in moments:
        team = event["payload"]["team_id"]
        drafts.append((_moment_sentence(ctx, event, persona), (f"goals:{team}",)))
    drafts.append(_shots(ctx, v, persona))
    return [
        DraftLine(
            line_id=f"line-recap-{persona}-{index}",
            claim_ids=tuple(by_metric[m]["claim_id"] for m in metrics),
            persona=persona,
            text=text,
            max_chars=MAX_CHARS[persona],
        )
        for index, (text, metrics) in enumerate(drafts, start=1)
    ]


def fit_words(kept: list[tuple[int, str]], persona: str) -> list[tuple[int, str]]:
    """Drop moment sentences from the end until the recap fits the persona's word limit."""
    limit = WORD_LIMITS[persona]
    rows = list(kept)
    while len(rows) > 2 and sum(len(t.split()) for _, t in rows) > limit:
        rows.pop(-2)  # keep the headline (first) and the closing shots sentence (last)
    return rows
