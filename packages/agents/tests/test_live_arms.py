"""The scoreboard's live arms (CREW-5.2): each arm's model calls are counted, capped by its own
budget, and answered by the rules twin when refused or failed. No test here reaches a model."""

import json

import pytest
from conftest import run
from matchcast_agents.grading import SEED_RATE, _report
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
        assert arm["mode"] == "mixed", key  # every model call failed, so rules answered
        assert arm["lines_aired"] > 0, key  # the rules twins answered, so lines still aired
        assert arm["cost"]["model_calls"] <= 20, key  # the arm's own budget held
        assert arm["cost"]["model_errors"] == arm["cost"]["model_calls"], key
        assert arm["cost"]["answered_by_rules"] > 0, key
        assert arm["run_id"], key
    assert client.calls <= 3 * 20


def test_a_recorded_run_loads_only_for_its_own_match(tmp_path, match) -> None:
    record = {
        "kind": "crew_live_run",
        "match_id": match["roster"]["stream"]["match_id"],
        "seed": 2026,
        "seed_rate": SEED_RATE,
        "run_id": "abc123",
        "arms": {"full_crew": {"run_id": "x", "mode": "live"}},
    }
    path = tmp_path / "run.json"
    path.write_text(json.dumps(record))
    assert load_live_run(str(path), match_id=record["match_id"]) == record["arms"]
    assert load_live_run(str(path), match_id="some-other-match") is None
    assert load_live_run(str(tmp_path / "missing.json"), match_id=record["match_id"]) is None


def test_a_seeded_moment_the_crew_skipped_is_not_a_missed_claim(match) -> None:
    # a seeded claim no aired line states is caught only if the crew made the claim: a moment it
    # skipped made none, so it is not counted as caught
    run = {"lines": [], "latency_ms": [], "model_calls": 0, "produced": frozenset()}
    seeded = frozenset({"claim-m-1"})
    arm = _report("full_crew", run, match, 2026, seeded)
    assert arm["catch_rate"] == {"caught": 0, "seeded": 1, "produced": 0, "rate": None}


def test_a_recorded_run_must_match_its_seed_and_rate(tmp_path, match) -> None:
    path = tmp_path / "run.json"
    record = {"kind": "crew_live_run", "match_id": "m", "seed": 2026, "seed_rate": SEED_RATE}
    record["arms"] = {"full_crew": {"run_id": "x"}}
    path.write_text(json.dumps(record))
    assert load_live_run(str(path), match_id="m") == record["arms"]
    assert load_live_run(str(path), match_id="m", seed=7) is None
    assert load_live_run(str(path), match_id="m", rate=0.5) is None


def test_a_file_that_does_not_parse_is_no_run(tmp_path) -> None:
    path = tmp_path / "run.json"
    path.write_text("{not json")
    assert load_live_run(str(path), match_id="m") is None


def test_a_live_run_is_bounded_per_arm(match) -> None:
    for bad in (0, 1001):
        with pytest.raises(ValueError):
            live_run(match, client=CountingClient(), max_calls=bad)
