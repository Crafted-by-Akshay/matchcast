"""MCP tools over the match repositories (docs/architecture/04-agents.md §6).

Every tool names a match and an ``up_to_sequence`` and refuses anything beyond the stored state, so
an agent, or Copilot, can never read the future. Results are capped at 20 KB. The tool logic is the
package's ``InProcessTools``: the in-process and MCP paths cannot drift apart.
"""

import json
from typing import Annotated, Any

from matchcast_agents.context import MatchContext
from matchcast_agents.state import MatchState, apply
from matchcast_agents.store import MemoryStore, stream_key
from matchcast_agents.tools import InProcessTools
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

TENANT = "demo"
MAX_RESULT_BYTES = 20_000
CLIP_RADIUS_MS = 5_000


class ToolRefusal(ToolError):
    """Returned to the caller as an MCP tool error (isError), not a server fault."""


def state_at(events: list[dict[str, Any]], up_to: int) -> MatchState:
    state = MatchState()
    for event in events:
        if event["stream_sequence"] <= up_to:
            state = apply(state, event)
    return state


def _cap(result: dict[str, Any]) -> dict[str, Any]:
    if len(json.dumps(result, separators=(",", ":"))) > MAX_RESULT_BYTES:
        raise ToolRefusal("result is over 20 KB; ask for a narrower sequence range")
    return result


def create_server(store: MemoryStore) -> MCPServer:
    server = MCPServer(
        "matchcast-tools",
        instructions=(
            "Read-only, time-scoped tools for one synthetic MatchCast match. Always pass "
            "session_id, match_id and up_to_sequence. Numbers you state must come from these tools."
        ),
    )

    def scope(session_id: str, match_id: str, up_to: int | None) -> tuple[str, MatchContext, int]:
        sk = stream_key({"tenant_id": TENANT, "session_id": session_id, "match_id": match_id})
        info = store.get_match(sk)
        if info is None:
            raise ToolRefusal(f"unknown match {match_id}")
        events = store.events(sk)
        latest = max((e["stream_sequence"] for e in events), default=0)
        limit = latest if up_to is None else up_to
        if limit > latest:
            raise ToolRefusal(f"up_to_sequence {limit} is beyond the current state ({latest})")
        ctx = MatchContext(
            stream={"tenant_id": TENANT, "session_id": session_id, "match_id": match_id},
            roster=info["roster"],
            names=info["names"],
            clubs=info["clubs"],
            state=state_at(events, limit),
            events=tuple(e for e in events if e["stream_sequence"] <= limit),
        )
        return sk, ctx, limit

    @server.tool()
    def get_state(session_id: str, match_id: str, up_to_sequence: int) -> dict[str, Any]:
        """Score, clock, possession and the last 10 event ids as of up_to_sequence."""
        _sk, ctx, limit = scope(session_id, match_id, up_to_sequence)
        _id, result = InProcessTools(ctx, limit).get_state()
        return _cap(result)

    @server.tool()
    def get_events(
        session_id: str,
        match_id: str,
        up_to_sequence: int,
        from_seq: int,
        to_seq: int,
        kinds: Annotated[list[str], Field(max_length=50)] | None = None,
    ) -> dict[str, Any]:
        """Contract events in a sequence range (max 200), optionally only some payload types."""
        _sk, ctx, limit = scope(session_id, match_id, up_to_sequence)
        _id, result = InProcessTools(ctx, limit).get_events(from_seq, to_seq, kinds)
        return _cap(result)

    @server.tool()
    def get_metrics(
        session_id: str,
        match_id: str,
        up_to_sequence: int,
        names: Annotated[list[str], Field(max_length=50)],
    ) -> dict[str, Any]:
        """Metric values named '<metric>:<team_id>' (goals, shots, shots_on_target, ...)."""
        _sk, ctx, limit = scope(session_id, match_id, up_to_sequence)
        try:
            _id, result = InProcessTools(ctx, limit).get_metrics(names)
        except Exception as error:
            raise ToolRefusal(str(error)) from error
        return _cap(result)

    @server.tool()
    def get_evidence(
        session_id: str, match_id: str, up_to_sequence: int, claim_id: str
    ) -> dict[str, Any]:
        """The source, tool calls and formula inputs behind one claim, as of up_to_sequence."""
        sk, ctx, limit = scope(session_id, match_id, up_to_sequence)
        row = store.get_claim(sk, claim_id)
        if row is None or row["packet"]["max_evidence_sequence"] > limit:
            raise ToolRefusal(f"unknown claim {claim_id} at this sequence")
        packet = row["packet"]
        wanted = (
            {r["event_id"] for r in packet["source"]["events"]}
            if packet["source"]["type"] == "events"
            else set()
        )
        return _cap(
            {
                "claim": packet,
                "tool_call_ids": row.get("tool_call_ids", []),
                "formula_inputs": row.get("formula_inputs", {}),
                "source_events": [e for e in ctx.events if e["event_id"] in wanted],
            }
        )

    @server.tool()
    def get_replay_clip(
        session_id: str, match_id: str, up_to_sequence: int, event_id: str
    ) -> dict[str, Any]:
        """The events within five seconds either side of one event, never past up_to_sequence."""
        _sk, ctx, _limit = scope(session_id, match_id, up_to_sequence)
        target = ctx.event(event_id)
        if target is None:
            raise ToolRefusal(f"unknown event {event_id} at this sequence")
        lo = target["event_time_ms"] - CLIP_RADIUS_MS
        hi = target["event_time_ms"] + CLIP_RADIUS_MS
        clip = [e for e in ctx.events if lo <= e["event_time_ms"] <= hi]
        return _cap({"event_id": event_id, "from_ms": lo, "to_ms": hi, "events": clip})

    return server
