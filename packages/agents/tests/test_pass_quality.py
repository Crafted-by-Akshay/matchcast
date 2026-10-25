"""Pass quality (CREW-2.4, AB#491): distance and difficulty from engine positions."""

import json
from pathlib import Path

from matchcast_agents.passes import pass_difficulty, pass_distance, pass_records

FIXTURE = Path(__file__).parent / "fixtures" / "match-short.json"


def _pass(start: tuple[float, float] | None, end: tuple[float, float] | None) -> dict:
    payload = {
        "type": "pass",
        "team_id": "home",
        "player_id": "home4",
        "recipient_player_id": "home5",
        "position_unit": "m",
    }
    if start is not None:
        payload["start_position"] = {"x": start[0], "y": start[1], "z": 0}
    if end is not None:
        payload["end_position"] = {"x": end[0], "y": end[1], "z": 0}
    return {"event_id": "e1", "event_time_ms": 0, "payload": payload}


def test_distance_is_the_straight_line_between_start_and_end() -> None:
    assert pass_distance(_pass((0, 0), (3, 4))["payload"]) == 5.0


def test_difficulty_rises_with_distance_in_documented_bands() -> None:
    assert [pass_difficulty(d) for d in (5, 15, 25, 40, 60)] == [1, 2, 3, 4, 5]


def test_every_pass_in_the_fixture_gets_a_record_with_distance_and_difficulty() -> None:
    events = json.loads(FIXTURE.read_text())["events"]
    records = pass_records(events)
    passes = [e for e in events if e["payload"]["type"] == "pass"]
    assert len(records) == len(passes) == 69
    for r in records:
        assert 0 <= r["distance_m"] <= 110
        assert r["difficulty"] in (1, 2, 3, 4, 5)
        assert r["event_id"] and r["player_id"]


def test_a_pass_without_positions_gets_no_record_rather_than_a_guess() -> None:
    assert pass_records([_pass(None, (3, 4))]) == []
    assert pass_records([_pass((0, 0), None)]) == []
