"""Agent spans carry the agent, mode, verdict and claim ids (PLT-8 acceptance criterion 1)."""

import matchcast_agents.workflow as workflow_mod
from conftest import run
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def test_every_agent_call_is_a_span_and_the_verifier_records_its_verdict(
    make_workflow, match, monkeypatch
) -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(workflow_mod, "_TRACER", provider.get_tracer("test"))

    flow = make_workflow()
    run(flow.ingest(match["events"]))

    spans = exporter.get_finished_spans()
    names = {s.name for s in spans}
    assert {
        "invoke_agent producer",
        "invoke_agent analyst",
        "invoke_agent narrator",
        "invoke_agent verifier",
    } <= names
    assert all(s.attributes["matchcast.mode"] == "rules" for s in spans)

    verifier = [s for s in spans if s.name == "invoke_agent verifier"]
    assert verifier and all(s.attributes["matchcast.verdict"] for s in verifier)

    claim_ids = {row["packet"]["claim_id"] for row in flow.store.claims(flow.sk)}
    traced = {
        cid
        for s in spans
        if s.name == "invoke_agent analyst"
        for cid in s.attributes.get("matchcast.claim_ids", ())
    }
    assert claim_ids and claim_ids <= traced
