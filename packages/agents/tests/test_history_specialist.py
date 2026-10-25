"""History specialist (CREW-2.2, AB#391): real past meetings, each cited by its results row."""

import asyncio
import csv
from datetime import date

from matchcast_agents.context import MatchContext
from matchcast_agents.history import RESULTS, pre_match, resolve_team
from matchcast_agents.specialists import SpawnRequest
from matchcast_agents.specialists import history as history_module
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


def _rows() -> dict[int, dict[str, str]]:
    with RESULTS.open(newline="", encoding="utf-8") as fh:
        return dict(enumerate(csv.DictReader(fh), start=1))


def test_argentina_and_brazil_cite_exactly_the_real_meetings_by_results_row() -> None:
    report = _run(_context("Argentina", "Brazil"))
    assert report.status == "ok"
    today = date.today()
    played = pre_match("Argentina", "Brazil", on=today)["h2h"]["played"]
    rows = _rows()
    cited = report.findings[0].evidence_ids
    assert len(cited) == played
    for citation in cited:
        row = rows[int(citation.removeprefix("results:"))]
        assert {row["home_team"], row["away_team"]} == {"Argentina", "Brazil"}
        assert date.fromisoformat(row["date"]) < today


def test_the_last_meeting_finding_and_why_cite_the_last_row() -> None:
    report = _run(_context("Argentina", "Brazil"))
    last_row = _rows()[int(report.why_evidence[0].removeprefix("results:"))]
    last = pre_match("Argentina", "Brazil", on=date.today())["h2h"]["last_meeting"]
    assert last_row["date"] == last["date"]
    assert report.why is not None and last["date"] in report.why


def test_a_real_pair_with_no_past_meeting_gives_no_history_and_no_why() -> None:
    assert resolve_team("Abkhazia") and resolve_team("Afghanistan")
    report = _run(_context("Abkhazia", "Afghanistan"))
    assert report.status == "no_data"
    assert report.findings == ()
    assert report.why is None


def test_a_fictional_squad_never_gets_real_history() -> None:
    report = _run(_context("Northgate FC", "Harbour United"))
    assert report.status == "no_data"
    assert report.why is None


def test_a_missing_results_file_is_reported_as_failed_not_guessed(monkeypatch) -> None:
    def missing(*_args, **_kwargs):
        raise FileNotFoundError("results.csv")

    monkeypatch.setattr(history_module, "pre_match", missing)
    report = _run(_context("Argentina", "Brazil"))
    assert report.status == "failed"
    assert report.findings == () and report.why is None
