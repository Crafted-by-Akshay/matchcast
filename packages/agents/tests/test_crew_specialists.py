"""Replay, Tactics and Stats specialists, and the goal fan-out (CREW-2.1, CREW-2.2 crew)."""

import asyncio

from matchcast_agents.context import MatchContext
from matchcast_agents.specialists import SpawnBudget, plan_spawns
from matchcast_agents.specialists.base import SpawnRequest
from matchcast_agents.specialists.runner import default_registry, run_all
from matchcast_agents.state import MatchState, apply

PITCH_CENTRE_Y = 34.0


def _event(n: int, at_ms: int, payload: dict) -> dict:
    return {
        "event_id": f"e{n}",
        "stream_sequence": n,
        "event_time_ms": at_ms,
        "clock": {"period": 1, "period_elapsed_ms": at_ms},
        "payload": payload,
    }


def _pass(team: str, player: str, to: str, x: float) -> dict:
    return {
        "type": "pass",
        "team_id": team,
        "player_id": player,
        "recipient_player_id": to,
        "position_unit": "m",
        "start_position": {"x": x, "y": PITCH_CENTRE_Y, "z": 0},
        "end_position": {"x": x + 6, "y": PITCH_CENTRE_Y, "z": 0},
    }


def _goal_move() -> list[dict]:
    """Home wins the ball, makes six passes over twelve seconds, and scores at 14 seconds."""
    turnover = {"type": "possession_change", "from_team_id": "away", "to_team_id": "home"}
    events = [_event(1, 0, {**turnover, "cause": "tackle"})]
    chain = ["home1", "home2", "home3", "home4", "home5", "home6", "home7"]
    for k in range(6):
        events.append(
            _event(2 + k, (2 + 2 * k) * 1000, _pass("home", chain[k], chain[k + 1], 60.0 + k))
        )
    goal_at = {"x": 95.0, "y": PITCH_CENTRE_Y, "z": 0}
    goal = {"type": "goal", "team_id": "home", "player_id": "home7", "position_unit": "m",
            "position": goal_at}  # fmt: skip
    events.append(_event(8, 14_000, goal))
    return events


def _context(events: list[dict]) -> MatchContext:
    state = MatchState()
    for event in events:  # the state the counts come from, as the workflow builds it
        state = apply(state, event)
    return MatchContext(
        stream={"tenant_id": "demo", "session_id": "t", "match_id": "m"},
        roster={"team_ids": ["home", "away"]},
        names={"home7": "Diego Alvarez", "home1": "Luis Ortega"},
        clubs={"home": "Northgate FC", "away": "Harbour United"},
        state=state,
        events=tuple(events),
    )


def _run(requests, ctx):
    return asyncio.run(run_all(ctx, requests, default_registry()))


def _goal_requests(ctx: MatchContext, budget: SpawnBudget):
    available = ("replay", "tactics", "stats", "rhythm")
    return plan_spawns(priority=1, moment_id="m-e8", available=available, budget=budget)


def test_a_goal_fans_out_into_replay_tactics_stats_and_rhythm_in_parallel() -> None:
    events = _goal_move()
    ctx = _context(events)
    plan = _goal_requests(ctx, SpawnBudget(50))
    reports = _run(plan.requests, ctx)
    assert {r.name for r in reports} == {"replay", "tactics", "stats", "rhythm"}
    assert all(r.status in ("ok", "no_data") for r in reports)


def test_replay_tells_the_build_up_passes_and_seconds_with_event_ids() -> None:
    ctx = _context(_goal_move())
    report = _run([SpawnRequest("replay", "m-e8", "", 0)], ctx)[0]
    assert report.status == "ok"
    finding = report.findings[0]
    assert finding.figures["passes"] == 6
    assert finding.figures["seconds"] == 12
    assert "Luis Ortega" in finding.text and "Diego Alvarez" in finding.text
    assert set(finding.evidence_ids) == {f"e{n}" for n in range(2, 8)}


def test_tactics_names_the_pressing_team_and_the_side_of_the_move() -> None:
    events = _goal_move()
    events.insert(0, _event(0, 500, {"type": "pressure", "team_id": "away",
                                     "player_id": "away4", "target_player_id": "home2",
                                     "position_unit": "m", "position": {"x": 60, "y": 30, "z": 0},
                                     "distance_m": 1.0, "closing_speed_mps": 2.0}))  # fmt: skip
    ctx = _context(events)
    report = _run([SpawnRequest("tactics", "m-e8", "", 0)], ctx)[0]
    assert report.status == "ok"
    texts = " ".join(f.text for f in report.findings)
    assert "Harbour United made 1 pressure" in texts
    assert "centre" in texts and "counter" not in texts.lower()


def test_tactics_calls_a_quick_move_after_a_turnover_a_counter() -> None:
    """Three passes after the turnover, then the goal five seconds on: a counter."""
    quick = _goal_move()[:4]  # the turnover, then passes at 2 s and 4 s and 6 s
    goal_at = {"x": 95.0, "y": PITCH_CENTRE_Y, "z": 0}
    goal = _event(
        8,
        5_000,
        {
            "type": "goal",
            "team_id": "home",
            "player_id": "home7",
            "position_unit": "m",
            "position": goal_at,
        },
    )
    report = _run([SpawnRequest("tactics", "m-e8", "", 0)], _context(quick + [goal]))[0]
    assert any("counter" in f.text for f in report.findings)


def test_stats_reuses_the_analyst_metrics_and_cites_the_shot_events() -> None:
    shot = _event(0, 1_000, {"type": "shot", "team_id": "home", "player_id": "home6",
                             "position_unit": "m", "position": {"x": 88.0, "y": 34.0, "z": 0},
                             "on_target": True})  # fmt: skip
    events = [shot] + _goal_move()
    ctx = _context(events)
    report = _run([SpawnRequest("stats", "m-e8", "", 0)], ctx)[0]
    assert report.status == "ok"
    home = next(f for f in report.findings if "Northgate FC" in f.text)
    assert home.figures["shots"] == 1
    assert home.evidence_ids == ("e0",)


def test_a_quiet_spell_spawns_one_specialist() -> None:
    ctx = _context(_goal_move())
    plan = plan_spawns(
        priority=3, moment_id="m-e8", available=("replay", "tactics", "stats"),
        budget=SpawnBudget(50),
    )  # fmt: skip
    assert len(_run(plan.requests, ctx)) == 1


def test_no_moment_event_means_no_data_not_a_guess() -> None:
    ctx = _context(_goal_move())
    report = _run([SpawnRequest("replay", "m-missing", "", 0)], ctx)[0]
    assert report.status == "no_data" and report.findings == ()


def test_apply_is_the_reducer_the_stats_counts_come_from() -> None:
    state = MatchState()
    assert apply(state, _goal_move()[-1]).score == {"home": 1}
