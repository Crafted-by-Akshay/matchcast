"""Runs a plan's specialists in parallel and returns their reports in the plan's order."""

import asyncio
import logging

from ..context import MatchContext
from .base import SpawnRequest, Specialist, SpecialistReport
from .history import HistorySpecialist
from .replay import ReplaySpecialist
from .rhythm import RhythmSpecialist
from .stats import StatsSpecialist
from .tactics import TacticsSpecialist

log = logging.getLogger(__name__)


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
    return list(await asyncio.gather(*(_run_one(registry[r.name], ctx, r) for r in runnable)))


async def _run_one(
    specialist: Specialist, ctx: MatchContext, request: SpawnRequest
) -> SpecialistReport:
    """One specialist's report. A bug in it is logged and reported as ``failed``, never raised,
    so the other specialists of the same moment still hand back their findings."""
    try:
        return await specialist.run(ctx, request)
    except Exception:
        log.exception("specialist %s failed on %s", request.name, request.moment_id)
        return SpecialistReport(request.name, request.moment_id, "failed")
