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
    assert all(t.description for t in tools.values())
    assert all(t.input_schema["properties"] for n, t in tools.items() if n != "describe_views")
    assert {"describe_views", "query_season", "search_kb"} <= set(tools)


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
    result = run(call(store, "get_evidence", up_to_sequence=137, claim_id=claim_id))
    assert result.structured_content["claim"]["claim_id"] == claim_id
    assert result.structured_content["tool_call_ids"] == ["tc-1"]


def test_evidence_is_hidden_before_the_claim_existed(store) -> None:
    sk = next(iter(store._claims))
    claim = max(store._claims[sk].values(), key=lambda row: row["packet"]["max_evidence_sequence"])
    early = claim["packet"]["max_evidence_sequence"] - 1
    result = run(
        call(store, "get_evidence", up_to_sequence=early, claim_id=claim["packet"]["claim_id"])
    )
    assert result.is_error and "unknown claim" in result.content[0].text


def test_evidence_does_not_return_a_later_revision_of_a_source_event(store) -> None:
    import copy

    sk = next(iter(store._claims))
    row = copy.deepcopy(next(iter(store._claims[sk].values())))
    original = FIXTURE["events"][4]
    row["packet"]["claim_id"] = "claim-events-source"
    row["packet"]["max_evidence_sequence"] = original["stream_sequence"]
    row["packet"]["source"] = {
        "type": "events",
        "events": [
            {"event_id": original["event_id"], "stream_sequence": original["stream_sequence"]}
        ],
    }
    store._claims[sk]["claim-events-source"] = row
    later = copy.deepcopy(original) | {"stream_sequence": 138, "revision": 1}
    store.add_event(sk, later)
    result = run(call(store, "get_evidence", up_to_sequence=137, claim_id="claim-events-source"))
    assert [e["stream_sequence"] for e in result.structured_content["source_events"]] == [
        original["stream_sequence"]
    ]


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


def _season_call(tool: str, **args):
    async def go():
        async with Client(create_server(MemoryStore())) as client:
            return await client.call_tool(tool, args)

    return run(go())


def test_describe_views_and_query_season_serve_the_season_data() -> None:
    views = _season_call("describe_views").structured_content["views"]
    assert {"matches", "team_match_stats"} <= set(views)
    result = _season_call("query_season", sql="SELECT count(*) AS n FROM matches")
    assert not result.is_error and result.structured_content["rows"] == [[28]]
    assert result.structured_content["sql_hash"]


@pytest.mark.parametrize(
    "sql",
    ["DROP TABLE matches", "SELECT * FROM read_parquet('/etc/passwd')", "SELECT 1; SELECT 2"],
)
def test_query_season_refuses_anything_but_one_select(sql) -> None:
    assert _season_call("query_season", sql=sql).is_error


def test_search_kb_returns_citable_chunks_and_respects_top_and_corpus() -> None:
    result = _season_call("search_kb", query="what is offside", top=3)
    chunks = result.structured_content["chunks"]
    assert 0 < len(chunks) <= 3 and all(c["id"] and c["text"] for c in chunks)
    laws = _season_call("search_kb", query="offside", corpus="laws").structured_content["chunks"]
    assert laws and {c["corpus"] for c in laws} == {"laws"}
    assert _season_call("search_kb", query="offside", top=99).is_error


def test_dates_and_decimals_come_back_as_json() -> None:
    result = _season_call("query_season", sql="SELECT *, 1.5 AS d FROM matches")
    assert not result.is_error and len(result.structured_content["rows"]) == 28
    json.dumps(result.structured_content)


def test_concurrent_queries_share_one_connection_safely() -> None:
    from concurrent.futures import ThreadPoolExecutor

    from matchcast_mcp.season import Season

    season = Season()

    def one(_):
        season.describe_views()
        return season.query("SELECT count(*) FROM matches")["rows"]

    with ThreadPoolExecutor(16) as pool:
        assert all(r == [[28]] for r in pool.map(one, range(200)))
