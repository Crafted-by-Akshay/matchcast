"""The A2A client turns every bad reply into StatsDeskError so the workflow keeps going."""

import httpx
import pytest
from conftest import run
from matchcast_agents.statsdesk import A2AStatsDesk, StatsDeskError

GOOD = {"jsonrpc": "2.0", "id": "1", "result": {"parts": [{"kind": "data", "data": {"rank": 3}}]}}


def desk(handler) -> A2AStatsDesk:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return A2AStatsDesk("http://mcp/a2a", client=client)


def test_success_returns_the_data_part() -> None:
    assert run(desk(lambda r: httpx.Response(200, json=GOOD)).compare("shots", "team", 8)) == {
        "rank": 3
    }


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="boom"),
        httpx.Response(200, text="not json"),
        httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "error": {"message": "nope"}}),
        httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "error": "flat string"}),
        httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "result": {}}),
        httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "result": {"parts": []}}),
        httpx.Response(200, json={"result": {"parts": [{"data": "text"}]}}),
        httpx.Response(200, json=[1, 2]),
    ],
)
def test_every_bad_reply_is_a_stats_desk_error(response: httpx.Response) -> None:
    with pytest.raises(StatsDeskError):
        run(desk(lambda r: response).compare("shots", "team", 8))


def test_a_connection_error_is_a_stats_desk_error() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    with pytest.raises(StatsDeskError):
        run(desk(refuse).compare("shots", "team", 8))
