"""Analyst rules: turn one picked moment into one to three evidence-backed claims."""

from typing import Any

from pydantic import BaseModel

from ..context import MatchContext
from ..match_shares import POSSESSION, SHARE_METRICS
from ..messages import ProducerTask
from ..metrics_spec import derivation_version
from ..specialists.rhythm import share_percent
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


# a Vision stream sees passes only, so its summary counts those (ADR-0022)
VISION_COUNT_METRICS = {**COUNT_METRICS, "summary": ("passes:{h}", "passes:{a}")}
# the one Vision moment on the engine feed: Vision's count beside the engine's, per team
VISION_MOMENT_METRICS = (
    "vision_passes:{h}", "passes:{h}", "vision_precision:{h}",
    "vision_passes:{a}", "passes:{a}", "vision_precision:{a}",
)  # fmt: skip
MAX_CLAIMS = 6  # three for a usual moment; the Vision moment states both teams


def metrics_for(ctx: MatchContext, task: ProducerTask, event: dict[str, Any]) -> list[str]:
    if task.reason == "vision":
        return [m.format(h=ctx.home, a=ctx.away) for m in VISION_MOMENT_METRICS]
    payload = event["payload"]
    team = payload.get("team_id", ctx.home)
    counts = VISION_COUNT_METRICS if is_vision_stream(ctx.stream) else COUNT_METRICS
    names = (
        COLOUR_METRICS.get(payload["type"], ())
        if task.reason == "colour"
        else counts.get(task.reason, ())
    )
    # a priority-1 moment also carries each team's match-to-date possession (AB#373); it comes
    # last, so it yields to the moment's own counts
    shares = [f"{POSSESSION}:{t}" for t in (ctx.home, ctx.away)]
    return [m.format(t=team, h=ctx.home, a=ctx.away) for m in names] + (
        shares if task.priority == 1 else []
    )


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
        shares = [m for m in metrics if m.partition(":")[0] in SHARE_METRICS]
        counts = [m for m in metrics if m not in shares][:MAX_CLAIMS]
        snapshot = ctx.state.snapshot()
        if self._tool_call is not None:  # MATCHCAST_TOOLS=mcp: the same lookup over an MCP client
            if "get_metrics" in self._failing:
                raise ToolError("get_metrics", "unavailable")
            mcp = McpMetrics(self._tool_call, ctx, task.up_to_sequence)
            call_id, result = await mcp.get_metrics(counts + shares)
        else:
            tools = InProcessTools(ctx, task.up_to_sequence, fail=self._failing)
            call_id, result = tools.get_metrics(
                counts + shares
            )  # ToolError: no claim, never a guess
        claims: list[ClaimResult] = []

        def add(metric: str) -> None:
            value = result["values"][metric]["value"]
            if (
                self._corrupt
                and not repair
                and metric.partition(":")[0] not in SHARE_METRICS  # a share may not reach a line
                and snapshot["event_time_ms"] >= self._corrupt_after_ms
            ):
                value += 1  # seeded bad claim: the Verifier must catch it and the repair fix it
                self._corrupt = False
            packet = {
                "kind": "claim",
                "schema_version": "1.1.0",
                "stream": ctx.stream,
                "claim_id": f"claim-{task.moment_id}-{len(claims) + 1}",
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

        # the moment's own counts first, then the Rhythm and History claims, then each team's
        # match-to-date shares (AB#373),
        # which never take a slot from those
        for metric in counts:
            add(metric)
        for extra in (self._meetings, self._rhythm):
            if len(claims) < MAX_CLAIMS and (claim := extra(ctx, task, len(claims) + 1)):
                claims.append(claim)
        for metric in shares:  # a share of nothing (no on-ball action yet) is not a claim
            if result["values"][metric]["value"]:
                add(metric)
        return claims

    @staticmethod
    def _rhythm(ctx: MatchContext, task: ProducerTask, index: int) -> ClaimResult | None:
        """The swing the Rhythm specialist cites on a priority-1 moment: the team's share of the
        on-ball actions over the five minutes that end at the swing. The Verifier recounts it."""
        report = ctx.extra.get("specialists", {}).get("rhythm")
        swing = ctx.extra.get("rhythm", {}).get("swing")
        if report is None or report.status != "ok" or swing is None or task.priority != 1:
            return None
        events = [e for e in ctx.events if e["stream_sequence"] <= ctx.state.max_sequence]
        share = share_percent(events, swing["team"], swing["end_ms"], ctx.home, ctx.away)
        metric = f"rhythm_share:{swing['team']}-{swing['end_ms']}"
        snapshot = ctx.state.snapshot()
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
            "value": share,
            "units": "count",
            "derivation_version": derivation_version("rhythm_share"),
            "snapshot": snapshot,
            "max_evidence_sequence": snapshot["max_evidence_sequence"],
            "approval_status": "pending",
        }
        return ClaimResult(
            packet=packet,
            tool_call_ids=(),  # no metric tool: the Rhythm specialist's swing is the source
            formula_inputs={"metric": metric, "tool": "rhythm", "value": share},
        )

    @staticmethod
    def _meetings(ctx: MatchContext, task: ProducerTask, index: int) -> ClaimResult | None:
        """The head-to-head count the History specialist found on a priority-1 moment. The Verifier
        recounts it from the same history (history_metrics.py): checked, not trusted."""
        report = ctx.extra.get("specialists", {}).get("history")
        if report is None or report.status != "ok" or task.priority != 1:
            return None
        found = next((f for f in report.findings if "meetings" in f.figures), None)
        if found is None:
            return None
        value = int(found.figures["meetings"])  # the Verifier recounts it from the same history
        metric = f"h2h_played:{ctx.home}"
        snapshot = ctx.state.snapshot()
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
            "units": "count",
            "derivation_version": derivation_version("h2h_played"),
            "snapshot": snapshot,
            "max_evidence_sequence": snapshot["max_evidence_sequence"],
            "approval_status": "pending",
        }
        return ClaimResult(
            packet=packet,
            tool_call_ids=(),  # no metric tool: the History specialist's finding is the source
            formula_inputs={"metric": metric, "tool": "history", "value": value},
        )
