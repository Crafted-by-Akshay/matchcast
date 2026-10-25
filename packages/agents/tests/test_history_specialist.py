"""History specialist (CREW-2.2, AB#391): real past meetings, each cited by its results row."""

import asyncio
import csv
from datetime import date

from matchcast_agents.context import MatchContext
from matchcast_agents.history import RESULTS, pre_match
from matchcast_agents.specialists import SpawnRequest
from matchcast_agents.specialists.history import HistorySpecialist
from matchcast_agents.state import MatchState


def _context(home: str, away: str) -> MatchContext:
    return MatchContext(
        stream={"tenant_id": "demo", "session_id": "t", "match_id": "m"},
        roster={"team_ids": ["home", "away"]},
        names={},
        clubs={"home": home, "away": away},
        state=MatchState(event_time_ms=0),
        events=(),
    )


def _run(ctx: MatchContext):
    return asyncio.run(HistorySpecialist().run(ctx, SpawnRequest("history", "m-1", "", 0)))


def _row(number: int) -> dict[str, str]:
    with RESULTS.open(newline="", encoding="utf-8") as fh:
        for n, row in enumerate(csv.DictReader(fh), start=1):
            if n == number:
                return row
    raise AssertionError(f"no results row {number}")


def test_argentina_and_brazil_cite_real_past_meetings_by_results_row() -> None:
    report = _run(_context("Argentina", "Brazil"))
    assert report.status == "ok"
    assert report.findings
    last = pre_match("Argentina", "Brazil", on=date.today())["h2h"]["last_meeting"]
    cited = [i for f in report.findings for i in f.evidence_ids]
    assert cited and all(i.startswith("results:") for i in cited)
    rows = [_row(int(i.removeprefix("results:"))) for i in cited]
    assert any(r["date"] == last["date"] for r in rows)


def test_a_pair_with_no_past_meeting_gives_no_history_and_no_why() -> None:
    report = _run(_context("Brazil", "Atlantis FC"))
    assert report.status == "no_data"
    assert report.findings == ()
    assert report.why is None


def test_a_fictional_squad_never_gets_real_history() -> None:
    report = _run(_context("Northgate FC", "Harbour United"))
    assert report.status == "no_data"
    assert report.why is None
