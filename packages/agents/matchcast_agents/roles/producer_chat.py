"""The producer answers about the match so far, from the moment scores and the score."""

import re
from typing import Any

from ..context import MatchContext
from ..rules.producer import moment_score
from ..verify.checks import recompute

KEY = re.compile(r"\bkey\b|\bbiggest\b|\bmoment\b|\bhighlight", re.I)
SCORE = re.compile(r"\bscore\b|\bwinning\b|\bresult\b", re.I)
WHAT = {
    "goal": "{who} scored for {club}",
    "red_card": "{who} was sent off for {club}",
    "yellow_card": "{who} was booked for {club}",
    "shot_on_target": "{who} forced a save for {club}",
    "period_end": "the period ended",
}


def top_moments(ctx: MatchContext, n: int = 3) -> list[dict[str, Any]]:
    """The n highest-scoring narratable moments so far, best first (earliest wins a tie)."""
    scored = []
    for event in ctx.events:
        score, _priority, kind = moment_score(event["payload"])
        if kind in WHAT:
            scored.append((-score, event["stream_sequence"], kind, event))
    return [{"kind": k, "event": e, "score": -s} for s, _seq, k, e in sorted(scored)[:n]]


def producer_reply(ctx: MatchContext, utterance: str) -> tuple[str, dict[str, Any]]:
    home, away = ctx.club_name(ctx.home), ctx.club_name(ctx.away)
    if KEY.search(utterance):
        best = top_moments(ctx, 1)
        if not best:
            return "Nothing big has happened yet.", {}
        event, kind = best[0]["event"], best[0]["kind"]
        payload = event["payload"]
        who = ctx.player_name(payload.get("player_id", ""))
        club = ctx.club_name(payload.get("team_id", ctx.home))
        text = WHAT[kind].format(who=who, club=club)
        return f"The key moment so far: {text}.", {"event_id": event["event_id"], "kind": kind}
    if SCORE.search(utterance):
        upto = ctx.state.max_sequence
        gh = int(recompute(ctx.events, f"goals:{ctx.home}", upto))
        ga = int(recompute(ctx.events, f"goals:{ctx.away}", upto))
        return f"The score is {home} {gh}, {away} {ga}.", {"goals_home": gh, "goals_away": ga}
    return "Ask me for the key moment or the score.", {}
