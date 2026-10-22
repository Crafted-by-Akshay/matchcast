"""ASGI app for the MCP server: Streamable HTTP at /mcp and a health route."""

import os

from matchcast_agents.store import MemoryStore
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse

from .server import create_server

LOCAL_HOSTS = ["127.0.0.1:*", "localhost:*", "[::1]:*", "testserver"]


def transport_security(env: str | None = None) -> TransportSecuritySettings:
    """Host allow-list against DNS rebinding; ``*`` turns it off (Easy Auth fronts the app)."""
    raw = os.environ.get("MATCHCAST_MCP_ALLOWED_HOSTS", "") if env is None else env
    hosts = [h.strip() for h in raw.split(",") if h.strip()]
    if hosts == ["*"]:
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)
    return TransportSecuritySettings(allowed_hosts=[*LOCAL_HOSTS, *hosts], allowed_origins=[])


def build_app(store: MemoryStore) -> Starlette:
    server = create_server(store)

    @server.custom_route("/health", methods=["GET"])
    async def health(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "healthy", "service": "matchcast-mcp"})

    return server.streamable_http_app(transport_security=transport_security())
