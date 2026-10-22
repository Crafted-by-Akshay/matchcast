"""The Analyst over MCP (AGT-10): same claims as in process, and a failed call means no claim."""

import asyncio
import json
from pathlib import Path

from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.store import MemoryStore
from matchcast_mcp.server import create_server
from mcp import Client

FIXTURE = json.loads(
    (Path(__file__).parents[3] / "packages/agents/tests/fixtures/match-short.json").read_text()
)


def _flow(store: MemoryStore, tool_call=None) -> MatchWorkflow:
    return MatchWorkflow(
        stream=FIXTURE["roster"]["stream"], roster=FIXTURE["roster"], names=FIXTURE["names"],
        clubs=FIXTURE["teams"], agents=rules_agents(tool_call=tool_call),
        config=WorkflowConfig(), store=store,
    )  # fmt: skip


def _claims(flow: MatchWorkflow) -> list[tuple]:
    return [
        (c["packet"]["claim_id"], c["packet"]["metric"], c["packet"]["value"], c["packet"]["units"])
        for c in flow.store.claims(flow.sk)
    ]


def test_claims_over_mcp_equal_the_in_process_claims() -> None:
    plain = _flow(MemoryStore())
    asyncio.run(plain.ingest(FIXTURE["events"]))

    store = MemoryStore()
    calls: list[str] = []

    async def call(tool, arguments):
        calls.append(tool)
        async with Client(create_server(store)) as client:
            result = await client.call_tool(tool, arguments)
        assert not result.is_error
        return result.structured_content

    over_mcp = _flow(store, call)
    asyncio.run(over_mcp.ingest(FIXTURE["events"]))
    assert calls and set(calls) == {"get_metrics"}
    assert _claims(over_mcp) == _claims(plain) and _claims(plain)
    stored = over_mcp.store.claims(over_mcp.sk)[0]
    assert stored["tool_call_ids"] == ["tc-1"]
    verified = [ln for ln in over_mcp.store.lines(over_mcp.sk) if ln.status != "rejected"]
    assert verified  # the Verifier recounts from the events, not from the tool


def test_a_failing_mcp_call_means_no_claim_and_an_audited_fallback() -> None:
    async def broken(tool, arguments):
        raise ConnectionError("mcp container down")

    flow = _flow(MemoryStore(), broken)
    asyncio.run(flow.ingest(FIXTURE["events"]))
    assert flow.store.claims(flow.sk) == []
    reasons = {
        r["details"].get("fallback_reason")
        for r in flow.store.audit_records(flow.sk)
        if r["action"] == "fallback_used"
    }
    assert "tool_error" in reasons


def test_a_malformed_reply_is_a_tool_error_not_a_guess() -> None:
    async def odd(tool, arguments):
        return {"values": {}}

    flow = _flow(MemoryStore(), odd)
    asyncio.run(flow.ingest(FIXTURE["events"]))
    assert flow.store.claims(flow.sk) == []


def test_an_injected_tool_fault_applies_on_the_mcp_path_too() -> None:
    async def never(tool, arguments):
        raise AssertionError("must not be reached")

    flow = MatchWorkflow(
        stream=FIXTURE["roster"]["stream"], roster=FIXTURE["roster"], names=FIXTURE["names"],
        clubs=FIXTURE["teams"], agents=rules_agents(failing_tools=frozenset({"get_metrics"}),
        tool_call=never), config=WorkflowConfig(), store=MemoryStore(),
    )  # fmt: skip
    asyncio.run(flow.ingest(FIXTURE["events"]))
    assert flow.store.claims(flow.sk) == []
