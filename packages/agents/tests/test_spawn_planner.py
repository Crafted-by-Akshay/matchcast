"""Spawn planner (CREW-2.1, AB#385): specialists sized to the moment, inside a per-match budget."""

import pytest
from matchcast_agents.specialists import planner
from matchcast_agents.specialists.planner import SpawnBudget, plan_spawns

POOL = ("rhythm", "history")  # the specialists built so far


@pytest.fixture
def four_built(monkeypatch) -> tuple[str, ...]:
    """Four built specialists, so the cap of four is what limits the plan."""
    names = ("rhythm", "history", "stats_researcher", "tactics")
    for name in names[2:]:
        monkeypatch.setitem(planner.OBJECTIVES, name, f"{name} objective")
    return names


def test_a_priority_one_moment_spawns_up_to_four_specialists_in_parallel(four_built) -> None:
    plan = plan_spawns(priority=1, moment_id="m-1", available=four_built, budget=SpawnBudget(50))
    assert [r.name for r in plan.requests] == list(four_built)
    assert plan.reason == ""


def test_a_priority_one_moment_with_two_specialists_spawns_both() -> None:
    plan = plan_spawns(priority=1, moment_id="m-8", available=POOL[:2], budget=SpawnBudget(50))
    assert [r.name for r in plan.requests] == ["rhythm", "history"]


def test_a_quiet_minute_spawns_at_most_one_specialist(four_built) -> None:
    plan = plan_spawns(priority=3, moment_id="m-2", available=four_built, budget=SpawnBudget(50))
    assert len(plan.requests) == 1


def test_a_name_with_no_built_specialist_is_never_spawned() -> None:
    plan = plan_spawns(
        priority=1, moment_id="m-9", available=("tracker", "rhythm"), budget=SpawnBudget(50)
    )
    assert [r.name for r in plan.requests] == ["rhythm"]


def test_each_request_states_an_objective_and_a_token_budget() -> None:
    plan = plan_spawns(priority=1, moment_id="m-3", available=POOL, budget=SpawnBudget(50))
    for request in plan.requests:
        assert request.objective
        assert request.moment_id == "m-3"
        assert request.token_budget == 0


def test_no_specialist_available_says_so_and_spends_nothing() -> None:
    budget = SpawnBudget(5)
    plan = plan_spawns(priority=1, moment_id="m-10", available=(), budget=budget)
    assert plan.requests == () and plan.reason == "no specialist for this moment"
    assert budget.remaining == 5


def test_a_spent_budget_spawns_nothing_and_says_why() -> None:
    budget = SpawnBudget(2)
    plan_spawns(priority=1, moment_id="m-4", available=POOL, budget=budget)
    assert budget.remaining == 0
    plan = plan_spawns(priority=1, moment_id="m-5", available=POOL, budget=budget)
    assert plan.requests == ()
    assert plan.reason == "budget exhausted"


def test_spawns_stop_at_what_the_budget_still_holds(four_built) -> None:
    budget = SpawnBudget(3)
    plan = plan_spawns(priority=1, moment_id="m-6", available=four_built, budget=budget)
    assert len(plan.requests) == 3
    assert budget.remaining == 0


def test_no_available_specialist_means_no_spawn_and_no_budget_used() -> None:
    budget = SpawnBudget(10)
    plan = plan_spawns(priority=1, moment_id="m-7", available=(), budget=budget)
    assert plan.requests == ()
    assert budget.remaining == 10


def test_every_specialist_in_the_workflow_pool_is_planned_for_some_moment() -> None:
    """A name the planner can never reach is a spawn the docs promise and the match never makes."""
    from matchcast_agents.workflow import SPAWN_POOL

    planned: set[str] = set()
    for priority in (1, 3):
        plan = plan_spawns(
            priority=priority, moment_id="m-1", available=SPAWN_POOL, budget=SpawnBudget(50)
        )
        planned |= {r.name for r in plan.requests}
    assert planned == set(SPAWN_POOL)
