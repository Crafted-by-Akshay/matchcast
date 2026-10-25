"""Pass quality from engine positions (CREW-2.4, AB#491).

A pass record holds the straight-line distance between its start and end positions, in metres, and
a difficulty rating from 1 to 5 set by distance: under 10 m is 1, under 20 m is 2, under 30 m is 3,
under 45 m is 4, and anything longer is 5. The engine does not record whether a pass was completed,
so no record claims it. A pass missing either position gets no record rather than a guessed one.
"""

import math
from typing import Any

# (upper bound in metres, rating): the first band whose bound the distance is under
DIFFICULTY_BANDS = ((10.0, 1), (20.0, 2), (30.0, 3), (45.0, 4))


def pass_distance(payload: dict[str, Any]) -> float:
    start, end = payload["start_position"], payload["end_position"]
    return math.dist((start["x"], start["y"]), (end["x"], end["y"]))


def pass_difficulty(distance_m: float) -> int:
    for bound, rating in DIFFICULTY_BANDS:
        if distance_m < bound:
            return rating
    return 5


def pass_records(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One record per pass that has both positions, in event order."""
    records = []
    for e in events:
        p = e["payload"]
        if p["type"] != "pass" or "start_position" not in p or "end_position" not in p:
            continue
        distance = round(pass_distance(p), 1)
        records.append(
            {
                "event_id": e["event_id"],
                "player_id": p["player_id"],
                "team_id": p["team_id"],
                "distance_m": distance,
                "difficulty": pass_difficulty(distance),
            }
        )
    return records
