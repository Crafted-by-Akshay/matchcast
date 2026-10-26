"""Audio description (CREW-7.2, AB#454): a describer speaks only in the gaps the commentary leaves.

The describer reads the engine's positions and events, never pixels. It names only the player
and club the engine reports, and it places the action by thirds of the pitch length (counted from
x = 0, as the engine reports it) and by the side of the pitch. A description is written only when
a gap of at least the feed's minimum (2 s) is long enough to speak it, so it never talks over
the commentary. A goal's description has a 3 s deadline: the caller is told when it is late.

Commentary busy-time comes from the booth lines' word counts at the booth pace, so a gap is an
estimate of what a listener hears, not of the audio itself.
"""

from dataclasses import dataclass
from typing import Any

from .context import MatchContext
from .feeds import FEEDS

MIN_GAP_MS = next(feed.min_gap_ms for feed in FEEDS if feed.key == "audio_description")
WORDS_PER_SECOND = 2.5  # the booth pace, the same as the half-time explainer's
GOAL_DEADLINE_MS = 3_000
DESCRIBED = ("pass", "carry", "shot", "tackle", "foul", "goal")
PITCH_LENGTH_M, PITCH_WIDTH_M = 105.0, 68.0  # the pitch the engine reports; see the roster


@dataclass(frozen=True)
class Window:
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class Description:
    text: str
    source_event_id: str
    speak_at_ms: int
    late: bool  # a goal whose description could not start within GOAL_DEADLINE_MS


def spoken_span(start_ms: int, text: str) -> tuple[int, int]:
    """When a line spoken at start_ms is busy until, at the booth pace."""
    return start_ms, start_ms + round(len(text.split()) / WORDS_PER_SECOND * 1000)


def gaps(spans: list[tuple[int, int]], end_ms: int, min_gap_ms: int = MIN_GAP_MS) -> list[Window]:
    """The windows of at least min_gap_ms with no commentary, in order, up to end_ms."""
    merged: list[list[int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    windows: list[Window] = []
    cursor = 0
    for start, end in merged:
        if start - cursor >= min_gap_ms:
            windows.append(Window(cursor, start))
        cursor = max(cursor, end)
    if end_ms - cursor >= min_gap_ms:
        windows.append(Window(cursor, end_ms))
    return windows


def take(windows: list[Window], start_ms: int, end_ms: int) -> list[Window]:
    """The windows with [start_ms, end_ms) used up, so a placed line is never talked over."""
    left: list[Window] = []
    for window in windows:
        if window.end_ms <= start_ms or window.start_ms >= end_ms:
            left.append(window)
            continue
        if window.start_ms < start_ms:
            left.append(Window(window.start_ms, start_ms))
        if window.end_ms > end_ms:
            left.append(Window(end_ms, window.end_ms))
    return left


def x_third(x: float, length: float = PITCH_LENGTH_M) -> str:
    return ("first", "middle", "last")[min(2, max(0, int(3 * x // length)))]


def y_side(y: float, width: float = PITCH_WIDTH_M) -> str:
    if y < width / 3:
        return "left"
    if y > 2 * width / 3:
        return "right"
    return "centre"


def _place(payload: dict[str, Any]) -> str | None:
    position = payload.get("position")
    if position is None:
        return None  # no position from the engine, no zone: nothing is guessed
    return f"in the {x_third(position['x'])} third of the pitch, {y_side(position['y'])} side"


def _sentence(ctx: MatchContext, payload: dict[str, Any], place: str) -> str:
    club = ctx.club_name(payload["team_id"])
    if payload["type"] == "goal":
        if payload.get("own_goal"):
            return f"Own goal, credited to {club}, {place}."
        return f"Goal for {club}: {ctx.player_name(payload['player_id'])}, {place}."
    return f"{ctx.player_name(payload['player_id'])} for {club}, {place}."


def describe(ctx: MatchContext, event: dict[str, Any], windows: list[Window]) -> Description | None:
    """The description of one event, placed in the first gap that can hold it, or None.

    None when the event is not described, has no engine position, or no gap in windows fits it.
    """
    payload = event["payload"]
    if payload["type"] not in DESCRIBED:
        return None
    place = _place(payload)
    if place is None:
        return None
    text = _sentence(ctx, payload, place)
    _, length = spoken_span(0, text)  # the sentence's spoken length in ms
    at = event["event_time_ms"]
    for window in windows:
        start = max(window.start_ms, at)
        if start + length <= window.end_ms:
            late = payload["type"] == "goal" and start - at > GOAL_DEADLINE_MS
            return Description(text, event["event_id"], start, late)
    return None
