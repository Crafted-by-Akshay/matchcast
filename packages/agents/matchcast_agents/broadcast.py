"""Broadcast Copilot picks: highlights, camera focus and a plan, ranked in code (ADR-0018).

No model is called here. Every minute comes from an event's clock, every name from the roster
and every score from the match state, so the picks repeat and the Verifier has nothing to guess.
"""

import re
from typing import Any

from .context import MatchContext
from .rules.producer import moment_score

HIGHLIGHT_MIN = 40  # a passage scoring below this is not worth airing
FOCUS_WINDOW_MS = 180_000  # focus and the plan look back three minutes of match time
CUES = {
    "highlights": re.compile(r"\bhighlights?\b|\bbest (moments?|bits)\b", re.IGNORECASE),
    "focus": re.compile(r"\b(where (to|should) (the )?camera|camera|focus on|next story)\b", re.I),
    "plan": re.compile(r"\b(production plan|strategy|rundown|what next|plan for the next)\b", re.I),
}


def intent_for(question: str) -> str | None:
    """The Broadcast intent a question asks for, or None for a plain question about the match."""
    return next((name for name, cue in CUES.items() if cue.search(question)), None)


def _now(ctx: MatchContext) -> int:
    return ctx.events[-1]["event_time_ms"] if ctx.events else 0


def _moments(ctx: MatchContext) -> list[tuple[dict[str, Any], float, str]]:
    scored = []
    for event in ctx.events:
        score, _priority, kind = moment_score(event["payload"])
        scored.append((event, float(score), kind))
    return scored


def _label(event: dict[str, Any], kind: str) -> str:
    if kind == "goal" and event["payload"].get("own_goal"):
        return "Own goal"
    if kind == "period_end":
        return "Full time" if event["clock"]["period"] > 1 else "Half time"
    return {
        "goal": "Goal",
        "red_card": "Red card",
        "yellow_card": "Yellow card",
        "shot_on_target": "Shot on target",
    }.get(kind, kind.replace("_", " ").capitalize())


def _pick(ctx: MatchContext, event: dict[str, Any], score: float, kind: str) -> dict[str, Any]:
    payload = event["payload"]
    minute = event["event_time_ms"] // 60_000
    label = _label(event, kind)
    own_goal = kind == "goal" and bool(payload.get("own_goal"))
    # An own goal names the side it helps, never a player to put on camera as the hero.
    player_id = None if own_goal else payload.get("player_id")
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


def highlights(
    ctx: MatchContext, limit: int = 5, within_ms: int | None = None
) -> list[dict[str, Any]]:
    """The strongest passages of play, best first (ties go to the later one).

    ``within_ms`` keeps only moments that happened that long before the last event."""
    now = _now(ctx)
    picks = [
        _pick(ctx, e, s, k)
        for e, s, k in _moments(ctx)
        if s >= HIGHLIGHT_MIN and (within_ms is None or now - e["event_time_ms"] <= within_ms)
    ]
    picks.sort(key=lambda p: (-p["score"], -p["minute"]))
    return picks[:limit]


def focus(ctx: MatchContext) -> dict[str, Any]:
    """Where the camera or story goes next: the best recent player moment, else a wide shot."""
    now = _now(ctx)
    recent = [
        (e, s, k)
        for e, s, k in _moments(ctx)
        if now - e["event_time_ms"] <= FOCUS_WINDOW_MS and s >= HIGHLIGHT_MIN and _pick_player(e, k)
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


def _pick_player(event: dict[str, Any], kind: str) -> str | None:
    """The player a moment puts on camera, or None (an own goal names no hero)."""
    if kind == "goal" and event["payload"].get("own_goal"):
        return None
    return event["payload"].get("player_id")


def plan(ctx: MatchContext) -> tuple[list[str], list[str]]:
    """Production steps for the next few minutes, and the event ids they cite."""
    steps: list[str] = []
    cited: list[str] = []
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
    focus_pick = focus(ctx)
    if "event_id" in focus_pick:
        cited.append(focus_pick["event_id"])
    top = highlights(ctx, limit=1, within_ms=FOCUS_WINDOW_MS)
    if top and top[0]["event_id"] not in cited:
        steps.append(f"Air this next: {top[0]['reason']}")
        cited.append(top[0]["event_id"])
    steps.append(f"Camera: {focus_pick['reason']}")
    return steps, cited
