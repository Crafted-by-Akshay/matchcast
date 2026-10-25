"""Specialists the Showrunner spawns for one moment (04-agents.md, CREW-2.1 to 2.4)."""

from .base import Finding, SpawnRequest, Specialist, SpecialistReport
from .history import HistorySpecialist
from .planner import SpawnBudget, SpawnPlan, plan_spawns
from .replay import ReplaySpecialist
from .rhythm import RhythmSpecialist
from .runner import default_registry, run_all
from .stats import StatsSpecialist
from .tactics import TacticsSpecialist

__all__ = [
    "Finding",
    "HistorySpecialist",
    "ReplaySpecialist",
    "RhythmSpecialist",
    "SpawnBudget",
    "SpawnPlan",
    "SpawnRequest",
    "Specialist",
    "SpecialistReport",
    "StatsSpecialist",
    "TacticsSpecialist",
    "default_registry",
    "run_all",
    "plan_spawns",
]
