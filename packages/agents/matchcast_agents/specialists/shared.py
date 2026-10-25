"""What the crew specialists share: finding the moment's event, and the events before it."""

from typing import Any

from ..context import MatchContext
from .base import SpawnRequest

PRESS_WINDOW_MS = 30_000


def moment_event(ctx: MatchContext, request: SpawnRequest) -> dict[str, Any] | None:
    """The event a moment is about: its id is the moment id without the ``m-`` prefix."""
    return ctx.event(request.moment_id.removeprefix("m-"))


def before(ctx: MatchContext, moment: dict[str, Any]) -> list[dict[str, Any]]:
    """Events earlier in the stream than the moment, newest first."""
    seq = moment["stream_sequence"]
    earlier = [e for e in ctx.events if e["stream_sequence"] < seq]
    return sorted(earlier, key=lambda e: e["stream_sequence"], reverse=True)
