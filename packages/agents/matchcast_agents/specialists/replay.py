"""Replay specialist: the build-up to a moment, from the events before it (CREW-2.1 crew).

It walks back from the moment through the attacking team's passes while it keeps the ball, and
stops at a turnover, a tackle or foul by the other side, or fifteen seconds. Every pass it counts
is cited by its event id, so the Verifier can recount the passes and the seconds.
"""

from ..context import MatchContext
from .base import Finding, SpawnRequest, SpecialistReport
from .shared import before, moment_event

BUILD_UP_MS = 15_000
MAX_PASSES = 12


class ReplaySpecialist:
    name = "replay"

    async def run(self, ctx: MatchContext, request: SpawnRequest) -> SpecialistReport:
        moment = moment_event(ctx, request)
        if moment is None:
            return SpecialistReport(self.name, request.moment_id, "no_data")
        team = moment["payload"].get("team_id")
        passes: list[dict] = []
        for e in before(ctx, moment):
            if (
                moment["event_time_ms"] - e["event_time_ms"] > BUILD_UP_MS
                or len(passes) >= MAX_PASSES
            ):
                break
            p = e["payload"]
            if p["type"] == "possession_change":
                break
            if p.get("team_id") not in (None, team) and p["type"] in (
                "tackle",
                "foul",
                "pass",
                "carry",
                "shot",
            ):
                break
            if p["type"] == "pass" and p.get("team_id") == team:
                # walking back, each earlier pass must have been played to the next one's passer
                if passes and p["recipient_player_id"] != passes[-1]["payload"]["player_id"]:
                    break
                passes.append(e)
        if not passes:
            return SpecialistReport(self.name, request.moment_id, "no_data")

        passes.reverse()
        names = [ctx.player_name(passes[0]["payload"]["player_id"])]
        names += [ctx.player_name(e["payload"]["recipient_player_id"]) for e in passes]
        seconds = round((moment["event_time_ms"] - passes[0]["event_time_ms"]) / 1000)
        finding = Finding(
            text=(
                f"{ctx.club_name(team)} built up with {len(passes)} passes in {seconds} seconds: "
                + " to ".join(names)
            ),
            figures={"passes": len(passes), "seconds": seconds},
            evidence_ids=tuple(e["event_id"] for e in passes),
        )
        return SpecialistReport(self.name, request.moment_id, "ok", findings=(finding,))
