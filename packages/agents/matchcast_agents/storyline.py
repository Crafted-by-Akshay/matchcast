"""Storylines and the Showrunner's stall watch (CREW-3.2 and CREW-1.2).

Pure state: the Showrunner feeds it the verified events. The stall clock is ``stall.py``. The
replan opens a storyline, and the goal that pays it off reaches the rules Narrator's line.
"""

from dataclasses import dataclass, field
from typing import Any

FALLBACK_PLAN = "fallback:rules"  # the rules twin's storyline, used when a replan stalls again


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

    def to_rows(self) -> list[dict[str, Any]]:
        """The book as plain rows, for the match checkpoint."""
        return [
            {
                "player_id": s.player_id,
                "opened": s.opened,
                "opening_text": s.opening_text,
                "status": s.status,
            }
            for s in self._stories
        ]

    @classmethod
    def from_rows(cls, rows: list[dict[str, Any]]) -> "StorylineBook":
        return cls(_stories=[Storyline(**row) for row in rows])

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
