"""Stats Desk: a partner agent reached over A2A (AGT-11).

Serves the Agent Card at /.well-known/agent-card.json and JSON-RPC ``message/send`` at /a2a. The
one skill, ``compare_to_season``, answers from the DuckDB season views; there is no model call.
"""

import json
import uuid
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .season import METRICS, Season, SeasonError

PROTOCOL_VERSION = "0.3.0"
INPUT_SCHEMA = {
    "type": "object",
    "required": ["skill", "metric", "scope", "value"],
    "additionalProperties": False,
    "properties": {
        "skill": {"const": "compare_to_season"},
        "metric": {"type": "string", "enum": sorted({m for ms in METRICS.values() for m in ms})},
        "scope": {"type": "string", "enum": ["team", "player"]},
        "value": {"type": "number"},
        "team_id": {"type": "string"},
    },
}
OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["metric", "scope", "value", "season_average", "rank", "of", "matches"],
    "properties": {
        "metric": {"type": "string"},
        "scope": {"type": "string"},
        "team_id": {"type": ["string", "null"]},
        "value": {"type": "number"},
        "season_average": {"type": ["number", "null"]},
        "rank": {"type": "integer", "minimum": 1},
        "of": {"type": "integer"},
        "matches": {"type": "integer"},
    },
}


def agent_card(base_url: str = "") -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "name": "MatchCast Stats Desk",
        "description": "Compares a live number with the 28-match synthetic season.",
        "url": f"{base_url}/a2a",
        "preferredTransport": "JSONRPC",
        "version": "0.1.0",
        "capabilities": {"streaming": False, "pushNotifications": False},
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": "compare_to_season",
                "name": "Compare to season",
                "description": "Value, season average and rank of a number among the season's "
                "team or player match performances.",
                "tags": ["football", "season", "comparison"],
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
                "inputSchema": INPUT_SCHEMA,
                "outputSchema": OUTPUT_SCHEMA,
                "examples": [
                    '{"skill":"compare_to_season","metric":"shots","scope":"team","value":14}'
                ],
            }
        ],
    }


def _error(request_id: Any, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    )


def _data_part(message: dict[str, Any]) -> dict[str, Any] | None:
    for part in message.get("parts", []):
        if part.get("kind") == "data" and isinstance(part.get("data"), dict):
            return part["data"]
        if part.get("kind") == "text":
            try:
                data = json.loads(part.get("text", ""))
            except ValueError:
                continue
            if isinstance(data, dict):
                return data
    return None


def routes(season: Season) -> list[Route]:
    async def card(request: Request) -> JSONResponse:
        return JSONResponse(agent_card(str(request.base_url).rstrip("/")))

    async def rpc(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except ValueError:
            return _error(None, -32700, "parse error")
        request_id = body.get("id") if isinstance(body, dict) else None
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
            return _error(request_id, -32600, "invalid request")
        if body.get("method") != "message/send":
            return _error(request_id, -32601, f"method not found: {body.get('method')}")
        args = _data_part((body.get("params") or {}).get("message") or {})
        if not args or args.get("skill") != "compare_to_season":
            return _error(request_id, -32602, "send a data part with skill compare_to_season")
        try:
            value = float(args["value"])
            result = season.compare(args["metric"], args["scope"], value, args.get("team_id"))
        except (KeyError, TypeError, ValueError, SeasonError) as error:
            return _error(request_id, -32602, f"invalid params: {error}")
        message = {
            "kind": "message",
            "role": "agent",
            "messageId": uuid.uuid4().hex,
            "parts": [{"kind": "data", "data": result}],
        }
        return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": message})

    return [
        Route("/.well-known/agent-card.json", card, methods=["GET"]),
        Route("/a2a", rpc, methods=["POST"]),
    ]
