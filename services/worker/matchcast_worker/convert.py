"""Engine events to contract events v1.1 (DAT-1).

The Watch engine emits flat event dicts (`type`, `minute`, `team`, `player`, ...). This maps the
ones the contract has a payload for (goal, shot, pass, foul, card, possession change) and skips
the rest.
Players and teams become slugs, matching the browser bus (`apps/unified/live.js`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from typing import Any

PITCH_X, PITCH_Y = 105.0, 68.0
STREAM_KEYS = ("tenant_id", "session_id", "match_id")


def slug(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:100] or "x"


def _pos(x: Any, y: Any) -> dict[str, Any]:
    return {
        "x": round(min(PITCH_X, max(0.0, float(x if x is not None else 52.5))), 1),
        "y": round(min(PITCH_Y, max(0.0, float(y if y is not None else 34.0))), 1),
        "z": 0,
    }


def roster_packet(
    stream: dict[str, str], players: Iterable[tuple[str, str]], teams: list[str]
) -> dict:
    """`players` are (name, team key) pairs."""
    return {
        "kind": "roster",
        "schema_version": "1.0.0",
        "stream": stream,
        "pitch": {"length_m": PITCH_X, "width_m": PITCH_Y},
        "ball_id": "ball-main",
        "team_ids": [slug(t) for t in teams],
        "players": [{"player_id": slug(n), "team_id": slug(t)} for n, t in players],
    }


def payload_for(ev: dict[str, Any], other_team: str | None = None) -> dict[str, Any] | None:
    kind, team, player = ev["type"], ev.get("team"), ev.get("player")
    if not team or kind not in {"goal", "shot", "pass", "foul", "yellow_card", "red_card",
                                "slide_tackle", "turnover"}:  # fmt: skip
        return None
    t, p = slug(team), slug(player)
    if kind == "goal":
        return {"type": "goal", "player_id": p, "team_id": t, "own_goal": bool(ev.get("ownGoal")),
                "position_unit": "m", "position": _pos(ev.get("x"), ev.get("y"))}  # fmt: skip
    if kind == "shot":
        return {"type": "shot", "player_id": p, "team_id": t, "position_unit": "m",
                "position": _pos(ev.get("x"), ev.get("y")),
                "on_target": ev.get("fate") in ("goal", "save")
                or ev.get("kind") == "penalty" or float(ev.get("xg") or 0) > 0.1}  # fmt: skip
    if kind == "pass" and ev.get("to"):
        return {"type": "pass", "player_id": p, "recipient_player_id": slug(ev["to"]), "team_id": t,
                "position_unit": "m", "start_position": _pos(ev.get("bx"), ev.get("by")),
                "end_position": _pos(ev.get("ax"), ev.get("ay"))}  # fmt: skip
    if kind == "foul" and ev.get("on"):
        return {"type": "foul", "player_id": p, "team_id": t, "victim_player_id": slug(ev["on"]),
                "advantage": False, "position_unit": "m",
                "position": _pos(ev.get("x"), ev.get("y"))}  # fmt: skip
    if kind in ("yellow_card", "red_card"):
        return {"type": "card", "player_id": p, "team_id": t,
                "colour": "yellow" if kind == "yellow_card" else "red",
                "reason": str(ev.get("reason") or "foul")}  # fmt: skip
    if kind == "turnover" and other_team:
        return {"type": "possession_change", "from_team_id": slug(other_team), "to_team_id": t,
                "cause": "loose_ball"}  # fmt: skip
    return None


def to_contract_events(
    events: Iterable[dict[str, Any]],
    stream: dict[str, str],
    teams: list[str],
    first_sequence: int = 1,
) -> Iterator[dict[str, Any]]:
    """Yield contract event envelopes with consecutive sequences, in match order."""
    seq = first_sequence
    last_ms = 0
    for ev in sorted(events, key=lambda e: (e.get("minute", 0), e.get("simT", 0))):
        other = next((t for t in teams if t != ev.get("team")), None)
        payload = payload_for(ev, other)
        if payload is None:
            continue
        ms = max(last_ms, round(float(ev.get("minute", 0)) * 60_000))
        last_ms = ms
        period = 1 if ms < 45 * 60_000 else 2
        yield {
            "kind": "event",
            "schema_version": "1.1.0",
            "stream": stream,
            "event_id": f"e{seq}",
            "stream_sequence": seq,
            "revision": 0,
            "event_time_ms": ms,
            "emitted_at": "2026-10-22T00:00:00.000Z",
            "clock": {
                "period": period,
                "period_elapsed_ms": ms if period == 1 else ms - 45 * 60_000,
            },  # fmt: skip
            "payload": payload,
        }
        seq += 1
