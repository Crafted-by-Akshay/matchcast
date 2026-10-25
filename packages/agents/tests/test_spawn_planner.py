"""Spawn planner (CREW-2.1, AB#385): specialists sized to the moment, inside a per-match budget."""

from matchcast_agents.specialists.planner import SpawnBudget, plan_spawns

POOL = ("rhythm", "history", "stats_researcher", "tactics")


def test_a_priority_one_moment_spawns_two_to_four_specialists_in_parallel() -> None:
    plan = plan_spawns(priority=1, moment_id="m-1", available=POOL, budget=SpawnBudget(50))
    assert 2 <= len(plan.requests) <= 4
    assert [r.name for r in plan.requests] == list(POOL[:4])
    assert plan.reason == ""


def test_a_quiet_minute_spawns_at_most_one_specialist() -> None:
    plan = plan_spawns(priority=3, moment_id="m-2", available=POOL, budget=SpawnBudget(50))
    assert len(plan.requests) == 1


def test_each_request_states_an_objective_and_a_token_budget() -> None:
    plan = plan_spawns(priority=1, moment_id="m-3", available=POOL, budget=SpawnBudget(50))
    for request in plan.requests:
        assert request.objective
        assert request.moment_id == "m-3"
        assert request.token_budget >= 0


def test_a_spent_budget_spawns_nothing_and_says_why() -> None:
    budget = SpawnBudget(2)
    plan_spawns(priority=1, moment_id="m-4", available=POOL, budget=budget)
    assert budget.remaining == 0
    plan = plan_spawns(priority=1, moment_id="m-5", available=POOL, budget=budget)
    assert plan.requests == ()
    assert plan.reason == "budget exhausted"


def test_spawns_stop_at_what_the_budget_still_holds() -> None:
    budget = SpawnBudget(3)
    plan = plan_spawns(priority=1, moment_id="m-6", available=POOL, budget=budget)
    assert len(plan.requests) == 3
    assert budget.remaining == 0


def test_no_available_specialist_means_no_spawn_and_no_budget_used() -> None:
    budget = SpawnBudget(10)
    plan = plan_spawns(priority=1, moment_id="m-7", available=(), budget=budget)
    assert plan.requests == ()
    assert budget.remaining == 10
