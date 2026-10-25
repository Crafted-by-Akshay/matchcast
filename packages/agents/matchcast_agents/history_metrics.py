"""Pre-match history metrics (head-to-head and Elo), read from ``MatchContext.extra["history"]``.

They are reference data, not events: the Verifier recounts them from the same context the Analyst
read, so a line that quotes "played 12" or "Elo 1843" (no thousands separator) is checked like any
other number. The units
are ``count`` (Elo is the rounded rating), and the subject team only names the side asked about.
"""

from typing import Any

from .context import MatchContext

H2H = {
    "h2h_played": "played",
    "h2h_home_wins": "home_wins",
    "h2h_draws": "draws",
    "h2h_away_wins": "away_wins",
}
HISTORY_METRICS = frozenset({*H2H, "elo"})


def available(ctx: MatchContext) -> bool:
    return isinstance(ctx.extra.get("history"), dict)


def value(ctx: MatchContext, metric: str, team: str) -> int:
    """The metric as a whole number; KeyError when this match carries no such history."""
    history: dict[str, Any] = ctx.extra["history"]
    if team not in (ctx.home, ctx.away):
        raise KeyError(team)  # the subject is one of the two sides of this match
    if metric == "elo":
        side = "home" if team == ctx.home else "away"
        return int(float(history["elo"][side]) + 0.5)  # half up, not Python's half to even
    played = history["h2h"][H2H[metric]]
    if isinstance(played, bool) or int(played) != played:
        raise ValueError(played)
    return int(played)
