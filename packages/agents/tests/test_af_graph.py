"""The Agent Framework graph (AGT-3) produces what the native path produces."""

import pytest
from conftest import run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents


def _flow(match, orchestrator: str, **kwargs) -> MatchWorkflow:
    config = WorkflowConfig(orchestrator=orchestrator)
    return MatchWorkflow(
        stream=match["roster"]["stream"], roster=match["roster"], names=match["names"],
        clubs=match["teams"], config=config,
        agents=rules_agents(config.personas, **kwargs.pop("agent_kwargs", {})), **kwargs,
    )  # fmt: skip


def _shape(flow: MatchWorkflow) -> dict:
    return {
        "claims": [
            (c["packet"]["claim_id"], c["packet"]["value"]) for c in flow.store.claims(flow.sk)
        ],
        "lines": [(ln.line_id, ln.text, ln.status) for ln in flow.store.lines(flow.sk)],
        "audit": [
            (r["actor_kind"], r["actor_id"], r["action"], r["subject_id"], r["details"])
            for r in flow.store.audit_records(flow.sk)
        ],
        "stats": dict(flow.stats),
    }


def test_the_graph_has_one_executor_per_agent(match) -> None:
    from matchcast_agents.af_graph import build_graph

    graph = build_graph(_flow(match, "af"))
    assert set(graph.executors) == {"producer", "analyst", "narrator", "verifier", "stats_desk"}


@pytest.mark.parametrize("agent_kwargs", [{}, {"seed_bad_claim": True, "seed_bad_claim_at_ms": 0}])
def test_af_and_native_give_identical_claims_lines_and_audit(match, agent_kwargs) -> None:
    native = _flow(match, "native", agent_kwargs=dict(agent_kwargs))
    af = _flow(match, "af", agent_kwargs=dict(agent_kwargs))
    run(native.ingest(match["events"]))
    run(af.ingest(match["events"]))
    assert _shape(af) == _shape(native) and _shape(af)["lines"]


def test_a_failing_tool_is_the_same_fallback_under_af(match) -> None:
    flow = _flow(match, "af", agent_kwargs={"failing_tools": frozenset({"get_metrics"})})
    run(flow.ingest(match["events"]))
    assert flow.store.claims(flow.sk) == []
    assert "fallback_used" in {r["action"] for r in flow.store.audit_records(flow.sk)}


def test_an_executor_error_surfaces_to_the_caller(match, monkeypatch) -> None:
    flow = _flow(match, "af")

    async def boom(*args, **kwargs):
        raise RuntimeError("narrator exploded")

    monkeypatch.setattr(flow, "_narrate", boom)
    with pytest.raises(RuntimeError, match="narrator exploded"):
        run(flow.ingest(match["events"]))


def test_a_wrong_orchestrator_is_refused_at_construction() -> None:
    with pytest.raises(ValueError, match="MATCHCAST_ORCHESTRATOR"):
        WorkflowConfig(orchestrator="AF")
