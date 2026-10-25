"""The scoreboard's live arms (CREW-5.2): each arm's model calls are counted, capped by its own
budget, and answered by the rules twin when refused or failed. No test here reaches a model."""

import json

import pytest
from conftest import run
from matchcast_agents.grading import SEED_RATE, _report
from matchcast_agents.grading_live import (
    BudgetedClient,
    CallBudget,
    events_digest,
    live_run,
    load_live_run,
)
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


def test_a_seeded_moment_the_crew_skipped_is_not_a_missed_claim(match) -> None:
    # a seeded claim no aired line states is caught only if the crew made the claim: a moment it
    # skipped made none, so it is not counted as caught
    run = {"lines": [], "latency_ms": [], "model_calls": 0, "produced": frozenset()}
    seeded = frozenset({"claim-m-1"})
    arm = _report("full_crew", run, match, 2026, seeded)
    assert arm["catch_rate"] == {"caught": 0, "seeded": 1, "produced": 0, "rate": None}


def test_a_live_run_is_bounded_per_arm(match) -> None:
    for bad in (0, 1001):
        with pytest.raises(ValueError):
            live_run(match, client=CountingClient(), max_calls=bad)


def test_counting_a_fallback_leaves_it_for_the_workflow_audit() -> None:
    # the tally reads a fallback and puts it back, so the workflow still audits it (fallback_used)
    from matchcast_agents.grading_live import _Tallied, _Tally
    from matchcast_agents.resilience import ResilientAgent

    class FailingAnalyst:
        async def analyse(self, ctx, task, *, repair=False):
            raise ModelError("no model here")

    class RulesAnalyst:
        mode = "rules"
        agent_id = "analyst"

        async def analyse(self, ctx, task, *, repair=False):
            return []

    tally = _Tally()
    agent = _Tallied(ResilientAgent(FailingAnalyst(), RulesAnalyst()), tally)

    async def one_task():  # the workflow awaits its agents in one task, so the context carries
        result = await agent.analyse(None, None)
        return result, agent.take_fallbacks()

    result, taken = run(one_task())
    assert result == []
    assert (tally.agent_calls, tally.answered_by_rules) == (1, 1)
    assert taken == ["model_error"]  # still there for the workflow


def test_the_producer_keeps_taken_fallbacks_in_order() -> None:
    # outside a call the Producer's fallbacks are one list: a take then a keep restores it exactly
    from matchcast_agents.live.client import ScriptedModelClient
    from matchcast_agents.live.producer import LiveProducer
    from matchcast_agents.rules import ProducerRules

    producer = LiveProducer(ScriptedModelClient(), ProducerRules(("analyst",)))
    producer.keep_fallbacks(["model_error", "timeout"])
    taken = producer.take_fallbacks()
    assert taken == ["model_error", "timeout"]
    assert producer.take_fallbacks() == []
    producer.keep_fallbacks(taken)
    assert producer.take_fallbacks() == ["model_error", "timeout"]
    # kept fallbacks go in front of any already waiting: they were taken first
    producer.keep_fallbacks(["old"])
    producer.keep_fallbacks(["older"])
    assert producer.take_fallbacks() == ["older", "old"]


TEAMS = ["Argentina", "Brazil"]


def write_record(tmp_path, **changes) -> str:
    record = {
        "kind": "crew_live_run",
        "fixture": "N001",
        "teams": TEAMS,
        "events_sha256": "abc",
        "seed": 2026,
        "seed_rate": SEED_RATE,
        "run_id": "abc123",
        "run_date": "2026-10-25",
        "arms": {"full_crew": {"run_id": "x", "mode": "live"}},
    }
    record.update(changes)
    path = tmp_path / "run.json"
    path.write_text(json.dumps(record))
    return str(path)


def test_a_recording_is_read_for_its_teams_seed_and_rate(tmp_path) -> None:
    path = write_record(tmp_path)
    assert load_live_run(path, teams=TEAMS)["run_id"] == "abc123"
    assert load_live_run(path, teams=["Argentina", "Chile"]) is None  # another fixture
    assert load_live_run(path, teams=TEAMS, seed=7) is None
    assert load_live_run(path, teams=TEAMS, rate=0.5) is None
    assert load_live_run(str(tmp_path / "missing.json"), teams=TEAMS) is None


def test_a_file_that_does_not_parse_is_no_run(tmp_path) -> None:
    path = tmp_path / "run.json"
    path.write_text("{not json")
    assert load_live_run(str(path), teams=TEAMS) is None


def test_a_recorded_arm_without_a_run_id_is_no_run(tmp_path) -> None:
    # a recording whose arm has no run id, or is not an object, would make the route fail
    no_id = write_record(tmp_path, arms={"full_crew": {"mode": "live"}})
    assert load_live_run(no_id, teams=TEAMS) is None
    not_obj = write_record(tmp_path, arms={"full_crew": "not an object"})
    assert load_live_run(not_obj, teams=TEAMS) is None


def test_the_events_digest_is_the_same_for_the_same_events_only() -> None:
    events = [{"event_id": "e1", "payload": {"type": "shot", "minute": 3}}]
    reordered_keys = [{"payload": {"minute": 3, "type": "shot"}, "event_id": "e1"}]
    assert events_digest(events) == events_digest(reordered_keys)
    changed = [{"event_id": "e1", "payload": {"type": "shot", "minute": 4}}]
    assert events_digest(events) != events_digest(changed)
