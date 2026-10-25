"""History specialist: the last meetings and form of two nations, from real results (CREW-2.2).

It answers from the martj42 CC0 results file (ADR-0020) and never from a fictional squad. Each
finding cites the results rows it counted, as ``results:<row>``, so the Verifier can recount it
against the file. A pair with no past meeting gets ``no_data`` and no why line, so the Narrator
writes no history claim.
"""

from datetime import date

from ..context import MatchContext
from ..history import meeting_rows, pre_match, resolve_team
from .base import Finding, SpawnRequest, SpecialistReport


class HistorySpecialist:
    name = "history"

    async def run(self, ctx: MatchContext, request: SpawnRequest) -> SpecialistReport:
        home_name = ctx.club_name(ctx.home)
        away_name = ctx.club_name(ctx.away)
        if resolve_team(home_name) is None or resolve_team(away_name) is None:
            return SpecialistReport(self.name, request.moment_id, "no_data")

        block = pre_match(home_name, away_name, on=date.today())
        h2h = block["h2h"]
        if h2h["played"] == 0:
            return SpecialistReport(self.name, request.moment_id, "no_data")

        rows = tuple(f"results:{n}" for n in meeting_rows(home_name, away_name, on=date.today()))
        last = h2h["last_meeting"]
        last_home, last_away = (int(x) for x in last["score"].split("-"))
        findings = (
            Finding(
                text=(
                    f"{home_name} and {away_name} have met {h2h['played']} times: "
                    f"{h2h['home_wins']} wins for {home_name}, {h2h['draws']} draws, "
                    f"{h2h['away_wins']} wins for {away_name}"
                ),
                figures={
                    "meetings": h2h["played"],
                    "home_wins": h2h["home_wins"],
                    "draws": h2h["draws"],
                    "away_wins": h2h["away_wins"],
                },
                evidence_ids=rows,
            ),
            Finding(
                text=(
                    f"The last meeting was on {last['date']}, {last['score']} "
                    f"({last['competition']})"
                ),
                figures={"last_home_goals": last_home, "last_away_goals": last_away},
                evidence_ids=(rows[-1],),
            ),
        )
        why = (
            f"{home_name} and {away_name} last met on {last['date']}, {last['score']} "
            f"({last['competition']})"
        )
        return SpecialistReport(self.name, request.moment_id, "ok", findings=findings, why=why)
