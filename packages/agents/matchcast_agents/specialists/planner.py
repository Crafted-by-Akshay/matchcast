"""Spawn planner: how many specialists the Showrunner calls for one moment (CREW-2.1, AB#385).

Importance sets the number. A priority-1 moment (a goal or a red card) gets up to five specialists,
all run in parallel. Any other moment gets at most one, so a quiet pass costs less than a goal.
Two budgets stop the spawns: priority-1 moments draw on one pool, every other moment on a quiet
pool, so quiet play cannot use up a goal's specialists. When the pool it draws on is spent, the
planner spawns nothing and the rules twin takes the moment. The planner is a pure function, so the
Showrunner can record its reason in the ledger as it is.
"""

from dataclasses import dataclass

from .base import SpawnRequest

PRIORITY_ONE_CAP = (
    5  # every specialist in the pool: a goal's historical comparison is the best line
)
OTHER_CAP = 1
SPAWNS_PER_MATCH = 60  # a cost guard, not a target: a match has a few dozen priority-1 moments

# the specialists built so far; a name not listed here is not spawned, whatever the pool says
OBJECTIVES = {
    "rhythm": "control, swings and the rhythm of play around this moment, from the raw events",
    "history": "the last meetings and form between the two teams, from the real results file",
    "replay": "the build-up to this moment: who passed to whom, and in how many seconds",
    "tactics": "the pressure and the side of the pitch the move came from, counter or build-up",
    "stats": "the analyst's shots and expected goals so far, through the in-process metrics tool",
}


class SpawnBudget:
    """The spawns one match may still use. Shared by every moment of the match."""

    def __init__(self, limit: int = SPAWNS_PER_MATCH) -> None:
        self.limit = limit
        self.used = 0

    @property
    def remaining(self) -> int:
        return self.limit - self.used

    def take(self, count: int) -> bool:
        if count > self.remaining:
            return False
        self.used += count
        return True


@dataclass(frozen=True)
class SpawnPlan:
    requests: tuple[SpawnRequest, ...] = ()
    reason: str = ""  # why nothing was spawned; empty when the plan has requests


def plan_spawns(
    *,
    priority: int,
    moment_id: str,
    available: tuple[str, ...],
    budget: SpawnBudget,
) -> SpawnPlan:
    """The specialists to run for one moment, in the order the pool lists them."""
    cap = PRIORITY_ONE_CAP if priority == 1 else OTHER_CAP
    chosen = [name for name in available if name in OBJECTIVES][:cap]
    if not chosen:
        return SpawnPlan(reason="no specialist for this moment")
    if budget.remaining <= 0:
        return SpawnPlan(reason="budget exhausted")
    count = min(len(chosen), budget.remaining)
    budget.take(count)
    requests = tuple(
        SpawnRequest(name=name, moment_id=moment_id, objective=OBJECTIVES[name], token_budget=0)
        for name in chosen[:count]
    )
    return SpawnPlan(requests=requests)
