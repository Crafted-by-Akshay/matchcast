"""Rhythm specialist (CREW-2.3, AB#486): control, swings and the why input, from raw events only."""

import asyncio

from matchcast_agents.context import MatchContext
from matchcast_agents.specialists import SpawnRequest
from matchcast_agents.specialists.rhythm import (
    MIN_ON_BALL,
    STEP_MS,
    WINDOW_MS,
    Reading,
    RhythmSpecialist,
    reading,
    readings,
    swings,
    window,
)
from matchcast_agents.state import MatchState

HOME_X, AWAY_X = 60.0, 30.0  # home attacks towards x = 105 and away towards x = 0 in period 1


def _event(n: int, at_ms: int, payload: dict) -> dict:
    return {
        "event_id": f"e{n}",
        "stream_sequence": n,
        "event_time_ms": at_ms,
        "clock": {"period": 1, "period_elapsed_ms": at_ms},
        "payload": payload,
    }


def _pass(team: str, x: float) -> dict:
    return {
        "type": "pass",
        "team_id": team,
        "player_id": f"{team}4",
        "recipient_player_id": f"{team}5",
        "position_unit": "m",
        "start_position": {"x": x, "y": 34.0, "z": 0},
        "end_position": {"x": x + 5, "y": 30.0, "z": 0},
    }


def _dominance(minutes: list[str], home: str = "home", away: str = "away") -> list[dict]:
    """Each minute names the team on top: it makes 10 of every 12 passes in that minute.

    The first pass is a second in, so no event sits on a window's open start.
    """
    events = []
    for minute, dominant in enumerate(minutes):
        other = away if dominant == home else home
        for k in range(12):
            team = dominant if k < 10 else other
            x = HOME_X if team == home else AWAY_X
            at = minute * 60_000 + 1_000 + k * 5_000
            events.append(_event(len(events) + 1, at, _pass(team, x)))
    return events


def _context(
    events: list[dict],
    now_ms: int,
    home: str = "home",
    away: str = "away",
    names: tuple[str, str] = ("Northgate FC", "Harbour United"),
    max_sequence: int = 10**9,
) -> MatchContext:
    return MatchContext(
        stream={"tenant_id": "demo", "session_id": "t", "match_id": "m"},
        roster={"team_ids": [home, away]},
        names={},
        clubs={home: names[0], away: names[1]},
        state=MatchState(event_time_ms=now_ms, max_sequence=max_sequence),
        events=tuple(events),
    )


def _run(ctx: MatchContext):
    return asyncio.run(RhythmSpecialist().run(ctx, SpawnRequest("rhythm", "m-1", "", 0)))


def _reading(index: float, minute: int) -> Reading:
    return Reading(
        minute=minute, end_ms=minute * 60_000, index=index, control=None, chaos=0.0, counts={}
    )


def test_five_minutes_of_possession_and_tempo_reads_control_with_its_numbers() -> None:
    events = _dominance(["home"] * 5)
    now = reading(events, "home", "away", end_ms=5 * 60_000)
    assert now.control == "home"
    assert now.index >= 0.2
    assert now.counts["on_ball"]["home"] == 50 and now.counts["on_ball"]["away"] == 10
    assert now.counts["passes"]["home"] == 50


def test_too_few_on_ball_actions_claim_no_control() -> None:
    events = [_event(1, 1_000, _pass("home", HOME_X))]
    now = reading(events, "home", "away", end_ms=60_000)
    assert sum(now.counts["on_ball"].values()) < MIN_ON_BALL
    assert now.control is None


def test_index_flips_sign_when_the_other_team_takes_over_and_writes_a_swing() -> None:
    events = _dominance(["home"] * 6 + ["away"] * 6)
    found = swings(readings(events, "home", "away", end_ms=12 * 60_000), "home", "away")
    assert found, "a flip inside three minutes must be recorded"
    away_swing = next(s for s in found if s.to_team == "away")
    assert away_swing.from_team == "home"
    assert 7 <= away_swing.minute <= 12
    assert away_swing.before > 0 > away_swing.after


def test_a_flip_that_stays_flipped_is_one_swing_and_a_reversal_is_another() -> None:
    series = [_reading(0.5, m) for m in range(3)]
    series += [_reading(-0.5, m) for m in range(3, 6)]
    series += [_reading(0.5, m) for m in range(6, 9)]
    found = swings(series, "home", "away")
    assert [(s.minute, s.from_team, s.to_team) for s in found] == [
        (3, "home", "away"),
        (6, "away", "home"),
    ]


def test_the_same_events_always_give_the_same_readings() -> None:
    events = _dominance(["home", "away", "home", "away"])
    first = readings(events, "home", "away", end_ms=4 * 60_000)
    second = readings(events, "home", "away", end_ms=4 * 60_000)
    assert first == second


def test_events_after_the_moment_are_not_used() -> None:
    events = _dominance(["home"] * 3 + ["away"] * 3)
    cut = readings(events, "home", "away", end_ms=3 * 60_000)
    assert cut[-1].control == "home"
    assert all(r.minute <= 3 for r in cut)
    assert len(cut) == 3


def test_the_window_is_five_minutes_and_includes_the_moment_not_its_start() -> None:
    at_start = _event(1, 0, _pass("home", HOME_X))
    at_end = _event(2, WINDOW_MS, _pass("home", HOME_X))
    inside = window([at_start, at_end], WINDOW_MS)
    assert [e["event_id"] for e in inside] == ["e2"]


def test_the_specialist_reports_no_data_before_any_event() -> None:
    report = _run(_context([], now_ms=0))
    assert report.status == "no_data"
    assert report.findings == ()


def test_the_specialist_ignores_events_the_state_has_not_yet_seen() -> None:
    events = _dominance(["home"] * 5)  # stream sequences 1 to 60
    late = _event(1000, 4 * 60_000 + 30_000, _pass("away", AWAY_X))
    ctx = _context(events + [late], now_ms=5 * 60_000, max_sequence=60)
    report = _run(ctx)
    cited = {i for f in report.findings for i in f.evidence_ids}
    assert cited and "e1000" not in cited


def test_the_specialist_cites_event_ids_and_names_the_swing_in_the_why_line() -> None:
    events = _dominance(["home"] * 6 + ["away"] * 6)
    ctx = _context(events, now_ms=12 * 60_000)
    report = _run(ctx)
    assert report.status == "ok"
    assert report.findings, "the latest window is under a control reading"
    counted_ids = {e["event_id"] for e in window(events, 12 * 60_000)}
    for finding in report.findings:
        assert set(finding.evidence_ids) <= counted_ids and finding.evidence_ids
    assert report.why is not None and "Harbour United" in report.why
    swing_minute = ctx.extra["rhythm"]["swings"][-1]["minute"]
    at_swing = {e["event_id"] for e in window(events, swing_minute * 60_000)}
    assert report.why_evidence and set(report.why_evidence) == at_swing
    assert ctx.extra["rhythm"]["swings"], "swings go to match memory for the Showrunner"
    assert len(ctx.extra["rhythm"]["index"]) == 12 * 60_000 // STEP_MS


def test_a_why_line_names_a_club_whose_team_id_is_not_home_or_away() -> None:
    events = _dominance(["argentina"] * 6 + ["brazil"] * 6, home="argentina", away="brazil")
    ctx = _context(
        events, now_ms=12 * 60_000, home="argentina", away="brazil", names=("Argentina", "Brazil")
    )
    report = _run(ctx)
    assert report.why is not None and report.why.startswith("The rhythm swung to Brazil")
