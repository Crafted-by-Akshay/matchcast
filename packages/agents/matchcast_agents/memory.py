"""Shared match memory: what was already said about a player or club, from verified lines only.

The memory is derived from the stored lines each time a context is built, so nothing unchecked is
remembered and a restart rebuilds the same memory from the store. The Producer and the Narrator read
it to avoid repeating a storyline. They get the wording only, with every number replaced by ``#``:
a number in a remembered line is not a claim for this moment, so no model can copy one.
"""

import re
from typing import Any

from .context import MatchContext
from .messages import LineRecord

VERIFIED = ("verified", "approved", "published")  # a line a check or a person has let through
MEMORY = 12  # beats kept per player or club
SHOWN = 2  # earlier lines shown to an agent for one moment
_NUMBER = re.compile(r"\d+")


def _keys(payload: dict[str, Any]) -> list[str]:
    keys = []
    if "player_id" in payload:
        keys.append(f"player:{payload['player_id']}")
    if "team_id" in payload:
        keys.append(f"club:{payload['team_id']}")
    return keys


def storylines(ctx: MatchContext, lines: list[LineRecord]) -> dict[str, tuple[dict[str, Any], ...]]:
    """Per player and club: the verified lines about them, oldest first, at most MEMORY each."""
    by_id = {e["event_id"]: e for e in ctx.events}  # one index, not a scan per line
    beats: dict[str, list[dict[str, Any]]] = {}
    for line in lines:
        if line.status not in VERIFIED:
            continue
        event = by_id.get(line.moment_id.removeprefix("m-"))
        if event is None:
            continue
        beat = {
            "sequence": event["stream_sequence"],
            "minute": event["event_time_ms"] // 60_000,
            "text": line.text,
        }
        for key in _keys(event["payload"]):
            beats.setdefault(key, []).append(beat)
    return {key: tuple(rows[-MEMORY:]) for key, rows in beats.items()}


def already_said(ctx: MatchContext, payload: dict[str, Any]) -> list[dict[str, str]]:
    """The latest verified lines about this play's player or club, newest last, without repeats.

    Each entry holds only the wording, with its numbers replaced by ``#``.
    """
    memory: dict[str, tuple[dict[str, Any], ...]] = ctx.extra.get("storylines", {})
    seen: dict[str, dict[str, Any]] = {}
    for key in _keys(payload):
        for beat in memory.get(key, ()):
            seen.setdefault(beat["text"], beat)
    rows = sorted(seen.values(), key=lambda beat: (beat["minute"], beat["sequence"]))
    return [{"text": _NUMBER.sub("#", beat["text"])} for beat in rows[-SHOWN:]]
