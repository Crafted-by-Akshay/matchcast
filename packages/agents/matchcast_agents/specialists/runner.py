"""Runs a plan's specialists in parallel and returns their reports in the plan's order."""

import asyncio

from ..context import MatchContext
from .base import SpawnRequest, Specialist, SpecialistReport
from .history import HistorySpecialist
from .replay import ReplaySpecialist
from .rhythm import RhythmSpecialist
from .stats import StatsSpecialist
from .tactics import TacticsSpecialist


def default_registry() -> dict[str, Specialist]:
    """Every specialist built so far, by the name the planner uses."""
    specialists: list[Specialist] = [
        RhythmSpecialist(),
        HistorySpecialist(),
        ReplaySpecialist(),
        TacticsSpecialist(),
        StatsSpecialist(),
    ]
    return {s.name: s for s in specialists}


async def run_all(
    ctx: MatchContext,
    requests: tuple[SpawnRequest, ...] | list[SpawnRequest],
    registry: dict[str, Specialist],
) -> list[SpecialistReport]:
    """Run the requests concurrently; a name missing from the registry is skipped, never guessed."""
    runnable = [r for r in requests if r.name in registry]
    return list(await asyncio.gather(*(registry[r.name].run(ctx, r) for r in runnable)))
