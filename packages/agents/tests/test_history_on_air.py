"""History on air (CREW-2.2): a goal's History finding reaches the analyst's line, checked."""

from datetime import date
from types import SimpleNamespace

from conftest import run
from matchcast_agents.history import pre_match
from matchcast_agents.specialists import Finding
from matchcast_agents.specialists.base import SpawnRequest, SpecialistReport
from matchcast_agents.specialists.history import HistorySpecialist
from matchcast_agents.store import MemoryStore
from test_rundown import build

HISTORY = {"h2h": {"played": 12, "home_wins": 5, "draws": 3, "away_wins": 4}}


class _Found:
    """A History specialist that found a record: its finding is the source of the claim."""

    name = "history"

    def __init__(self, meetings: int = 12) -> None:
        self.meetings = meetings

    async def run(self, ctx, request):
        finding = Finding(
            text=f"met {self.meetings} times",
            figures={"meetings": self.meetings},
            evidence_ids=("results:1",),
        )
        return SpecialistReport(self.name, request.moment_id, "ok", findings=(finding,))


def _first_goal(match) -> dict:
    return next(e for e in match["events"] if e["payload"]["type"] == "goal")


def _analyst_line(flow, goal) -> str:
    moment = f"m-{goal['event_id']}"
    analyst = [line for line in flow.store.lines(flow.sk) if line.persona == "analyst"]
    lines = [line for line in analyst if line.moment_id == moment]
    assert lines, "the analyst has a line for the goal"
    return lines[0]


def test_a_goal_with_a_history_finding_says_how_often_the_sides_met(match) -> None:
    goal = _first_goal(match)
    flow = build(match, MemoryStore(), history=HISTORY)
    flow._specialists["history"] = _Found()
    run(flow.ingest(match["events"]))
    metrics = {c["packet"]["metric"]: c["packet"]["value"] for c in flow.store.claims(flow.sk)}
    assert metrics[f"h2h_played:{flow.roster['team_ids'][0]}"] == 12
    line = _analyst_line(flow, goal)
    assert "They have met 12 times on record." in line.text
    assert line.checks and all(check.passed for check in line.checks)


def test_without_a_history_finding_the_analyst_line_says_nothing_of_meetings(match) -> None:
    goal = _first_goal(match)
    flow = build(match, MemoryStore(), history=HISTORY)  # spawned, but no real club: no_data
    run(flow.ingest(match["events"]))
    assert not any(c["packet"]["metric"].startswith("h2h_") for c in flow.store.claims(flow.sk))
    assert "on record" not in _analyst_line(flow, goal).text


def test_a_history_finding_that_disagrees_with_the_record_is_refused(match) -> None:
    """The Verifier recounts the meetings from the same history: a finding of 11 is not aired."""
    goal = _first_goal(match)
    flow = build(match, MemoryStore(), history=HISTORY)
    flow._specialists["history"] = _Found(meetings=11)
    run(flow.ingest(match["events"]))
    line = _analyst_line(flow, goal)
    assert line.status != "verified"
    assert any(check.name == "numbers" and not check.passed for check in line.checks)


def test_the_history_specialist_counts_the_meetings_before_the_match_cut() -> None:
    """The Verifier recounts against the match's history cut, so the specialist counts the same
    meetings: not the ones up to today."""
    names = {"ARG": "Argentina", "BRA": "Brazil"}
    cut = date(1950, 1, 1)
    ctx = SimpleNamespace(
        home="ARG", away="BRA", club_name=names.__getitem__, extra={"history_on": cut.isoformat()}
    )
    request = SpawnRequest(name="history", moment_id="m-1", objective="history", token_budget=0)
    report = run(HistorySpecialist().run(ctx, request))
    before_cut = pre_match("Argentina", "Brazil", on=cut)["h2h"]["played"]
    up_to_today = pre_match("Argentina", "Brazil", on=date.today())["h2h"]["played"]
    assert before_cut < up_to_today  # the cut matters for this pair
    assert report.status == "ok"
    assert report.findings[0].figures["meetings"] == before_cut
    assert len(report.findings[0].evidence_ids) == before_cut


def test_one_past_meeting_reads_once_on_record(match) -> None:
    goal = _first_goal(match)
    flow = build(
        match,
        MemoryStore(),
        history={"h2h": {"played": 1, "home_wins": 1, "draws": 0, "away_wins": 0}},
    )
    flow._specialists["history"] = _Found(meetings=1)
    run(flow.ingest(match["events"]))
    assert "They have met once on record." in _analyst_line(flow, goal).text


def test_long_club_names_keep_the_analyst_line_within_its_limit(match) -> None:
    """The meetings clause is added only while the line fits: a long name never loses the line."""
    goal = _first_goal(match)
    flow = build(match, MemoryStore(), history=HISTORY)
    flow.clubs = {
        flow.roster["team_ids"][0]: "Bosnia and Herzegovina",
        flow.roster["team_ids"][1]: "Trinidad and Tobago",
    }
    flow._specialists["history"] = _Found()
    run(flow.ingest(match["events"]))
    line = _analyst_line(flow, goal)
    assert len(line.text) <= 280
    assert line.checks and all(check.passed for check in line.checks)
