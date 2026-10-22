"""Shared client factories and telemetry helpers run without any network or Azure account."""

import pytest
from matchcast_shared import azure_clients, telemetry
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def test_required_setting_missing_is_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STORAGE_TABLE_URL", raising=False)

    with pytest.raises(RuntimeError, match="STORAGE_TABLE_URL is not set"):
        azure_clients.table_service_client()


def test_clients_are_built_from_urls_with_the_shared_credential() -> None:
    table = azure_clients.table_service_client("https://example.table.core.windows.net")
    blob = azure_clients.blob_service_client("https://example.blob.core.windows.net")
    producer = azure_clients.eventhub_producer("ns.servicebus.windows.net", "match-events")

    assert table.url.startswith("https://example.table.core.windows.net")
    assert blob.url.startswith("https://example.blob.core.windows.net")
    assert producer.eventhub_name == "match-events"
    producer.close()


def test_telemetry_is_a_noop_without_a_connection_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)

    assert telemetry.configure_telemetry("api") is False


def test_agent_chat_and_verify_spans_carry_genai_attributes() -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    with telemetry.agent_span("analyst", moment_id="m1") as agent:
        assert agent is not None
        with telemetry.chat_span("gpt-6-luna") as chat:
            telemetry.record_usage(chat, 120, 30)
        with telemetry.verify_span("line-1") as verify:
            telemetry.record_verdict(verify, "rejected", "number_mismatch")

    spans = {s.name: dict(s.attributes or {}) for s in exporter.get_finished_spans()}
    assert spans["invoke_agent analyst"]["gen_ai.agent.name"] == "analyst"
    assert spans["invoke_agent analyst"]["matchcast.mode"] == "rules"
    assert spans["chat gpt-6-luna"]["gen_ai.usage.input_tokens"] == 120
    assert spans["chat gpt-6-luna"]["gen_ai.usage.output_tokens"] == 30
    assert spans["verify"]["matchcast.verdict"] == "rejected"
    assert spans["verify"]["matchcast.reason_code"] == "number_mismatch"
