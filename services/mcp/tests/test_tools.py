"""The MCP tools through a real in-memory MCP client."""

import asyncio
import json
from pathlib import Path

import pytest
from matchcast_agents import MatchWorkflow, WorkflowConfig, rules_agents
from matchcast_agents.store import MemoryStore
from matchcast_mcp.server import create_server
from mcp import Client

FIXTURE = json.loads(
    (Path(__file__).parents[3] / "packages/agents/tests/fixtures/match-short.json").read_text()
)
IDS = {"session_id": "short", "match_id": "match-short"}


@pytest.fixture(scope="module")
def store() -> MemoryStore:
    store = MemoryStore()
    flow = MatchWorkflow(
        stream=FIXTURE["roster"]["stream"], roster=FIXTURE["roster"], names=FIXTURE["names"],
        clubs=FIXTURE["teams"], agents=rules_agents(), config=WorkflowConfig(), store=store,
    )  # fmt: skip
    asyncio.run(flow.ingest(FIXTURE["events"]))
    return store


async def call(store: MemoryStore, tool: str, **args):
    async with Client(create_server(store)) as client:
        return await client.call_tool(tool, {**IDS, **args})


def run(coro):
    return asyncio.run(coro)


def test_lists_the_tools_with_schemas(store) -> None:
    async def go():
        async with Client(create_server(store)) as client:
            return await client.list_tools()

    tools = {t.name: t for t in run(go()).tools}
    assert {"get_state", "get_events", "get_metrics", "get_evidence", "get_replay_clip"} <= set(
        tools
    )
    assert all(t.description and t.input_schema["properties"] for t in tools.values())


def test_get_metrics_matches_the_workflow_state(store) -> None:
    result = run(call(store, "get_metrics", up_to_sequence=137, names=["shots:home", "goals:away"]))
    assert not result.is_error
    values = result.structured_content["values"]
    assert values["shots:home"]["value"] == sum(
        1
        for e in FIXTURE["events"]
        if e["payload"]["type"] == "shot" and e["payload"]["team_id"] == "home"
    )


def test_sequence_beyond_the_current_state_is_an_error_and_returns_no_data(store) -> None:
    for tool, extra in [
        ("get_state", {}),
        ("get_events", {"from_seq": 1, "to_seq": 500}),
        ("get_metrics", {"names": ["goals:home"]}),
        ("get_replay_clip", {"event_id": "e5"}),
    ]:
        result = run(call(store, tool, up_to_sequence=9999, **extra))
        assert result.is_error, tool
        assert "beyond the current state" in result.content[0].text


def test_time_scoping_hides_later_events(store) -> None:
    early = run(call(store, "get_state", up_to_sequence=20)).structured_content
    late = run(call(store, "get_state", up_to_sequence=137)).structured_content
    assert early["revision"] == 20 and late["revision"] == 137
    events = run(
        call(store, "get_events", up_to_sequence=20, from_seq=1, to_seq=137)
    ).structured_content
    assert max(e["stream_sequence"] for e in events["events"]) == 20


def test_evidence_for_a_published_claim(store) -> None:
    sk = next(iter(store._claims))
    claim_id = next(iter(store._claims[sk]))
    result = run(call(store, "get_evidence", claim_id=claim_id)).structured_content
    assert result["claim"]["claim_id"] == claim_id and result["tool_call_ids"] == ["tc-1"]


def test_replay_clip_window(store) -> None:
    clip = run(
        call(store, "get_replay_clip", up_to_sequence=137, event_id="e40")
    ).structured_content
    center = next(e for e in FIXTURE["events"] if e["event_id"] == "e40")["event_time_ms"]
    assert clip["events"] and all(abs(e["event_time_ms"] - center) <= 5000 for e in clip["events"])


def test_unknown_match_is_an_error(store) -> None:
    async def go():
        async with Client(create_server(store)) as client:
            return await client.call_tool(
                "get_state", {"session_id": "nope", "match_id": "x", "up_to_sequence": 1}
            )

    assert run(go()).is_error
