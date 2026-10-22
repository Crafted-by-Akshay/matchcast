"""Role agents for talk (EXP-16): a player and the producer, each limited to their own facts."""

from .player import PlayerStats, player_reply, player_stats
from .producer_chat import producer_reply

__all__ = ["PlayerStats", "player_reply", "player_stats", "producer_reply"]
