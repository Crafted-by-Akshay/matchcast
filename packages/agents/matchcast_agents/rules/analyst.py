"""Analyst rules: turn one picked moment into one to three evidence-backed claims."""

from typing import Any

from ..context import MatchContext
from ..messages import ProducerTask

DERIVATION_VERSION = "1.0.0"
# {h} and {a} are the roster's first and second team, {t} the team of the picked event
COUNT_METRICS = {
    "goal": ("goals:{h}", "goals:{a}"),
    "shot_on_target": ("shots:{t}", "shots_on_target:{t}"),
    "yellow_card": ("cards:{t}",),
    "red_card": ("red_cards:{t}", "cards:{t}"),
    "summary": ("shots:{h}", "shots:{a}"),
    "period_end": ("goals:{h}", "goals:{a}"),
}


def metric_value(ctx: MatchContext, metric: str) -> int:
    name, team = metric.split(":", 1)
    return ctx.state.count(name, team)


class AnalystRules:
    mode = "rules"
    agent_id = "analyst"

    def __init__(self, corrupt_first_claim: bool = False) -> None:
        self._corrupt = corrupt_first_claim

    async def analyse(
        self, ctx: MatchContext, task: ProducerTask, *, repair: bool = False
    ) -> list[dict[str, Any]]:
        event = ctx.event(task.event_ids[0])
        assert event is not None
        team = event["payload"].get("team_id", ctx.home)
        metrics = [
            m.format(t=team, h=ctx.home, a=ctx.away) for m in COUNT_METRICS.get(task.reason, ())
        ]
        snapshot = ctx.state.snapshot()
        claims = []
        for index, metric in enumerate(metrics[:3], start=1):
            value = metric_value(ctx, metric)
            if self._corrupt and not repair and not claims:
                value += 1  # seeded bad claim: the Verifier must catch it and the repair fix it
                self._corrupt = False
            claims.append(
                {
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
                    "derivation_version": DERIVATION_VERSION,
                    "snapshot": snapshot,
                    "max_evidence_sequence": snapshot["max_evidence_sequence"],
                    "approval_status": "pending",
                }
            )
        return claims
