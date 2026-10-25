"""Stats specialist: the analyst's own metrics up to the moment, through the in-process tools.

It calls ``InProcessTools.get_metrics`` (the same tool the analyst uses), so its numbers and the
Verifier's recount come from one place. Each team's finding cites its shot events, which is where
its shots and expected goals come from.
"""

from dataclasses import replace

from ..context import MatchContext
from ..state import MatchState, apply
from ..tools.inprocess import InProcessTools, ToolError
from .base import Finding, SpawnRequest, SpecialistReport
from .shared import moment_event

METRICS = ("shots", "xg")


class StatsSpecialist:
    name = "stats"

    async def run(self, ctx: MatchContext, request: SpawnRequest) -> SpecialistReport:
        moment = moment_event(ctx, request)
        if moment is None:
            return SpecialistReport(self.name, request.moment_id, "no_data")
        cut = moment["stream_sequence"]
        state = MatchState()
        for e in sorted(ctx.events, key=lambda e: e["stream_sequence"]):
            if e["stream_sequence"] <= cut:
                state = apply(state, e)  # the counts as they stood at the moment, not after it
        tools = InProcessTools(replace(ctx, state=state), up_to_sequence=cut)
        names = [f"{m}:{team}" for team in (ctx.home, ctx.away) for m in METRICS]
        try:
            _, result = tools.get_metrics(names)
        except ToolError:
            return SpecialistReport(self.name, request.moment_id, "failed")
        values = result["values"]

        findings = []
        for team in (ctx.home, ctx.away):
            shots = values[f"shots:{team}"]["value"]
            xg = values[f"xg:{team}"]["value"]
            cited = tuple(
                e["event_id"]
                for e in ctx.events
                if e["stream_sequence"] <= cut
                and e["payload"]["type"] == "shot"
                and e["payload"].get("team_id") == team
            )
            findings.append(
                Finding(
                    text=f"{ctx.club_name(team)} have {shots} shots and {xg:.2f} xG so far",
                    figures={"shots": shots, "xg": round(xg, 2)},
                    evidence_ids=cited,
                )
            )
        return SpecialistReport(self.name, request.moment_id, "ok", findings=tuple(findings))
