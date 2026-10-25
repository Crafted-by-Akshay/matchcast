"""The scoreboard's live arms (CREW-5.2): each arm's model calls are counted, capped by its own
budget, and answered by the rules twin when refused or failed. No test here reaches a model."""

import json

from conftest import run
from matchcast_agents.grading_live import BudgetedClient, CallBudget, live_run, load_live_run
from matchcast_agents.resilience import ModelError


class CountingClient:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls = 0
        self.error = error

    async def complete(self, system, user, schema, *, temperature=0.1, max_tokens=400):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return {}


def test_a_call_past_the_budget_is_refused_and_never_sent() -> None:
    inner = CountingClient()
    budget = CallBudget(max_calls=2)
    client = BudgetedClient(inner, budget)
    for _ in range(3):
        try:
            run(client.complete("s", "u", {}))
        except ModelError:
            pass
    assert inner.calls == 2
    assert (budget.attempted, budget.refused, budget.failed) == (2, 1, 0)


def test_a_failed_call_is_counted_and_raised() -> None:
    inner = CountingClient(error=ModelError("the model failed"))
    budget = CallBudget(max_calls=5)
    client = BudgetedClient(inner, budget)
    try:
        run(client.complete("s", "u", {}))
        raise AssertionError("the failure should reach the caller")
    except ModelError:
        pass
    assert (budget.attempted, budget.refused, budget.failed) == (1, 0, 1)


def test_live_arms_that_always_fail_are_answered_by_the_rules(match) -> None:
    client = CountingClient(error=ModelError("no model in this test"))
    record = live_run(match, client=client, max_calls=20, run_date="2026-10-25")
    assert set(record["arms"]) == {"full_crew", "single_agent", "crew_no_verifier"}
    for key, arm in record["arms"].items():
        assert arm["mode"] == "live", key
        assert arm["lines_aired"] > 0, key  # the rules twins answered, so lines still aired
        assert arm["cost"]["model_calls"] <= 20, key  # the arm's own budget held
        assert arm["cost"]["model_errors"] == arm["cost"]["model_calls"], key
        assert arm["run_id"], key
    assert client.calls <= 3 * 20


def test_a_recorded_run_loads_only_for_its_own_match(tmp_path, match) -> None:
    record = {
        "kind": "crew_live_run",
        "match_id": match["roster"]["stream"]["match_id"],
        "run_id": "abc123",
        "arms": {"full_crew": {"run_id": "x", "mode": "live"}},
    }
    path = tmp_path / "run.json"
    path.write_text(json.dumps(record))
    assert load_live_run(str(path), match_id=record["match_id"]) == record["arms"]
    assert load_live_run(str(path), match_id="some-other-match") is None
    assert load_live_run(str(tmp_path / "missing.json"), match_id=record["match_id"]) is None
