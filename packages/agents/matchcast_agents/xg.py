"""Team xG for claims: the shared shot model summed over the stored events (never agent state)."""

from collections.abc import Iterable
from typing import Any

from matchcast_metrics import DERIVATION_VERSIONS, Shot
from matchcast_metrics import xg as shot_xg

PITCH_LENGTH_M = 105.0
VERSION = DERIVATION_VERSIONS["xg"]


def team_xg(events: Iterable[dict[str, Any]], team: str, upto: int) -> float:
    """Sum of shot xG for ``team`` up to a sequence.

    A shot is taken at the goal it attacks, so the attacking end is the half of the pitch the shot
    is in. That holds in every period whatever the teams' direction, with no side convention.
    """
    total = 0.0
    for event in events:
        payload = event["payload"]
        if event["stream_sequence"] > upto or payload["type"] != "shot":
            continue
        if payload.get("team_id") != team:
            continue
        position = payload["position"]
        attack_x = PITCH_LENGTH_M if position["x"] > PITCH_LENGTH_M / 2 else 0.0
        total += shot_xg(Shot(x=position["x"], y=position["y"], attack_x=attack_x))
    return round(total, 2)
