"""The api serves the MCP tools at /mcp from the same process (real HTTP, real MCP client)."""

import asyncio
import json
import socket
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn
from app.main import create_app
from mcp import Client

FIXTURE = json.loads(
    (Path(__file__).parents[1] / "packages/agents/tests/fixtures/match-short.json").read_text()
)


@pytest.fixture
def base_url():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


def test_copilot_style_client_reads_metrics_for_a_match_posted_over_rest(base_url) -> None:
    body = {"session_id": "short", "match_id": "match-short", "roster": FIXTURE["roster"],
            "names": FIXTURE["names"], "clubs": FIXTURE["teams"]}  # fmt: skip
    assert httpx.post(f"{base_url}/v1/matches", json=body).status_code == 201
    events = FIXTURE["events"]
    for start in range(0, len(events), 50):
        batch = {"events": events[start : start + 50]}
        r = httpx.post(
            f"{base_url}/v1/matches/match-short/events", params={"session_id": "short"}, json=batch
        )
        assert r.status_code == 202

    assert httpx.get(f"{base_url}/health").json() == {"status": "healthy"}

    async def ask():
        async with Client(f"{base_url}/mcp") as client:
            ok = await client.call_tool(
                "get_metrics",
                {"session_id": "short", "match_id": "match-short", "up_to_sequence": 137,
                 "names": ["goals:home", "goals:away"]},
            )  # fmt: skip
            future = await client.call_tool(
                "get_state",
                {"session_id": "short", "match_id": "match-short", "up_to_sequence": 5000},
            )
            return ok, future

    ok, future = asyncio.run(ask())
    expected = {
        f"goals:{team}": sum(
            1 for e in events if e["payload"]["type"] == "goal" and e["payload"]["team_id"] == team
        )
        for team in ("home", "away")
    }
    got = {k: v["value"] for k, v in ok.structured_content["values"].items()}
    assert not ok.is_error and got == expected
    assert future.is_error
