"""Derived feed lines on the air path: onair and feed_drop, and the desk's kill (CREW-4.3)."""

import pytest
from conftest import run
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.messages import Verdict
from matchcast_agents.personas import BOOTH
from matchcast_agents.workflow import WorkflowError
from matchcast_contracts import validate


class CasualNeverPasses:
    """Wraps the rules Verifier and rejects every casual draft with no reason code, as a Verifier
    that cannot confirm a line does. A casual line then fails its one repair and is dropped."""

    def __init__(self, inner):
        self._inner = inner

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def check(self, ctx, line, claims):
        if line.persona == "casual":
            return Verdict(line_id=line.line_id, verdict="rejected", reason_code=None, checks=())
        return await self._inner.check(ctx, line, claims)


def flow_with(
    match, personas=("casual", "analyst"), approval_mode="auto", store=None, casual_fails=False
):
    cfg = WorkflowConfig(personas=tuple(personas), approval_mode=approval_mode)
    agents = rules_agents(cfg.personas)
    if casual_fails:
        agents.verifier = CasualNeverPasses(agents.verifier)
    return MatchWorkflow(
        stream=match["roster"]["stream"],
        roster=match["roster"],
        names=match["names"],
        clubs=match["teams"],
        agents=agents,
        config=cfg,
        store=store,
    )


def events_of(flow, name):
    return [e for e in flow.hub.history() if e.event == name]


def audit_by_id(flow):
    return {row["audit_id"]: row for row in flow.store.audit_records(flow.sk)}


def test_a_verified_derived_line_airs_with_an_onair_record(match) -> None:
    flow = flow_with(match)
    run(flow.ingest(match["events"][:60]))
    onair = [e.data for e in events_of(flow, "onair")]
    assert onair, "a derived line that verified must emit an onair record"
    for record in onair:
        validate(record)  # the contract, not a copy of it
        assert record["feed"] in {"casual", "analyst"}
        assert record["source_event_ids"] and record["repair_count"] in (0, 1)


def test_a_derived_line_that_fails_its_repair_is_dropped_with_a_feed_drop(match) -> None:
    flow = flow_with(match, casual_fails=True)
    run(flow.ingest(match["events"][:60]))
    drops = [e.data for e in events_of(flow, "feed_drop")]
    assert drops, "a casual line that fails its repair must emit a feed_drop"
    records = audit_by_id(flow)
    for drop in drops:
        validate(drop)
        assert drop["feed"] == "casual" and drop["repair_count"] == 1
        assert drop["reason_code"] == "unsupported_statement"  # no code from the Verifier
        audited = records[drop["audit_id"]]
        assert audited["action"] == "line_abstained"
        assert audited["details"]["reason_code"] == drop["reason_code"]
        assert audited["details"]["text"]  # the dropped text stays in the audit chain
    assert not [e for e in events_of(flow, "onair") if e.data["feed"] == "casual"]
    assert not [p for p in flow.store.publications(flow.sk) if p["persona"] == "casual"]


def test_a_dropped_derived_line_cannot_be_edited_onto_the_air(match) -> None:
    flow = flow_with(match, casual_fails=True)
    run(flow.ingest(match["events"][:60]))
    dropped = next(ln for ln in flow.store.lines(flow.sk) if ln.status == "abstained")
    with pytest.raises(WorkflowError) as error:
        run(flow.edit(dropped.line_id, "A line the Verifier already refused."))
    assert error.value.code == "not_approvable"
    assert not [p for p in flow.store.publications(flow.sk) if p["persona"] == "casual"]


def test_a_killed_feed_airs_nothing_until_it_resumes(match) -> None:
    flow = flow_with(match)
    run(flow.set_feed("casual", True, "desk kill"))
    run(flow.ingest(match["events"][:60]))
    aired = {e.data["feed"] for e in events_of(flow, "onair")}
    assert "casual" not in aired and "analyst" in aired
    assert any(line.status == "killed" for line in flow.store.lines(flow.sk))
    run(flow.set_feed("casual", False, "desk resume"))
    assert "casual" not in flow.killed_feeds
    run(flow.ingest(match["events"][60:]))
    assert "casual" in {e.data["feed"] for e in events_of(flow, "onair")}


def test_a_kill_survives_a_restart(match) -> None:
    first = flow_with(match)
    run(first.set_feed("analyst", True, "desk kill"))
    second = flow_with(match, store=first.store)  # the audit chain survives the restart
    assert "analyst" in second.killed_feeds


def test_booth_lines_never_emit_onair(match) -> None:
    flow = flow_with(match, personas=tuple(BOOTH))
    run(flow.ingest(match["events"][:60]))
    assert not events_of(flow, "onair")
