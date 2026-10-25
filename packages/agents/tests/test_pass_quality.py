"""Pass quality (CREW-2.4, AB#491): distance and difficulty from engine positions."""

import json
from pathlib import Path

import pytest
from matchcast_agents.passes import pass_difficulty, pass_distance, pass_records

FIXTURE = Path(__file__).parent / "fixtures" / "match-short.json"


def _pass(start, end, **extra) -> dict:
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
    payload.update(extra)
    return {"event_id": "e1", "event_time_ms": 0, "payload": payload}


def test_distance_is_the_straight_line_between_start_and_end() -> None:
    assert pass_distance(_pass((0, 0), (3, 4))["payload"]) == 5.0


@pytest.mark.parametrize(
    ("distance", "rating"),
    [
        (0.0, 1),
        (9.9, 1),
        (10.0, 2),
        (19.9, 2),
        (20.0, 3),
        (29.9, 3),
        (30.0, 4),
        (44.9, 4),
        (45.0, 5),
        (60.0, 5),
    ],
)
def test_difficulty_rises_with_distance_in_documented_bands(distance, rating) -> None:
    assert pass_difficulty(distance) == rating


def test_the_band_uses_the_exact_distance_not_the_rounded_one() -> None:
    record = pass_records([_pass((0, 0), (9.96, 0))])[0]
    assert record["difficulty"] == 1
    assert record["distance_m"] == 10.0


def test_every_fixture_pass_matches_its_source_event() -> None:
    events = json.loads(FIXTURE.read_text())["events"]
    by_id = {e["event_id"]: e for e in events}
    records = pass_records(events)
    passes = [e for e in events if e["payload"]["type"] == "pass"]
    assert len(records) == len(passes) == 69
    for r in records:
        source = by_id[r["event_id"]]["payload"]
        assert r["player_id"] == source["player_id"]
        assert r["team_id"] == source["team_id"]
        assert r["distance_m"] == round(pass_distance(source), 1)
        assert r["difficulty"] == pass_difficulty(pass_distance(source))


@pytest.mark.parametrize(
    "payload",
    [
        _pass(None, (3, 4))["payload"] | {"start_position": None},
        _pass((0, 0), None)["payload"] | {"end_position": None},
        _pass((0, 0), None)["payload"] | {"player_id": None},
    ],
)
def test_a_pass_missing_a_position_or_an_actor_gets_no_record(payload) -> None:
    events = [{"event_id": "e1", "event_time_ms": 0, "payload": payload}]
    assert pass_records(events) == []


def test_a_pass_missing_a_key_gets_no_record_and_does_not_stop_the_others() -> None:
    no_start = _pass(None, (3, 4))
    good = _pass((0, 0), (3, 4))
    good["event_id"] = "e2"
    assert [r["event_id"] for r in pass_records([no_start, good])] == ["e2"]
