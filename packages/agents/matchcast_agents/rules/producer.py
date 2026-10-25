"""Producer rules: pick moments by score, skip quiet play, honour the 8 s rate rule."""

import time
from collections.abc import Callable
from typing import Any

from ..context import MatchContext
from ..messages import ProducerTask, Skip

THRESHOLD = 60
RATE_WINDOW_MS = 8_000
SUMMARY_EVERY_MS = 300_000
# plays the feed would otherwise leave bare: one of them may get an analyst colour line
COLOUR_KINDS = frozenset({"shot_off_target", "tackle", "foul"})


def moment_score(payload: dict[str, Any]) -> tuple[int, int, str]:
    """(score 0-100, priority 1-3, kind) for one semantic payload."""
    kind = payload["type"]
    if kind == "goal":
        return 100, 1, "goal"
    if kind == "card":
        return (90, 1, "red_card") if payload["colour"] != "yellow" else (62, 2, "yellow_card")
    if kind == "shot":
        return (65, 2, "shot_on_target") if payload["on_target"] else (30, 3, "shot_off_target")
    if kind == "tackle":
        return 25, 3, "tackle"
    if kind == "foul":
        return 20, 3, "foul"
    if kind == "period_boundary" and payload["boundary"] == "ended":
        return 70, 2, "period_end"
    return 5, 3, kind


class ProducerRules:
    mode = "rules"
    agent_id = "producer"

    def __init__(
        self,
        personas: tuple[str, ...] = ("casual", "analyst"),
        *,
        colour_every_s: float = 0.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.personas = personas
        # colour lines cost a model call: at most one per colour_every_s of wall time (0 = off)
        self._colour_every_s = colour_every_s
        self._clock = clock
        self._last_colour: float | None = None
        self._last_task_ms: int | None = None
        self._next_summary_ms = SUMMARY_EVERY_MS
        self._seen: set[str] = set()
        self._spent: tuple[int | None, float | None] = (None, None)  # before the last task

    def snapshot(self) -> dict[str, Any]:
        return {
            "last_task_ms": self._last_task_ms,
            "next_summary_ms": self._next_summary_ms,
            "seen": sorted(self._seen),
        }

    def restore(self, data: dict[str, Any]) -> None:
        self._last_task_ms = data["last_task_ms"]
        self._next_summary_ms = data["next_summary_ms"]
        self._seen = set(data["seen"])

    def _colour_due(self) -> bool:
        if self._colour_every_s <= 0:
            return False
        return (
            self._last_colour is None or self._clock() - self._last_colour >= self._colour_every_s
        )

    def hand_back(self) -> None:
        """A model skip of the task just decided gives back its rate window and colour budget."""
        self._last_task_ms, self._last_colour = self._spent

    async def decide(self, ctx: MatchContext, event: dict[str, Any]) -> ProducerTask | Skip:
        moment_id = f"m-{event['event_id']}"
        if moment_id in self._seen:
            return Skip(moment_id=moment_id, reason="duplicate_moment")
        self._seen.add(moment_id)
        score, priority, kind = moment_score(event["payload"])
        if event["event_time_ms"] >= self._next_summary_ms and kind == "pass":
            score, priority, kind = 60, 3, "summary"
            self._next_summary_ms = event["event_time_ms"] // SUMMARY_EVERY_MS * SUMMARY_EVERY_MS
            self._next_summary_ms += SUMMARY_EVERY_MS
        colour = (
            kind in COLOUR_KINDS
            and "analyst" in self.personas  # the colour line is the analyst's
            and not (kind == "tackle" and event["payload"].get("outcome") != "won")
            and self._colour_due()
        )
        if colour:
            score, kind = THRESHOLD, "colour"  # still subject to the rate rule below
        if priority != 1 and score < THRESHOLD:
            return Skip(moment_id=moment_id, reason="quiet_play" if score < 30 else "low_score")
        now = event["event_time_ms"]
        if (
            priority != 1
            and self._last_task_ms is not None
            and now - self._last_task_ms < RATE_WINDOW_MS
        ):
            return Skip(moment_id=moment_id, reason="rate_limited")
        self._spent = (self._last_task_ms, self._last_colour)
        self._last_task_ms = now
        if colour:
            self._last_colour = self._clock()
        return ProducerTask(
            moment_id=moment_id,
            match_id=ctx.stream["match_id"],
            event_ids=(event["event_id"],),
            up_to_sequence=event["stream_sequence"],
            priority=priority,
            personas=("analyst",) if colour else self.personas,
            reason=kind,
        )
