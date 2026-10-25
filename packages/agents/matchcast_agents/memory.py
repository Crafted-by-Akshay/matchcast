"""Shared match memory: what was already said about a player or club, from verified lines only.

The memory is derived from the stored lines each time a context is built, so nothing unchecked is
remembered and a restart rebuilds the same memory from the store. The Producer and the Narrator read
it to avoid repeating a storyline, and neither may copy a number from it: a number in a remembered
line is not a claim for this moment.
"""

from typing import Any

from .context import MatchContext
from .messages import LineRecord

VERIFIED = ("verified", "approved", "published")  # a line a check or a person has let through
MEMORY = 12  # beats kept per player or club
SHOWN = 2  # earlier lines shown to an agent for one moment


def _keys(payload: dict[str, Any]) -> list[str]:
    keys = []
    if "player_id" in payload:
        keys.append(f"player:{payload['player_id']}")
    if "team_id" in payload:
        keys.append(f"club:{payload['team_id']}")
    return keys


def storylines(ctx: MatchContext, lines: list[LineRecord]) -> dict[str, tuple[dict[str, Any], ...]]:
    """Per player and club: the verified lines about them, oldest first, at most MEMORY each."""
    beats: dict[str, list[dict[str, Any]]] = {}
    for line in lines:
        if line.status not in VERIFIED:
            continue
        event = ctx.event(line.moment_id.removeprefix("m-"))
        if event is None:
            continue
        beat = {"minute": event["event_time_ms"] // 60_000, "text": line.text}
        for key in _keys(event["payload"]):
            beats.setdefault(key, []).append(beat)
    return {key: tuple(rows[-MEMORY:]) for key, rows in beats.items()}


def already_said(ctx: MatchContext, payload: dict[str, Any]) -> list[dict[str, Any]]:
    """The latest verified lines about this play's player or club, newest last, without repeats."""
    memory: dict[str, tuple[dict[str, Any], ...]] = ctx.extra.get("storylines", {})
    seen: dict[str, dict[str, Any]] = {}
    for key in _keys(payload):
        for beat in memory.get(key, ()):
            seen.setdefault(beat["text"], beat)
    rows = sorted(seen.values(), key=lambda beat: beat["minute"])
    return rows[-SHOWN:]
