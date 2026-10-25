"""Storylines and the Showrunner's stall watch (CREW-3.2 and CREW-1.2).

Pure state: the Showrunner feeds it the verified events and the clock. Workflow wiring (the
callback line into the Narrator, the replan entry in the rundown) is Planned.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

FALLBACK_PLAN = "fallback:rules"  # the rules twin's storyline, used when a replan stalls again
STALL_S = 60.0  # wall time with no verified line before the Showrunner replans
SPECIALIST = "analyst"  # the one specialist a replan assigns to its new storyline


@dataclass(frozen=True)
class Payoff:
    text: str
    cites: tuple[int, int]  # the opening event's sequence, then the payoff event's


@dataclass
class Storyline:
    player_id: str
    opened: dict[str, Any]  # the opening event: sequence, minute and the text it opened with
    opening_text: str
    status: str = "open"  # open -> paid (once) or closed (at full time)


@dataclass
class StorylineBook:
    """Storylines opened earlier in the match, each waiting for its payoff: the player scores."""

    _stories: list[Storyline] = field(default_factory=list)

    def open(self, player_id: str, event: dict[str, Any], text: str) -> Storyline:
        story = Storyline(player_id=player_id, opened=event, opening_text=text)
        self._stories.append(story)
        return story

    def on_goal(self, event: dict[str, Any]) -> Payoff | None:
        """The payoff for the first open storyline whose player scored; each pays off once."""
        payload = event["payload"]
        if payload["type"] != "goal" or payload.get("own_goal"):
            return None
        for story in self._stories:
            if story.status == "open" and story.player_id == payload.get("player_id"):
                story.status = "paid"
                cites = (story.opened["stream_sequence"], event["stream_sequence"])
                text = (
                    f"{payload['player_id']} scores at minute {event['event_time_ms'] // 60_000}, "
                    f"after a chance at minute {story.opened['event_time_ms'] // 60_000}."
                )
                return Payoff(text=text, cites=cites)
        return None

    def close_at_full_time(self) -> list[dict[str, Any]]:
        """Open storylines close with a summary entry; a second call adds nothing."""
        out = []
        for story in self._stories:
            if story.status == "open":
                story.status = "closed"
                out.append(
                    {
                        "player_id": story.player_id,
                        "status": "closed",
                        "opening": story.opening_text,
                    }
                )
        return out


def pick_plan(memory: dict[str, tuple[Any, ...]]) -> str:
    """The storyline from shared memory: the player or club with the most remembered beats."""
    ranked = sorted(memory.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    return next(
        (key for key, beats in ranked if beats and key.startswith("player:")), FALLBACK_PLAN
    )


@dataclass(frozen=True)
class Replan:
    old_plan: str | None
    new_plan: str
    specialist: str
    fallback: bool


@dataclass
class StallWatch:
    """Counts wall time since the last verified line; past the limit, the Showrunner replans."""

    clock: Callable[[], float]
    stall_s: float = STALL_S
    plan: str | None = None
    _last_aired: float = field(default=-1.0)
    _replanned_without_line: bool = False

    def __post_init__(self) -> None:
        self._last_aired = self.clock()

    def aired(self) -> None:
        self._last_aired = self.clock()
        self._replanned_without_line = False

    def check(self, memory: dict[str, tuple[Any, ...]]) -> Replan | None:
        now = self.clock()
        if now - self._last_aired < self.stall_s:
            return None
        # a replan that aired nothing is followed by the rules twin's storyline, not another pick
        fallback = self._replanned_without_line or pick_plan(memory) == FALLBACK_PLAN
        new_plan = FALLBACK_PLAN if fallback else pick_plan(memory)
        replan = Replan(
            old_plan=self.plan, new_plan=new_plan, specialist=SPECIALIST, fallback=fallback
        )
        self.plan = new_plan
        self._last_aired = now
        self._replanned_without_line = True
        return replan
