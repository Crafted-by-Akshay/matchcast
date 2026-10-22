"""The Analyst's metric lookups through an MCP client (``MATCHCAST_TOOLS=mcp``, AGT-10).

The transport is injected: a coroutine ``call(tool, arguments) -> structured result``. The api
passes an in-memory MCP client over its own store, or a Streamable HTTP client for the ``mcp``
container. Any failure is a ``ToolError``, so the Analyst falls back exactly as with a failed
in-process tool: no claim, never a guessed number.
"""

from collections.abc import Awaitable, Callable
from typing import Any

from ..context import MatchContext
from .inprocess import ToolError

ToolCall = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]


class McpMetrics:
    """One instance per task, like ``InProcessTools``; ``calls`` feeds the claim's tool_call_ids."""

    def __init__(self, call: ToolCall, ctx: MatchContext, up_to_sequence: int) -> None:
        self._call = call
        self._stream = ctx.stream
        self._up_to = up_to_sequence
        self.calls: list[dict[str, Any]] = []

    async def get_metrics(self, names: list[str]) -> tuple[str, dict[str, Any]]:
        args = {
            "session_id": self._stream["session_id"],
            "match_id": self._stream["match_id"],
            "up_to_sequence": self._up_to,
            "names": names,
        }
        try:
            result = await self._call("get_metrics", args)
            values = result["values"]
            for name in names:
                values[name]["value"], values[name]["units"], values[name]["derivation_version"]
        except ToolError:
            raise
        except Exception as error:  # noqa: BLE001 - transport, tool error or a malformed reply
            raise ToolError("get_metrics", f"mcp call failed: {error}") from error
        call_id = f"tc-{len(self.calls) + 1}"
        self.calls.append({"call_id": call_id, "tool": "get_metrics", "args": {"names": names}})
        return call_id, result
