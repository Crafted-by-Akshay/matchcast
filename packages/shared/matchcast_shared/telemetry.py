"""OpenTelemetry setup and GenAI spans (PLT-8, docs/architecture/15-observability.md).

`configure_telemetry` is a no-op without APPLICATIONINSIGHTS_CONNECTION_STRING, so local runs
and tests never reach Azure. Span names follow the OpenTelemetry GenAI conventions:
`invoke_agent <name>`, `chat <model>`, `execute_tool <tool>`.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace

_configured = False


def configure_telemetry(service_name: str) -> bool:
    """Send traces, metrics and logs to Application Insights. Returns True when enabled."""
    global _configured
    if _configured:
        return True
    if not os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING"):
        return False
    os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
    # 100% sampling during the build; from 26 Oct set OTEL_TRACES_SAMPLER_ARG=0.25.
    os.environ.setdefault("OTEL_TRACES_SAMPLER", "microsoft.fixed_percentage")
    os.environ.setdefault("OTEL_TRACES_SAMPLER_ARG", "1.0")
    from azure.monitor.opentelemetry import configure_azure_monitor

    configure_azure_monitor()
    _configured = True
    return True


def _tracer() -> trace.Tracer:
    return trace.get_tracer("matchcast")


@contextmanager
def agent_span(agent: str, *, moment_id: str | None = None, mode: str = "rules") -> Iterator[Any]:
    with _tracer().start_as_current_span(f"invoke_agent {agent}") as span:
        span.set_attribute("gen_ai.agent.name", agent)
        span.set_attribute("matchcast.mode", mode)
        if moment_id:
            span.set_attribute("matchcast.moment_id", moment_id)
        yield span


@contextmanager
def chat_span(model: str) -> Iterator[Any]:
    with _tracer().start_as_current_span(f"chat {model}") as span:
        span.set_attribute("gen_ai.request.model", model)
        yield span


def record_usage(span: Any, input_tokens: int, output_tokens: int) -> None:
    span.set_attribute("gen_ai.usage.input_tokens", input_tokens)
    span.set_attribute("gen_ai.usage.output_tokens", output_tokens)


@contextmanager
def tool_span(tool: str) -> Iterator[Any]:
    with _tracer().start_as_current_span(f"execute_tool {tool}") as span:
        span.set_attribute("gen_ai.tool.name", tool)
        yield span


@contextmanager
def verify_span(line_id: str) -> Iterator[Any]:
    with _tracer().start_as_current_span("verify") as span:
        span.set_attribute("matchcast.line_id", line_id)
        yield span


def record_verdict(span: Any, verdict: str, reason_code: str | None = None) -> None:
    span.set_attribute("matchcast.verdict", verdict)
    if reason_code:
        span.set_attribute("matchcast.reason_code", reason_code)
