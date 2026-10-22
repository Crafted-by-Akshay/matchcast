"""What every executor may read about the match; never the future (see 04-agents.md §6)."""

from dataclasses import dataclass, field
from typing import Any

from .state import MatchState


@dataclass(frozen=True)
class MatchContext:
    stream: dict[str, str]
    roster: dict[str, Any]
    names: dict[str, str]
    clubs: dict[str, str]
    state: MatchState
    events: tuple[dict[str, Any], ...]
    personas: tuple[str, ...] = ("casual", "analyst")
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def home(self) -> str:
        return self.roster["team_ids"][0]

    @property
    def away(self) -> str:
        return self.roster["team_ids"][1]

    def player_name(self, player_id: str) -> str:
        return self.names.get(player_id, player_id)

    def club_name(self, team_id: str) -> str:
        return self.clubs.get(team_id, team_id)

    def event(self, event_id: str) -> dict[str, Any] | None:
        return next((e for e in self.events if e["event_id"] == event_id), None)

    @property
    def allowed_names(self) -> set[str]:
        return {n.casefold() for n in (*self.names.values(), *self.clubs.values())}
