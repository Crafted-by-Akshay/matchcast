"""Stats Desk over A2A: the Agent Card schema and one comparison checked against DuckDB."""

import duckdb
import pytest
from matchcast_agents.store import MemoryStore
from matchcast_mcp.app import build_app
from matchcast_mcp.season import Season, SeasonError
from starlette.testclient import TestClient


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(build_app(MemoryStore()))


def send(client: TestClient, data: dict) -> dict:
    message = {"role": "user", "messageId": "m1", "parts": [{"kind": "data", "data": data}]}
    body = {"jsonrpc": "2.0", "id": 7, "method": "message/send", "params": {"message": message}}
    return client.post("/a2a", json=body).json()


def test_agent_card_lists_the_skill_with_input_and_output_schema(client) -> None:
    card = client.get("/.well-known/agent-card.json").json()
    assert card["name"] == "MatchCast Stats Desk" and card["url"].endswith("/a2a")
    skill = card["skills"][0]
    assert skill["id"] == "compare_to_season"
    assert skill["inputSchema"]["required"] == ["skill", "metric", "scope", "value"]
    assert "rank" in skill["outputSchema"]["properties"]


def test_compare_to_season_matches_a_direct_duckdb_query(client) -> None:
    reply = send(
        client, {"skill": "compare_to_season", "metric": "shots", "scope": "team", "value": 8}
    )
    result = reply["result"]["parts"][0]["data"]
    root = Season().root
    con = duckdb.connect()
    path = f"read_parquet('{root / 'team_match_stats.parquet'}')"
    average, total = con.execute(f"SELECT avg(shots), count(*) FROM {path}").fetchone()
    better = con.execute(f"SELECT count(*) FROM {path} WHERE shots > 8").fetchone()[0]
    assert result["season_average"] == round(average, 2)
    assert (result["rank"], result["of"], result["matches"]) == (better + 1, total, 28)


def test_bad_requests_get_json_rpc_errors(client) -> None:
    assert (
        send(client, {"skill": "compare_to_season", "metric": "nope", "scope": "team", "value": 1})[
            "error"
        ]["code"]
        == -32602
    )
    assert (
        client.post("/a2a", json={"jsonrpc": "2.0", "id": 1, "method": "tasks/get"}).json()[
            "error"
        ]["code"]
        == -32601
    )
    assert client.post("/a2a", content=b"{").json()["error"]["code"] == -32700


def test_team_filter_and_unknown_scope() -> None:
    season = Season()
    one = season.compare("goals", "team", 2, team_id="HAR")
    assert one["team_id"] == "HAR" and 1 <= one["of"] < 56
    with pytest.raises(SeasonError):
        season.compare("goals", "club", 1)
