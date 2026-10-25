"""Which moment a line is about, and which players it may name; shared by the checks and the
adversarial pass, so the two always agree on the moment."""

from typing import Any

from ..context import MatchContext

# lines that are not about one moment: the Ask answer and the full-time recap
NOT_A_MOMENT = ("ask", "line-recap")
# events whose lines are about one side's player; summaries and period ends are about both
PLAYER_MOMENTS = ("goal", "card", "shot", "tackle", "foul")


def moment_event(ctx: MatchContext, claims: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The event at the claims' evidence sequence (the latest revision of it)."""
    if not claims:
        return None
    seq = max(c["max_evidence_sequence"] for c in claims)
    return next((e for e in reversed(ctx.events) if e["stream_sequence"] == seq), None)


def moment_players(ctx: MatchContext, claims: list[dict[str, Any]]) -> set[str] | None:
    """Casefolded names of the players the moment's event allows, or None when the moment is not
    about one player (a summary or a period end). An event that names no player allows its
    team's players."""
    event = moment_event(ctx, claims)
    if event is None or event["payload"]["type"] not in PLAYER_MOMENTS:
        return None
    payload = event["payload"]
    allowed = {v for v in payload.values() if isinstance(v, str) and v in ctx.names}
    team = payload.get("team_id")
    if team and not allowed:  # an event that names no player: any player of its team
        allowed = {p["player_id"] for p in ctx.roster["players"] if p["team_id"] == team}
    return {ctx.names[pid].casefold() for pid in allowed}
