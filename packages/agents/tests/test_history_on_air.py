"""History on air (CREW-2.2): a goal's History finding reaches the analyst's line, checked."""

from conftest import run
from matchcast_agents.specialists import Finding
from matchcast_agents.specialists.base import SpecialistReport
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
    flow = build(match, MemoryStore(), history=HISTORY)  # the History specialist is not spawned
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
