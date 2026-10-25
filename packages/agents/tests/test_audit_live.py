"""The live audit stream never carries the Producer's free text (issue #382). The stored audit
keeps the full details and the hash chain is unchanged."""

from conftest import run

MODEL_TEXT = "The model says 62% of the on-ball actions came from one side"


def live_audit(flow) -> list[dict]:
    return [e.data for e in flow.hub.history() if e.event == "audit"]


def test_model_why_is_stored_but_never_streamed(make_workflow) -> None:
    flow = make_workflow()
    run(flow.ingest([]))
    flow._audit(
        "agent", "producer", "moment_skipped", "m-1", {"reason": "quiet", "why": MODEL_TEXT}
    )
    (streamed,) = [r for r in live_audit(flow) if r["action"] == "moment_skipped"]
    assert "why" not in streamed["details"]
    assert streamed["details"]["reason"] == "quiet"
    stored = [r for r in flow.store.audit_records(flow.sk) if r["action"] == "moment_skipped"]
    assert stored[-1]["details"]["why"] == MODEL_TEXT


def test_a_line_drafted_why_is_not_streamed(make_workflow) -> None:
    flow = make_workflow()
    run(flow.ingest([]))
    flow._audit("agent", "narrator", "line_drafted", "l-1", {"moment": "goal", "why": MODEL_TEXT})
    (streamed,) = [r for r in live_audit(flow) if r["action"] == "line_drafted"]
    assert "why" not in streamed["details"]
