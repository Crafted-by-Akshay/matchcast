"""Rhythm specialist (CREW-2.3, AB#486): control, swings and the why input, from raw events only."""

import asyncio

from matchcast_agents.context import MatchContext
from matchcast_agents.specialists import SpawnRequest
from matchcast_agents.specialists.rhythm import (
    STEP_MS,
    WINDOW_MS,
    RhythmSpecialist,
    readings,
    swings,
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


def _dominance(minutes: list[str]) -> list[dict]:
    """Each minute names the team on top: it makes 10 of every 12 passes in that minute."""
    events = []
    for minute, dominant in enumerate(minutes):
        other = "away" if dominant == "home" else "home"
        for k in range(12):
            team = dominant if k < 10 else other
            x = HOME_X if team == "home" else AWAY_X
            events.append(_event(len(events) + 1, minute * 60_000 + k * 5_000, _pass(team, x)))
    return events


def _context(events: list[dict], now_ms: int) -> MatchContext:
    return MatchContext(
        stream={"tenant_id": "demo", "session_id": "t", "match_id": "m"},
        roster={"team_ids": ["home", "away"]},
        names={},
        clubs={"home": "Northgate FC", "away": "Harbour United"},
        state=MatchState(event_time_ms=now_ms),
        events=tuple(events),
    )


def test_five_minutes_of_possession_and_tempo_reads_control_with_its_numbers() -> None:
    events = _dominance(["home"] * 5)
    last = readings(events, "home", "away", end_ms=5 * 60_000)[-1]
    assert last.control == "home"
    assert last.index >= 0.2
    assert last.counts["on_ball"]["home"] == 50 and last.counts["on_ball"]["away"] == 10
    assert last.counts["passes"]["home"] == 50


def test_index_flips_sign_when_the_other_team_takes_over_and_writes_a_swing() -> None:
    events = _dominance(["home"] * 6 + ["away"] * 6)
    series = readings(events, "home", "away", end_ms=12 * 60_000)
    found = swings(series)
    assert found, "a flip inside three minutes must be recorded"
    away_swing = next(s for s in found if s.to_team == "away")
    assert away_swing.from_team == "home"
    assert 7 <= away_swing.minute <= 12
    assert away_swing.before > 0 > away_swing.after


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


def test_the_specialist_reports_no_data_before_any_event() -> None:
    report = asyncio.run(
        RhythmSpecialist().run(_context([], now_ms=0), SpawnRequest("rhythm", "m-1", "", 0))
    )
    assert report.status == "no_data"
    assert report.findings == ()


def test_the_specialist_cites_event_ids_and_names_the_swing_in_the_why_line() -> None:
    events = _dominance(["home"] * 6 + ["away"] * 6)
    ctx = _context(events, now_ms=12 * 60_000)
    report = asyncio.run(RhythmSpecialist().run(ctx, SpawnRequest("rhythm", "m-9", "", 0)))
    assert report.status == "ok"
    assert report.findings, "the latest window is under a control reading"
    for finding in report.findings:
        assert finding.evidence_ids and all(i.startswith("e") for i in finding.evidence_ids)
    assert report.why is not None and "Harbour United" in report.why
    assert ctx.extra["rhythm"]["swings"], "swings go to match memory for the Showrunner"
    assert len(ctx.extra["rhythm"]["index"]) == 12 * 60_000 // STEP_MS


def test_the_window_is_five_minutes() -> None:
    assert WINDOW_MS == 5 * 60_000


def test_a_moment_at_time_zero_has_no_window_to_read() -> None:
    events = [_event(1, 0, _pass("home", HOME_X))]
    report = asyncio.run(
        RhythmSpecialist().run(_context(events, now_ms=0), SpawnRequest("rhythm", "m-0", "", 0))
    )
    assert report.status == "no_data"
