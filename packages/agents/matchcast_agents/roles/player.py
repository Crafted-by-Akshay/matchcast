"""A player answers in the first person, using only their own counts from the event log."""

import re
from dataclasses import dataclass
from typing import Any

from ..context import MatchContext
from ..state import counted

MAX_WORDS = 60
TOPICS = (
    (re.compile(r"\bshots? on target\b", re.I), "shots_on_target"),
    (re.compile(r"\bshots?\b|\beffort", re.I), "shots"),
    (re.compile(r"\bgoals?\b|\bscor", re.I), "goals"),
    (re.compile(r"\btackles?\b", re.I), "tackles_won"),
    (re.compile(r"\bfouls?\b", re.I), "fouls"),
    (re.compile(r"\bcards?\b|\bbooked\b|\bsent off\b", re.I), "cards"),
)
PHRASE = {
    "shots": "{n} shots",
    "shots_on_target": "{n} shots on target",
    "goals": "{n} goals",
    "tackles_won": "{n} tackles won",
    "fouls": "{n} fouls",
    "cards": "{n} cards",
}


@dataclass(frozen=True)
class PlayerStats:
    player_id: str
    team_id: str
    shots: int = 0
    shots_on_target: int = 0
    goals: int = 0
    tackles_won: int = 0
    fouls: int = 0
    cards: int = 0

    def as_dict(self) -> dict[str, int]:
        return {k: getattr(self, k) for k in PHRASE}


def player_stats(ctx: MatchContext, player_id: str) -> PlayerStats | None:
    """Counts straight from the stored events; None when the player is not in this match."""
    team = next(
        (
            e["payload"].get("team_id")
            for e in ctx.events
            if e["payload"].get("player_id") == player_id
        ),
        None,
    )
    if team is None and player_id not in ctx.names:
        return None
    counts = dict.fromkeys(PHRASE, 0)
    for event in ctx.events:
        p = event["payload"]
        if p.get("player_id") != player_id or p["type"] in ("correction", "retraction"):
            continue
        for metric, _team in counted(p):
            if metric in counts:
                counts[metric] += 1
    return PlayerStats(player_id, team or "", **counts)


def player_reply(ctx: MatchContext, player_id: str, utterance: str) -> tuple[str, dict[str, Any]]:
    """(reply, facts used). The reply may only contain numbers that are in the facts."""
    stats = player_stats(ctx, player_id)
    name = ctx.player_name(player_id)
    if stats is None:  # talk() answers 404 before this; kept so the function is total
        return "I can't find that player in this match.", {}
    topics = [m for pattern, m in TOPICS if pattern.search(utterance)]
    if "shots_on_target" in topics and "shots" in topics:
        topics.remove("shots")  # "shots on target" also matches the plain shots pattern
    if not topics:
        club = ctx.club_name(stats.team_id) if stats.team_id else "my team"
        facts = {k: v for k, v in stats.as_dict().items() if k in ("shots", "goals", "tackles_won")}
        parts = ", ".join(PHRASE[k].format(n=v) for k, v in facts.items())
        return f"{name} here, for {club}. So far I have {parts}.", facts
    facts = {t: stats.as_dict()[t] for t in topics}
    parts = " and ".join(PHRASE[t].format(n=facts[t]) for t in topics)
    return f"So far I have {parts}.", facts
