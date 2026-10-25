"""Analyst on the model: it chooses which metrics matter; every value still comes from a tool."""

import json

from .. import history
from ..context import MatchContext
from ..messages import ProducerTask
from ..metrics_spec import METRIC_UNITS
from ..resilience import ModelError
from ..rules.analyst import AnalystRules, ClaimResult
from .client import ModelClient, prompt

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["metrics"],
    "properties": {"metrics": {"type": "array", "items": {"type": "string"}, "maxItems": 3}},
}


class LiveAnalyst:
    mode = "live"
    agent_id = "analyst"

    def __init__(self, client: ModelClient, rules: AnalystRules) -> None:
        self._client = client
        self._tools = rules  # builds the claim packets from tool results

    async def analyse(
        self, ctx: MatchContext, task: ProducerTask, *, repair: bool = False
    ) -> list[ClaimResult]:
        teams = (ctx.home, ctx.away)
        menu = [
            f"{m}:{t}"
            for m in METRIC_UNITS
            for t in teams
            if m not in history.HISTORY_METRICS or history.available(ctx)
        ]
        request = {"moment": task.reason, "metrics_available": menu, "max": 3}
        answer = await self._client.complete(prompt("analyst"), json.dumps(request), SCHEMA)
        chosen = [m for m in dict.fromkeys(answer.get("metrics", [])) if m in menu]
        if not chosen:
            raise ModelError("the Analyst chose no known metric")
        # The moment's required metrics always come first, so the rules Narrator can still write
        # from these claims after a fallback; the model only adds to them. Numbers, units and
        # evidence come from the tools, never from the model.
        required = self._tools.required(ctx, task)
        metrics = [*required, *(m for m in chosen if m not in required)][:3]
        return await self._tools.analyse(ctx, task, repair=repair, metrics=metrics)
