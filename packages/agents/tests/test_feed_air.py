"""Derived feed lines on the air path: onair and feed_drop, and the desk's kill (CREW-4.3)."""

from conftest import run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.personas import BOOTH
from matchcast_contracts import validate


def flow_with(match, personas=("casual", "analyst"), approval_mode="auto", store=None):
    cfg = WorkflowConfig(personas=tuple(personas), approval_mode=approval_mode)
    return MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=rules_agents(cfg.personas),
        config=cfg,
        store=store,
    )


def events_of(flow, name):
    return [e for e in flow.hub.history() if e.event == name]


def test_a_verified_derived_line_airs_with_an_onair_record(match) -> None:
    flow = flow_with(match)
    run(flow.ingest(match["events"][:60]))
    onair = [e.data for e in events_of(flow, "onair")]
    assert onair, "a derived line that verified must emit an onair record"
    for record in onair:
        validate(record)  # the contract, not a copy of it
        assert record["feed"] in {"casual", "analyst"}
        assert record["source_event_ids"] and record["repair_count"] in (0, 1)


def test_a_killed_feed_does_not_air_and_resumes(match) -> None:
    flow = flow_with(match)
    run(flow.set_feed("casual", True, "desk kill"))
    run(flow.ingest(match["events"][:60]))
    aired = {e.data["feed"] for e in events_of(flow, "onair")}
    assert "casual" not in aired and "analyst" in aired
    assert any(line.status == "killed" for line in flow.store.lines(flow.sk))
    run(flow.set_feed("casual", False, "desk resume"))
    assert "casual" not in flow.killed_feeds


def test_a_kill_survives_a_restart(match) -> None:
    first = flow_with(match)
    run(first.set_feed("analyst", True, "desk kill"))
    second = flow_with(match, store=first.store)  # the audit chain survives the restart
    assert "analyst" in second.killed_feeds


def test_booth_lines_never_emit_onair(match) -> None:
    flow = flow_with(match, personas=tuple(BOOTH))
    run(flow.ingest(match["events"][:60]))
    assert not events_of(flow, "onair")
