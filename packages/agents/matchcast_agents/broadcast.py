"""Broadcast Copilot picks: highlights, camera focus and a plan, ranked in code (ADR-0018).

No model is called here. Every minute comes from an event's clock, every name from the roster
and every score from the match state, so the picks repeat and the Verifier has nothing to guess.
"""

import re
from typing import Any

from .context import MatchContext
from .rules.producer import moment_score

HIGHLIGHT_MIN = 40  # a passage scoring below this is not worth airing
FOCUS_WINDOW_MS = 180_000  # focus looks back three minutes of match time
LABELS = {
    "goal": "Goal",
    "red_card": "Red card",
    "yellow_card": "Yellow card",
    "shot_on_target": "Shot on target",
    "period_end": "Half time",
}
CUES = {
    "highlights": re.compile(r"\bhighlights?\b|\bbest (moments?|bits)\b", re.IGNORECASE),
    "focus": re.compile(r"\b(focus|camera|where (to|should)|story|look at)\b", re.IGNORECASE),
    "plan": re.compile(r"\b(plan|strategy|production|rundown|what next|what should)\b", re.I),
}


def intent_for(question: str) -> str | None:
    """The Broadcast intent a question asks for, or None for a plain question about the match."""
    return next((name for name, cue in CUES.items() if cue.search(question)), None)


def _moments(ctx: MatchContext) -> list[tuple[dict[str, Any], float, str]]:
    scored = []
    for event in ctx.events:
        score, _priority, kind = moment_score(event["payload"])
        scored.append((event, float(score), kind))
    return scored


def _pick(ctx: MatchContext, event: dict[str, Any], score: float, kind: str) -> dict[str, Any]:
    payload = event["payload"]
    minute = event["event_time_ms"] // 60_000
    label = LABELS.get(kind, kind.replace("_", " ").capitalize())
    player_id = payload.get("player_id")
    team_id = payload.get("team_id")
    who = f" by {ctx.player_name(player_id)}" if player_id else ""
    club = f" for {ctx.club_name(team_id)}" if team_id else ""
    return {
        "event_id": event["event_id"],
        "minute": minute,
        "kind": kind,
        "label": label,
        "score": round(score),
        "player_id": player_id,
        "team_id": team_id,
        "reason": f"{label}{who}{club} at {minute}'. A moment worth airing now.",
    }


def highlights(ctx: MatchContext, limit: int = 5) -> list[dict[str, Any]]:
    """The strongest passages of play so far, best first (ties go to the later one)."""
    picks = [_pick(ctx, e, s, k) for e, s, k in _moments(ctx) if s >= HIGHLIGHT_MIN]
    picks.sort(key=lambda p: (-p["score"], -p["minute"]))
    return picks[:limit]


def focus(ctx: MatchContext) -> dict[str, Any]:
    """Where the camera or the story should go next: the best recent moment, else a wide shot."""
    now = ctx.events[-1]["event_time_ms"] if ctx.events else 0
    recent = [
        (e, s, k)
        for e, s, k in _moments(ctx)
        if now - e["event_time_ms"] <= FOCUS_WINDOW_MS
        and s >= HIGHLIGHT_MIN
        and e["payload"].get("player_id")
    ]
    if not recent:
        return {
            "target": "zone",
            "camera": "wide",
            "reason": "Quiet play. Hold a wide shot of the ball and the shape.",
        }
    event, score, kind = max(recent, key=lambda t: (t[1], t[0]["event_time_ms"]))
    pick = _pick(ctx, event, score, kind)
    return {
        "target": "player",
        "camera": "player",
        "player_id": pick["player_id"],
        "event_id": pick["event_id"],
        "reason": pick["reason"],
    }


def plan(ctx: MatchContext) -> list[str]:
    """Production steps for the next few minutes, from the score, the clock and the picks."""
    steps: list[str] = []
    score = ctx.state.score
    margin = score.get(ctx.home, 0) - score.get(ctx.away, 0)
    late = ctx.state.event_time_ms >= 60 * 60_000
    if margin == 0:
        steps.append("Level game: keep the camera on the two midfields and the next shot.")
    else:
        lead, trail = (ctx.home, ctx.away) if margin > 0 else (ctx.away, ctx.home)
        steps.append(f"{ctx.club_name(lead)} lead: watch for them to drop deeper.")
        if late:
            steps.append(f"{ctx.club_name(trail)} need a goal: expect a higher line and changes.")
    top = highlights(ctx, limit=1)
    if top:
        steps.append(f"Air this next: {top[0]['reason']}")
    steps.append(f"Camera: {focus(ctx)['reason']}")
    return steps
