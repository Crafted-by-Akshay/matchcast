"""Fallback to rules, the circuit breaker and recovery (AGT-9), and repair limits (AGT-8)."""

import asyncio

import pytest
from conftest import fixed_clock, run
from matchcast_agents import AgentSet, MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.messages import DraftLine
from matchcast_agents.resilience import (
    CircuitBreaker,
    ModelError,
    ModelRateLimited,
    ResilientAgent,
)
from matchcast_agents.rules import NarratorRules
from matchcast_agents.workflow import WorkflowError
from matchcast_contracts.audit import verify_chain


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class FakeNarrator:
    """A live narrator whose behaviour the test scripts."""

    mode = "live"
    agent_id = "narrator"

    def __init__(self, script: list) -> None:
        self.script, self.calls = list(script), 0
        self.rules = NarratorRules()

    async def write(self, ctx, task, claims, *, attempt=0):
        self.calls += 1
        step = self.script.pop(0) if self.script else "ok"
        if isinstance(step, Exception):
            raise step
        if step == "hang":
            await asyncio.sleep(10)
        return await self.rules.write(ctx, task, claims, attempt=attempt)


def flow_with_narrator(match, narrator, clock: FakeClock | None = None):
    base = rules_agents()
    breaker = CircuitBreaker(clock or FakeClock())
    resilient = ResilientAgent(
        narrator,
        NarratorRules(),
        timeout_s=0.05,
        breaker=breaker,
        sleep=lambda _s: asyncio.sleep(0),
    )
    agents = AgentSet(base.producer, base.analyst, resilient, base.verifier)
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=agents,
        config=WorkflowConfig(),
        clock=fixed_clock(),
    )
    return flow, resilient, breaker


def reasons(flow) -> list[str]:
    return [
        r["details"]["fallback_reason"]
        for r in flow.store.audit_records(flow.sk)
        if r["action"] == "fallback_used"
    ]


def test_model_error_falls_back_to_rules_and_still_publishes(match) -> None:
    flow, _agent, _breaker = flow_with_narrator(match, FakeNarrator([ModelError()] * 50))
    run(flow.ingest(match["events"]))
    assert flow.store.publications(flow.sk), "claims keep publishing"
    assert set(reasons(flow)) >= {"model_error", "circuit_open"}
    assert flow.status == "rules_fallback"
    assert verify_chain(flow.store.audit_records(flow.sk))["valid"] is True
    statuses = [e for e in flow.hub.history() if e.event == "status"]
    assert statuses and statuses[0].data["status"] == "rules_fallback"


def test_timeout_and_one_retry_on_rate_limit(match) -> None:
    narrator = FakeNarrator(["hang", ModelRateLimited(0.01), "ok"])
    flow, agent, _ = flow_with_narrator(match, narrator)
    run(flow.ingest(match["events"][:40]))
    assert reasons(flow)[0] == "timeout"
    # the 429 was retried once and the retry succeeded, so it is not a fallback
    assert "rate_limited" not in reasons(flow) and narrator.calls >= 3
    assert agent.last_mode == "live"


def test_persistent_rate_limit_is_a_fallback(match) -> None:
    flow, _agent, _ = flow_with_narrator(
        match, FakeNarrator([ModelRateLimited(0.01), ModelRateLimited(0.01)])
    )
    run(flow.ingest(match["events"][:40]))
    assert reasons(flow)[0] == "rate_limited"


def test_breaker_opens_then_half_open_success_restores_live(match) -> None:
    clock = FakeClock()
    narrator = FakeNarrator([ModelError()] * 3)
    flow, agent, breaker = flow_with_narrator(match, narrator, clock)
    run(flow.ingest(match["events"][:45]))
    assert breaker.state == "open" and flow.status == "rules_fallback"
    calls_while_open = narrator.calls

    run(flow.ingest(match["events"][45:90]))
    assert narrator.calls == calls_while_open, "no live calls while the circuit is open"

    clock.now += 31  # half open: one probe goes through and succeeds (script is exhausted)
    run(flow.ingest(match["events"][90:]))
    assert narrator.calls > calls_while_open
    assert breaker.state == "closed" and agent.last_mode == "live" and flow.status == "live"
    assert [e.data["status"] for e in flow.hub.history() if e.event == "status"][-1] == "live"


def test_breaker_window_forgets_old_failures() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(clock)
    for _ in range(2):
        breaker.record_failure()
    clock.now += 61
    breaker.record_failure()
    assert breaker.state == "closed"


class AlwaysBadNarrator(NarratorRules):
    async def write(self, ctx, task, claims, *, attempt=0):
        lines = await super().write(ctx, task, claims, attempt=attempt)
        return [
            DraftLine(
                line_id=ln.line_id,
                claim_ids=ln.claim_ids,
                persona=ln.persona,
                text=ln.text + " Zed Quill agrees.",
                max_chars=ln.max_chars,
            )
            for ln in lines
        ]


def test_an_escalated_line_can_be_killed_but_not_approved_or_edited(match) -> None:
    base = rules_agents()
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=AgentSet(base.producer, base.analyst, AlwaysBadNarrator(), base.verifier),
        config=WorkflowConfig(),
        clock=fixed_clock(),
    )
    run(flow.ingest(match["events"]))
    held = next(ln for ln in flow.store.lines(flow.sk) if ln.escalated)
    for attempt in (flow.approve(held.line_id), flow.edit(held.line_id, "Northgate FC lead.")):
        with pytest.raises(WorkflowError) as refused:
            run(attempt)
        assert refused.value.code == "not_approvable"
    untouched = flow.store.get_line(flow.sk, held.line_id)
    assert untouched.status == "review" and untouched.text == held.text
    assert run(flow.kill(held.line_id, "a person checked it")).status == "killed"
    assert flow.store.publications(flow.sk) == []


def test_unrepairable_line_is_escalated_after_exactly_one_repair(match) -> None:
    base = rules_agents()
    flow = MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=AgentSet(base.producer, base.analyst, AlwaysBadNarrator(), base.verifier),
        config=WorkflowConfig(),
        clock=fixed_clock(),
    )
    run(flow.ingest(match["events"]))
    records = flow.store.audit_records(flow.sk)
    assert flow.store.publications(flow.sk) == []
    # an unknown name is a checkable fact: the failing lines wait for a person, none are dropped
    escalated = [
        r for r in records if r["action"] == "line_review" and r["details"].get("escalated")
    ]
    assert escalated and flow.stats["escalated"] == len(escalated)
    assert flow.stats["abstained"] == 0
    repairs: dict[str, int] = {}
    for r in records:
        if r["action"] == "line_repair_requested":
            repairs[r["subject_id"]] = repairs.get(r["subject_id"], 0) + 1
    assert repairs and max(repairs.values()) == 1
    lines = flow.store.lines(flow.sk)
    assert all(ln.status == "review" and ln.escalated for ln in lines if ln.repair_of)
    assert all(ln.status in ("rejected", "review") for ln in lines)
    assert verify_chain(records)["valid"] is True


def test_status_stays_fallback_while_any_wrapped_agent_is_on_rules(match) -> None:
    base = rules_agents()
    breaker = CircuitBreaker(FakeClock())
    narrator = ResilientAgent(FakeNarrator([]), NarratorRules(), timeout_s=0.05, breaker=breaker)

    class BrokenAnalyst:
        """A live analyst whose model always fails, so its wrapper stays on rules."""

        mode = "live"
        agent_id = "analyst"

        async def analyse(self, *a, **k):
            raise ModelError()

    stuck = ResilientAgent(
        BrokenAnalyst(), base.analyst, timeout_s=0.05, breaker=CircuitBreaker(FakeClock())
    )
    agents = AgentSet(base.producer, stuck, narrator, base.verifier)
    flow = MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], agents=agents, config=WorkflowConfig(), clock=fixed_clock(),
    )  # fmt: skip
    run(flow.ingest(match["events"]))
    assert narrator.mode == "live" and stuck.mode == "rules"
    assert flow.status == "rules_fallback"
    assert [e.data["status"] for e in flow.hub.history() if e.event == "status"][-1] == (
        "rules_fallback"
    )


def test_status_event_only_on_change_but_every_refusal_is_audited(match) -> None:
    flow, _agent, _breaker = flow_with_narrator(match, FakeNarrator([ModelError()] * 50))
    run(flow.ingest(match["events"]))
    status_events = [e for e in flow.hub.history() if e.event == "status"]
    audited = reasons(flow)
    assert len(audited) > len(status_events) >= 1
    assert len({(e.data["status"], e.data.get("reason")) for e in status_events}) == len(
        status_events
    )


def test_cancelled_probe_does_not_wedge_the_breaker() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(clock)
    for _ in range(3):
        breaker.record_failure()
    clock.now += 31
    assert breaker.allow() is True and breaker.allow() is False  # one probe in flight
    breaker.abandon_probe()
    assert breaker.allow() is True


def test_tool_error_leaves_the_breaker_untouched(match) -> None:
    from matchcast_agents.tools import ToolError

    class ToolFail:
        mode = "live"
        agent_id = "narrator"

        async def write(self, *a, **k):
            raise ToolError("get_metrics", "down")

    clock = FakeClock()
    breaker = CircuitBreaker(clock)
    for _ in range(3):
        breaker.record_failure()
    clock.now += 31  # half open
    agent = ResilientAgent(ToolFail(), NarratorRules(), breaker=breaker)
    from matchcast_agents.tools import ToolError as TE

    with pytest.raises(TE):
        run(agent.write(None, None, []))
    assert breaker.state == "half_open" and breaker.allow() is True


def test_a_long_retry_after_is_capped_before_the_retry() -> None:
    from matchcast_agents.resilience import MAX_RETRY_WAIT_S

    slept: list[float] = []

    async def record(seconds: float) -> None:
        slept.append(seconds)

    class Live:
        calls = 0

        async def write(self):
            Live.calls += 1
            if Live.calls == 1:
                raise ModelRateLimited(900)
            return "ok"

    agent = ResilientAgent(Live(), NarratorRules(), sleep=record)
    assert run(agent.write()) == "ok"
    assert slept == [MAX_RETRY_WAIT_S]
