"""Analyst rules: turn one picked moment into one to three evidence-backed claims."""

from typing import Any

from pydantic import BaseModel

from ..context import MatchContext
from ..messages import ProducerTask
from ..tools import InProcessTools, McpMetrics, ToolCall, ToolError
from ..vision import is_vision_stream

DERIVATION_VERSION = "1.0.0"
# {h} and {a} are the roster's first and second team, {t} the team of the picked event
COUNT_METRICS = {
    "goal": ("goals:{h}", "goals:{a}"),
    "shot_on_target": ("shots:{t}", "shots_on_target:{t}", "xg:{t}"),
    "yellow_card": ("cards:{t}",),
    "red_card": ("red_cards:{t}", "cards:{t}"),
    "summary": ("shots:{h}", "shots:{a}"),
    "period_end": ("goals:{h}", "goals:{a}"),
    "buildup": ("goals:{h}", "goals:{a}"),  # the booth's kick-off talk, 0-0 on the record
    "filler": ("shots:{h}", "shots:{a}"),  # the booth's line in a quiet spell
}
# a colour moment counts what the picked play adds to: shots, tackles or fouls of its team
COLOUR_METRICS = {
    "shot": ("shots:{t}", "xg:{t}"),
    "tackle": ("tackles_won:{t}",),
    "foul": ("fouls:{t}",),
}


# a Vision stream sees passes only, so its summary counts those (ADR-0020)
VISION_COUNT_METRICS = {**COUNT_METRICS, "summary": ("passes:{h}", "passes:{a}")}


def metrics_for(ctx: MatchContext, task: ProducerTask, event: dict[str, Any]) -> list[str]:
    payload = event["payload"]
    team = payload.get("team_id", ctx.home)
    counts = VISION_COUNT_METRICS if is_vision_stream(ctx.stream) else COUNT_METRICS
    names = (
        COLOUR_METRICS.get(payload["type"], ())
        if task.reason == "colour"
        else counts.get(task.reason, ())
    )
    return [m.format(t=team, h=ctx.home, a=ctx.away) for m in names]


class ClaimResult(BaseModel):
    """A claim packet plus the tool calls behind it (stored beside the packet, not in it)."""

    packet: dict[str, Any]
    tool_call_ids: tuple[str, ...]
    formula_inputs: dict[str, Any]


class AnalystRules:
    mode = "rules"
    agent_id = "analyst"

    def __init__(
        self,
        corrupt_first_claim: bool = False,
        failing_tools: frozenset[str] = frozenset(),
        corrupt_after_ms: int = 0,
        tool_call: ToolCall | None = None,
    ) -> None:
        self._tool_call = tool_call
        self._corrupt = corrupt_first_claim
        self._corrupt_after_ms = corrupt_after_ms
        self._failing = failing_tools

    def required(self, ctx: MatchContext, task: ProducerTask) -> list[str]:
        """The metrics the rules Narrator needs for this moment; a live Analyst never drops them."""
        event = ctx.event(task.event_ids[0])
        assert event is not None
        return metrics_for(ctx, task, event)

    async def analyse(
        self,
        ctx: MatchContext,
        task: ProducerTask,
        *,
        repair: bool = False,
        metrics: list[str] | None = None,
    ) -> list[ClaimResult]:
        event = ctx.event(task.event_ids[0])
        assert event is not None
        metrics = metrics or metrics_for(ctx, task, event)
        snapshot = ctx.state.snapshot()
        if self._tool_call is not None:  # MATCHCAST_TOOLS=mcp: the same lookup over an MCP client
            if "get_metrics" in self._failing:
                raise ToolError("get_metrics", "unavailable")
            mcp = McpMetrics(self._tool_call, ctx, task.up_to_sequence)
            call_id, result = await mcp.get_metrics(metrics[:3])
        else:
            tools = InProcessTools(ctx, task.up_to_sequence, fail=self._failing)
            call_id, result = tools.get_metrics(metrics[:3])  # ToolError: no claim, never a guess
        claims = []
        for index, metric in enumerate(metrics[:3], start=1):
            value = result["values"][metric]["value"]
            if (
                self._corrupt
                and not repair
                and not claims
                and snapshot["event_time_ms"] >= self._corrupt_after_ms
            ):
                value += 1  # seeded bad claim: the Verifier must catch it and the repair fix it
                self._corrupt = False
            packet = {
                "kind": "claim",
                "schema_version": "1.1.0",
                "stream": ctx.stream,
                "claim_id": f"claim-{task.moment_id}-{index}",
                "source": {
                    "type": "interval",
                    "from_event_time_ms": 0,
                    "to_event_time_ms": snapshot["event_time_ms"],
                    "from_stream_sequence": 1,
                    "to_stream_sequence": snapshot["max_evidence_sequence"],
                },
                "metric": metric,
                "value": value,
                "units": result["values"][metric]["units"],
                "derivation_version": result["values"][metric]["derivation_version"],
                "snapshot": snapshot,
                "max_evidence_sequence": snapshot["max_evidence_sequence"],
                "approval_status": "pending",
            }
            claims.append(
                ClaimResult(
                    packet=packet,
                    tool_call_ids=(call_id,),
                    formula_inputs={
                        "metric": metric,
                        "tool": "get_metrics",
                        "value": result["values"][metric]["value"],
                    },
                )
            )
        return claims
