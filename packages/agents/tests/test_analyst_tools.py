"""Analyst claims come from tool calls and cite them; a failed tool means no claim (AGT-5)."""

import pytest
from conftest import fixed_clock, run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.context import MatchContext
from matchcast_agents.state import MatchState, apply
from matchcast_agents.tools import InProcessTools, ToolError


def flow_with(match, **kwargs) -> MatchWorkflow:
    config = WorkflowConfig()
    return MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=rules_agents(config.personas, **kwargs),
        config=config,
        clock=fixed_clock(),
    )


def context(match, upto: int) -> MatchContext:
    events = tuple(match["events"][:upto])
    state = MatchState()
    for event in events:
        state = apply(state, event)
    return MatchContext(
        match["roster"]["stream"], match["roster"], match["names"], match["teams"], state, events
    )


def test_every_claim_cites_a_tool_call_and_matches_its_output(match) -> None:
    flow = flow_with(match)
    run(flow.ingest(match["events"]))
    for row in flow.store.claims(flow.sk):
        assert row["tool_call_ids"] == ["tc-1"]
        assert row["formula_inputs"]["tool"] == "get_metrics"
        assert row["formula_inputs"]["value"] == row["packet"]["value"]


def test_a_failed_tool_gives_no_claim_and_an_audit_record(match) -> None:
    flow = flow_with(match, failing_tools=frozenset({"get_metrics"}))
    run(flow.ingest(match["events"]))
    assert flow.store.claims(flow.sk) == [] and flow.store.lines(flow.sk) == []
    records = flow.store.audit_records(flow.sk)
    fallback = [r for r in records if r["action"] == "fallback_used"]
    assert fallback and fallback[0]["details"]["fallback_reason"] == "tool_error"
    assert fallback[0]["details"]["tool"] == "get_metrics"


def test_tools_cannot_read_past_their_sequence(match) -> None:
    ctx = context(match, 60)
    tools = InProcessTools(ctx, up_to_sequence=20)
    _, result = tools.get_events(1, 60)
    assert max(e["stream_sequence"] for e in result["events"]) == 20
    _, shots = tools.get_events(1, 60, kinds=["shot"])
    assert all(e["payload"]["type"] == "shot" for e in shots["events"])


def test_unknown_metric_is_a_tool_error(match) -> None:
    tools = InProcessTools(context(match, 30), up_to_sequence=30)
    with pytest.raises(ToolError):
        tools.get_metrics(["pass_quality:home"])
    call_id, state = tools.get_state()
    assert call_id == "tc-1" and state["up_to_sequence"] == 30


def test_xg_comes_from_the_tool_with_ratio_units_and_its_own_version(match) -> None:
    from matchcast_agents.metrics_spec import derivation_version

    tools = InProcessTools(context(match, 40), up_to_sequence=40)
    _, result = tools.get_metrics(["xg:home", "shots:home"])
    assert result["values"]["xg:home"]["units"] == "ratio"
    assert result["values"]["xg:home"]["derivation_version"] == derivation_version("xg")
    assert result["values"]["shots:home"]["units"] == "count"
    assert 0 < result["values"]["xg:home"]["value"] < 5


def test_the_tool_never_counts_shots_after_up_to_sequence(match) -> None:
    early = InProcessTools(context(match, 40), up_to_sequence=10).get_metrics(["xg:home"])[1]
    late = InProcessTools(context(match, 40), up_to_sequence=40).get_metrics(["xg:home"])[1]
    assert early["values"]["xg:home"]["value"] <= late["values"]["xg:home"]["value"]
