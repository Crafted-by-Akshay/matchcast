"""Tactics specialist: pressure and shape around a moment, from events (CREW-2.1 crew).

It counts the pressing team's pressures in the thirty seconds before the moment, says which side of
the pitch the moment came from, and calls the move a counter when the attacking team won the ball
within ten seconds and kept it for three passes or fewer, and build-up otherwise. The side uses the
engine's y coordinate: below 22.7 m is the left, above 45.3 m the right, and the middle between.
"""

from ..context import MatchContext
from .base import Finding, SpawnRequest, SpecialistReport
from .shared import PRESS_WINDOW_MS, before, moment_event

COUNTER_MS = 10_000
COUNTER_MAX_PASSES = 3
LEFT_BELOW, RIGHT_ABOVE = 22.7, 45.3  # the pitch is 68 m wide


def _side(y: float) -> str:
    if y < LEFT_BELOW:
        return "left"
    return "right" if y > RIGHT_ABOVE else "centre"


class TacticsSpecialist:
    name = "tactics"

    async def run(self, ctx: MatchContext, request: SpawnRequest) -> SpecialistReport:
        moment = moment_event(ctx, request)
        if moment is None:
            return SpecialistReport(self.name, request.moment_id, "no_data")
        attacking = moment["payload"].get("team_id")
        earlier = before(ctx, moment)
        findings: list[Finding] = []

        pressing = [
            e
            for e in earlier
            if moment["event_time_ms"] - e["event_time_ms"] <= PRESS_WINDOW_MS
            and e["payload"]["type"] == "pressure"
            and e["payload"].get("team_id") not in (None, attacking)
        ]
        if pressing:
            presser = pressing[0]["payload"]["team_id"]
            findings.append(
                Finding(
                    text=(
                        f"{ctx.club_name(presser)} made {len(pressing)} pressure"
                        f"{'' if len(pressing) == 1 else 's'} in the 30 seconds before"
                    ),
                    figures={"pressures": len(pressing)},
                    evidence_ids=tuple(e["event_id"] for e in pressing),
                )
            )

        position = moment["payload"].get("position") or moment["payload"].get("start_position")
        side = _side(position["y"]) if position else None
        style, style_ids = self._style(ctx, moment, earlier, attacking)
        if side is not None:
            findings.append(
                Finding(
                    text=f"The move came down the {side} with {style} play",
                    figures={"y": round(position["y"], 1)},
                    evidence_ids=(moment["event_id"], *style_ids),
                )
            )
        if not findings:
            return SpecialistReport(self.name, request.moment_id, "no_data")
        return SpecialistReport(self.name, request.moment_id, "ok", findings=tuple(findings))

    @staticmethod
    def _style(ctx, moment, earlier, attacking) -> tuple[str, tuple[str, ...]]:
        """Counter when the attack won the ball within ten seconds and kept it for few passes."""
        won = next(
            (
                e
                for e in earlier
                if e["payload"]["type"] == "possession_change"
                and e["payload"].get("to_team_id") == attacking
            ),
            None,
        )
        if won is None or moment["event_time_ms"] - won["event_time_ms"] > COUNTER_MS:
            return "build-up", ()
        passes = [
            p
            for p in earlier
            if p["stream_sequence"] > won["stream_sequence"]
            and p["payload"]["type"] == "pass"
            and p["payload"].get("team_id") == attacking
        ]
        style = "counter" if len(passes) <= COUNTER_MAX_PASSES else "build-up"
        return style, (won["event_id"], *(p["event_id"] for p in passes))
