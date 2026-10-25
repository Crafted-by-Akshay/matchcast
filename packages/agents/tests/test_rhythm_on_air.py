"""Rhythm on air (CREW-2.3): a goal's rhythm swing reaches the analyst's line, checked."""

from conftest import run
from matchcast_agents.specialists import Finding
from matchcast_agents.specialists.base import SpecialistReport
from matchcast_agents.specialists.rhythm import recount_share, share_percent
from matchcast_agents.store import MemoryStore
from test_rundown import build


class _Swung:
    """A Rhythm specialist that found the rhythm swing to the home side at the goal's minute."""

    name = "rhythm"

    def __init__(self, end_ms: int) -> None:
        self.end_ms = end_ms

    async def run(self, ctx, request):
        ctx.extra["rhythm"] = {
            "index": [],
            "swings": [],
            "swing": {"team": "home", "end_ms": self.end_ms},
        }
        finding = Finding(text="rhythm", figures={}, evidence_ids=())
        return SpecialistReport(
            self.name, request.moment_id, "ok", findings=(finding,), why="swung"
        )


def _first_goal(match) -> dict:
    return next(e for e in match["events"] if e["payload"]["type"] == "goal")


def _analyst_line(flow, goal):
    moment = f"m-{goal['event_id']}"
    analyst = [line for line in flow.store.lines(flow.sk) if line.persona == "analyst"]
    return next(line for line in analyst if line.moment_id == moment)


def test_a_goal_after_a_swing_says_how_much_of_the_ball_the_side_had(match) -> None:
    goal = _first_goal(match)
    flow = build(match, MemoryStore())
    flow._specialists["rhythm"] = _Swung(end_ms=goal["event_time_ms"])
    run(flow.ingest(match["events"]))
    claims = [c["packet"] for c in flow.store.claims(flow.sk)]
    share = next(c for c in claims if c["metric"].startswith("rhythm_share:home-"))
    assert share["value"] == share_percent(
        [e for e in match["events"] if e["stream_sequence"] <= goal["stream_sequence"]],
        "home", goal["event_time_ms"], flow.roster["team_ids"][0], flow.roster["team_ids"][1],
    )  # fmt: skip
    line = _analyst_line(flow, goal)
    assert f"{share['value']}% of the on-ball actions" in line.text
    assert line.checks and all(check.passed for check in line.checks)
    assert len(line.text) <= 280


def test_without_a_swing_the_analyst_line_says_nothing_of_rhythm(match) -> None:
    goal = _first_goal(match)
    flow = build(match, MemoryStore())
    run(flow.ingest(match["events"]))
    assert not any(
        c["packet"]["metric"].startswith("rhythm_share:") for c in flow.store.claims(flow.sk)
    )
    assert "on-ball" not in _analyst_line(flow, goal).text


def test_a_share_that_disagrees_with_the_log_is_refused(match, monkeypatch) -> None:
    """The Verifier recounts the share from the events: a claim off by five points is not aired."""
    from matchcast_agents.rules import analyst

    goal = _first_goal(match)
    real = analyst.share_percent
    monkeypatch.setattr(analyst, "share_percent", lambda *args: real(*args) + 5)
    flow = build(match, MemoryStore())
    flow._specialists["rhythm"] = _Swung(end_ms=goal["event_time_ms"])
    run(flow.ingest(match["events"]))
    line = _analyst_line(flow, goal)
    assert line.status != "verified"
    assert any(check.name == "numbers" and not check.passed for check in line.checks)


def _renamed(events: list[dict], names: dict[str, str]) -> list[dict]:
    """The events with their team ids renamed, so a test can use a team key that has a hyphen."""
    renamed = []
    for event in events:
        payload = dict(event["payload"])
        for key in ("team_id", "to_team_id"):
            if payload.get(key) in names:
                payload[key] = names[payload[key]]
        renamed.append({**event, "payload": payload})
    return renamed


def test_a_team_id_with_a_hyphen_still_recounts_to_the_same_share(match) -> None:
    """The window end is the digits after the last hyphen, so a hyphen in the team id is safe."""
    goal = _first_goal(match)
    end_ms = goal["event_time_ms"]
    renamed = _renamed(match["events"], {"home": "north-side"})
    upto = max(e["stream_sequence"] for e in renamed)
    share = share_percent(match["events"], "home", end_ms, "home", "away")
    assert share_percent(renamed, "north-side", end_ms, "north-side", "away") == share
    assert (
        recount_share(renamed, f"rhythm_share:north-side-{end_ms}", upto, "north-side", "away")
        == share
    )


def test_long_club_names_keep_the_goal_line_within_its_limit_with_a_swing(match) -> None:
    """The swing clause is added only while the line fits: a long name never loses the line."""
    goal = _first_goal(match)
    flow = build(match, MemoryStore())
    flow.clubs = {
        flow.roster["team_ids"][0]: "Bosnia and Herzegovina",
        flow.roster["team_ids"][1]: "Trinidad and Tobago",
    }
    flow._specialists["rhythm"] = _Swung(end_ms=goal["event_time_ms"])
    run(flow.ingest(match["events"]))
    line = _analyst_line(flow, goal)
    assert len(line.text) <= 280
    assert line.checks and all(check.passed for check in line.checks)
