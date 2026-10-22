"""Match state reducer: pure function from a state and one event to the next state."""

from typing import Any

from pydantic import BaseModel, Field

TEAMS = ("home", "away")
COUNTED = ("goals", "shots", "shots_on_target", "tackles_won", "fouls", "cards", "red_cards")


class MatchState(BaseModel):
    revision: int = 0
    max_sequence: int = 0
    event_time_ms: int = 0
    period: int = 1
    possession: str | None = None
    score: dict[str, int] = Field(default_factory=lambda: dict.fromkeys(TEAMS, 0))
    counts: dict[str, dict[str, int]] = Field(
        default_factory=lambda: {m: dict.fromkeys(TEAMS, 0) for m in COUNTED}
    )
    last_events: list[str] = Field(default_factory=list)

    def snapshot(self) -> dict[str, int]:
        return {
            "state_revision": self.revision,
            "max_evidence_sequence": self.max_sequence,
            "event_time_ms": self.event_time_ms,
        }


def counted(payload: dict[str, Any]) -> list[tuple[str, str]]:
    """The (metric, team) increments one payload causes; the Verifier's recount uses it too."""
    kind, team = payload["type"], payload.get("team_id")
    if kind == "goal":
        return [("goals", team)]
    if kind == "shot":
        return [("shots", team)] + ([("shots_on_target", team)] if payload["on_target"] else [])
    if kind == "tackle":
        return [("tackles_won", team)] if payload["outcome"] == "won" else []
    if kind == "foul":
        return [("fouls", team)]
    if kind == "card":
        extra = [("red_cards", team)] if payload["colour"] != "yellow" else []
        return [("cards", team), *extra]
    return []


def apply(state: MatchState, event: dict[str, Any]) -> MatchState:
    payload = event["payload"]
    nxt = state.model_copy(deep=True)
    nxt.revision += 1
    nxt.max_sequence = max(nxt.max_sequence, event["stream_sequence"])
    nxt.event_time_ms = max(nxt.event_time_ms, event["event_time_ms"])
    nxt.period = event["clock"]["period"]
    for metric, team in counted(payload):
        nxt.counts[metric][team] += 1
    if payload["type"] == "goal":
        nxt.score[payload["team_id"]] += 1
    if payload["type"] == "possession_change":
        nxt.possession = payload["to_team_id"]
    elif payload["type"] in ("pass", "carry", "shot"):
        nxt.possession = payload["team_id"]
    nxt.last_events = [*nxt.last_events, event["event_id"]][-10:]
    return nxt
