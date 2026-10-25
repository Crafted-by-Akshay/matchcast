"""Data-only news ticker (CREW-7.5, AB#471): one line per verified goal or card.

The ticker reads the engine's events, not any written line, so a line the Verifier refused
cannot reach it. It prints no free text: the only words from the match are a player's name
and a club's name, and a card's reason is left out. A goal's line carries the running score,
counted the way state.apply counts it (an own goal credits the team on its payload).

A retraction, or a correction, of a goal or card takes that item off the ticker, and the
score then leaves the goal out too. Corrections are not folded yet, so a corrected event is
held off rather than shown wrong. Each item cites the event it came from.
"""

from dataclasses import dataclass

from .context import MatchContext
from .state import MatchState, apply

TEMPLATES = {
    "goal": "{minute}' Goal: {player} for {club}. {score}",
    "own_goal": "{minute}' Own goal, credited to {club}. {score}",
    "yellow": "{minute}' Yellow card: {player} ({club}).",
    "red": "{minute}' Red card: {player} ({club}).",
}
CONTROLS = ("correction", "retraction")


@dataclass(frozen=True)
class TickerItem:
    kind: str  # a key of TEMPLATES
    text: str
    source_event_id: str
    minute: int  # the match minute the event falls in: 1 for the first 60 s


def _minute(event_time_ms: int) -> int:
    return max(1, -(-event_time_ms // 60_000))


def ticker_items(ctx: MatchContext, upto_sequence: int | None = None) -> list[TickerItem]:
    """The ticker up to a stream sequence (all of it when None), oldest first."""
    events = sorted(
        (e for e in ctx.events if upto_sequence is None or e["stream_sequence"] <= upto_sequence),
        key=lambda e: e["stream_sequence"],
    )
    held = {e["payload"]["target_event_id"] for e in events if e["payload"]["type"] in CONTROLS}
    state = MatchState()
    items: list[TickerItem] = []
    for event in events:
        if event["event_id"] in held:
            continue  # a retracted or corrected event counts for nothing, score included
        state = apply(state, event)
        payload = event["payload"]
        if payload["type"] == "goal":
            kind = "own_goal" if payload.get("own_goal") else "goal"
            player = "" if kind == "own_goal" else ctx.player_name(payload["player_id"])
        elif payload["type"] == "card":
            kind = "yellow" if payload["colour"] == "yellow" else "red"
            player = ctx.player_name(payload["player_id"])
        else:
            continue
        score = (
            f"{ctx.club_name(ctx.home)} {state.score.get(ctx.home, 0)}-"
            f"{state.score.get(ctx.away, 0)} {ctx.club_name(ctx.away)}"
        )
        fields = {
            "minute": _minute(event["event_time_ms"]),
            "player": player,
            "club": ctx.club_name(payload["team_id"]),
            "score": score,
        }
        items.append(
            TickerItem(kind, TEMPLATES[kind].format(**fields), event["event_id"], fields["minute"])
        )
    return items
