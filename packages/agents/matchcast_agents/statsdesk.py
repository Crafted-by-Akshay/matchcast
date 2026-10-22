"""Client for the Stats Desk partner agent (A2A JSON-RPC ``message/send``, AGT-11)."""

import uuid
from typing import Any, Protocol

import httpx

TEAM_METRICS = {"goals", "shots", "xg", "passes", "fouls"}


class StatsDesk(Protocol):
    async def compare(
        self, metric: str, scope: str, value: float, team_id: str | None = None
    ) -> dict[str, Any]: ...


class StatsDeskError(RuntimeError):
    pass


class A2AStatsDesk:
    """Calls the Stats Desk at ``url`` (for example ``https://mcp.../a2a``)."""

    def __init__(self, url: str, *, client: httpx.AsyncClient | None = None) -> None:
        self.url = url
        self._client = client or httpx.AsyncClient(timeout=5.0)

    async def compare(
        self, metric: str, scope: str, value: float, team_id: str | None = None
    ) -> dict[str, Any]:
        data = {"skill": "compare_to_season", "metric": metric, "scope": scope, "value": value}
        if team_id:
            data["team_id"] = team_id
        message = {
            "kind": "message",
            "role": "user",
            "messageId": uuid.uuid4().hex,
            "parts": [{"kind": "data", "data": data}],
        }
        body = {
            "jsonrpc": "2.0",
            "id": uuid.uuid4().hex,
            "method": "message/send",
            "params": {"message": message},
        }
        try:
            response = await self._client.post(self.url, json=body)
            reply = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise StatsDeskError(str(error)) from error
        if "error" in reply:
            raise StatsDeskError(reply["error"].get("message", "stats desk error"))
        return reply["result"]["parts"][0]["data"]
