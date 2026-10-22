"""Build fixtures/match-short.json: ten minutes of a seeded match as contract 1.1.0 events.

Usage: uv run python packages/agents/tests/make_match_short.py
Stands in for the simulator until DAT-9 lands; every random draw comes from one seeded stream.
"""

import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

SEED = 20261022
STREAM = {"tenant_id": "demo", "session_id": "short", "match_id": "match-short"}
GIVEN = ["Arlo", "Bram", "Cato", "Dev", "Emil", "Finn", "Gus", "Hugo", "Ivo", "Joel", "Kian", "Leo"]
FAMILY = [
    "Ashby",
    "Brandt",
    "Costa",
    "Dunne",
    "Ellis",
    "Foss",
    "Gale",
    "Hale",
    "Ito",
    "Joss",
    "Kerr",
]
TEAMS = {"home": "Northgate FC", "away": "Harbour United"}
LENGTH, WIDTH = 105.0, 68.0


def build() -> dict:
    rng = random.Random(SEED)
    players = [{"player_id": f"{team}{n}", "team_id": team} for team in TEAMS for n in range(1, 12)]
    names = {
        p["player_id"]: f"{GIVEN[i % 12]} {FAMILY[(i * 5 + 3) % 11]}" for i, p in enumerate(players)
    }
    roster = {
        "kind": "roster",
        "schema_version": "1.1.0",
        "stream": STREAM,
        "pitch": {"length_m": LENGTH, "width_m": WIDTH},
        "ball_id": "ball-main",
        "team_ids": list(TEAMS),
        "players": players,
    }
    other = {"home": "away", "away": "home"}
    events: list[dict] = []
    start = datetime(2026, 10, 22, 10, 0, 0, tzinfo=UTC)

    def emit(t_ms: int, payload: dict) -> None:
        stamp = (start + timedelta(milliseconds=t_ms)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        sequence = len(events) + 1
        events.append(
            {
                "kind": "event",
                "schema_version": "1.1.0",
                "stream": STREAM,
                "event_id": f"e{sequence}",
                "stream_sequence": sequence,
                "revision": 0,
                "event_time_ms": t_ms,
                "emitted_at": stamp,
                "clock": {"period": 1, "period_elapsed_ms": t_ms},
                "payload": payload,
            }
        )

    def ground(x: float, y: float) -> dict:
        return {
            "x": round(min(max(x, 0.0), LENGTH), 1),
            "y": round(min(max(y, 0.0), WIDTH), 1),
            "z": 0,
        }

    def pick(team: str) -> str:
        return f"{team}{rng.randint(1, 11)}"

    emit(0, {"type": "period_boundary", "boundary": "started"})
    t, owner, ball_x, yellows, reds = 1500, "home", 52.5, set(), set()
    goals_left = 3
    while t < 600_000:
        t += rng.randint(2500, 7500)
        other_team = other[owner]
        forward = 1 if owner == "home" else -1
        goal_x = LENGTH if owner == "home" else 0.0
        roll = rng.random()
        if roll < 0.52:
            a, b = pick(owner), pick(owner)
            while b == a:
                b = pick(owner)
            nx = ball_x + forward * rng.uniform(-6, 14)
            emit(
                t,
                {
                    "type": "pass",
                    "player_id": a,
                    "team_id": owner,
                    "recipient_player_id": b,
                    "position_unit": "m",
                    "start_position": ground(ball_x, rng.uniform(5, 63)),
                    "end_position": ground(nx, rng.uniform(5, 63)),
                },
            )
            ball_x = min(max(nx, 3), 102)
        elif roll < 0.64:
            a = pick(owner)
            nx = ball_x + forward * rng.uniform(4, 16)
            emit(
                t,
                {
                    "type": "carry",
                    "player_id": a,
                    "team_id": owner,
                    "position_unit": "m",
                    "start_position": ground(ball_x, rng.uniform(5, 63)),
                    "end_position": ground(nx, rng.uniform(5, 63)),
                    "duration_ms": rng.randint(1200, 4200),
                },
            )
            ball_x = min(max(nx, 3), 102)
        elif roll < 0.72:
            emit(
                t,
                {
                    "type": "pressure",
                    "player_id": pick(other_team),
                    "team_id": other_team,
                    "target_player_id": pick(owner),
                    "position_unit": "m",
                    "position": ground(ball_x, rng.uniform(5, 63)),
                    "distance_m": round(rng.uniform(0.6, 4.5), 1),
                    "closing_speed_mps": round(rng.uniform(1.5, 6.5), 1),
                },
            )
        elif roll < 0.80:
            winner, loser = pick(other_team), pick(owner)
            won = rng.random() < 0.6
            emit(
                t,
                {
                    "type": "tackle",
                    "player_id": winner,
                    "team_id": other_team,
                    "target_player_id": loser,
                    "outcome": "won" if won else "lost",
                    "position_unit": "m",
                    "position": ground(ball_x, rng.uniform(5, 63)),
                },
            )
            if won:
                t += 400
                emit(
                    t,
                    {
                        "type": "possession_change",
                        "from_team_id": owner,
                        "to_team_id": other_team,
                        "cause": "tackle",
                    },
                )
                owner = other_team
        elif roll < 0.85:
            culprit, victim = pick(other_team), pick(owner)
            emit(
                t,
                {
                    "type": "foul",
                    "player_id": culprit,
                    "team_id": other_team,
                    "victim_player_id": victim,
                    "advantage": False,
                    "position_unit": "m",
                    "position": ground(ball_x, rng.uniform(5, 63)),
                },
            )
            if culprit not in yellows and rng.random() < 0.45:
                t += 800
                yellows.add(culprit)
                emit(
                    t,
                    {
                        "type": "card",
                        "player_id": culprit,
                        "team_id": other_team,
                        "colour": "yellow",
                        "reason": "Foul on a player in possession",
                    },
                )
            elif len(reds) == 0 and t > 380_000 and rng.random() < 0.5:
                t += 800
                reds.add(culprit)
                emit(
                    t,
                    {
                        "type": "card",
                        "player_id": culprit,
                        "team_id": other_team,
                        "colour": "red",
                        "reason": "Denying a clear goal-scoring chance",
                    },
                )
        else:
            shooter = pick(owner)
            on_target = rng.random() < 0.5
            sx = goal_x - forward * rng.uniform(8, 24)
            emit(
                t,
                {
                    "type": "shot",
                    "player_id": shooter,
                    "team_id": owner,
                    "position_unit": "m",
                    "position": ground(sx, rng.uniform(18, 50)),
                    "on_target": on_target,
                },
            )
            if on_target and goals_left and rng.random() < 0.5:
                t += 900
                goals_left -= 1
                emit(
                    t,
                    {
                        "type": "goal",
                        "player_id": shooter,
                        "team_id": owner,
                        "own_goal": False,
                        "position_unit": "m",
                        "position": ground(sx, rng.uniform(18, 50)),
                    },
                )
                owner = other_team
                ball_x = 52.5
    emit(600_000, {"type": "period_boundary", "boundary": "ended"})
    return {"teams": TEAMS, "names": names, "roster": roster, "events": events}


if __name__ == "__main__":
    out = Path(__file__).parent / "fixtures" / "match-short.json"
    out.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n")
    print(out)
