"""Core match metrics: xG, pass difficulty and quality, ball speed, pressure and moment score.

Formulas are documented in docs/metrics.md. Positions are metres on a 105 x 68 pitch, and
`attack_x` is the x of the goal the team attacks (105.0 or 0.0). All functions are pure.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

DERIVATION_VERSIONS = {
    "xg": "1.0.0",
    "pass_difficulty": "1.0.0",
    "pass_quality": "1.0.0",
    "ball_speed_kmh": "1.0.0",
    "pressure_index": "1.0.0",
    "moment_score": "1.0.0",
}

# Fitted on Wyscout open-play shots (CC BY 4.0) by scripts/fit_xg.py; see data/calibration/xg.json
XG_B0, XG_B1, XG_B2 = -1.464609, 1.413822, -0.089141
GOAL_WIDTH_M = 7.32
PITCH_WIDTH_M = 68.0
PENALTY_XG = 0.76


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


@dataclass(frozen=True)
class Frame:
    """Opponent and ball context at the moment of an event (positions in metres)."""

    opponents: Sequence[tuple[float, float]] = field(default_factory=tuple)


@dataclass(frozen=True)
class Shot:
    x: float
    y: float
    attack_x: float = 105.0
    kind: str = "open_play"  # open_play | header | free_kick | penalty
    body_part: str = "foot"  # foot | head


@dataclass(frozen=True)
class Pass:
    x0: float
    y0: float
    x1: float
    y1: float
    attack_x: float = 105.0
    completed: bool = True
    lofted: bool = False
    through_or_cross: bool = False
    weak_foot: bool = False


def _goal_geometry(x: float, y: float, attack_x: float) -> tuple[float, float]:
    dx = abs(attack_x - x)
    dy = y - PITCH_WIDTH_M / 2
    angle = math.atan2(GOAL_WIDTH_M * dx, dx * dx + dy * dy - (GOAL_WIDTH_M / 2) ** 2)
    if angle < 0:
        angle += math.pi
    return angle, math.hypot(dx, dy)


def _nearest(opponents: Sequence[tuple[float, float]], x: float, y: float) -> float:
    return min((math.hypot(ox - x, oy - y) for ox, oy in opponents), default=99.0)


def xg(shot: Shot, state: Frame | None = None) -> float:
    """Expected goals, 0-1. Penalty 0.76; a defender within 2 m x0.7, a header x0.8."""
    if shot.kind == "penalty":
        return PENALTY_XG
    angle, dist = _goal_geometry(shot.x, shot.y, shot.attack_x)
    p = 1.0 / (1.0 + math.exp(-(XG_B0 + XG_B1 * angle + XG_B2 * dist)))
    if shot.kind == "header" or shot.body_part == "head":
        p *= 0.8
    if state is not None and _nearest(state.opponents, shot.x, shot.y) < 2.0:
        p *= 0.7
    return _clamp(p, 0.005, 0.95)


def pass_difficulty(p: Pass, state: Frame | None = None) -> float:
    """0-100: six capped additive terms (distance, pressure, lane, marking, flight, weak foot)."""
    d = math.hypot(p.x1 - p.x0, p.y1 - p.y0)
    opp = state.opponents if state is not None else ()
    press = _nearest(opp, p.x0, p.y0)
    mark = _nearest(opp, p.x1, p.y1)
    lane = _lane_margin(p, opp)
    terms = {
        "distance": 30 * _clamp((d - 2) / 48, 0, 1),
        "pressure": 18 * _clamp((5 - press) / 4, 0, 1),
        "lane": 22 * _clamp((4 - lane) / 6, 0, 1),
        "marking": 15 * _clamp((5 - mark) / 4, 0, 1),
        "flight": (7 if p.lofted else 0) + (5 if p.through_or_cross else 0),
        "weak_foot": 8 if p.weak_foot else 0,
    }
    return _clamp(
        sum(math.floor(v + 0.5) for v in terms.values()), 0, 100
    )  # JS Math.round, not banker's rounding


def _lane_margin(p: Pass, opp: Sequence[tuple[float, float]]) -> float:
    """Smallest distance (m) from any opponent to the pass line, capped at 6 (6 = open lane)."""
    ax, ay, bx, by = p.x0, p.y0, p.x1, p.y1
    vx, vy = bx - ax, by - ay
    length2 = vx * vx + vy * vy
    best = 6.0
    for ox, oy in opp:
        t = 0.0 if length2 == 0 else _clamp(((ox - ax) * vx + (oy - ay) * vy) / length2, 0, 1)
        best = min(best, math.hypot(ox - (ax + t * vx), oy - (ay + t * vy)))
    return best


def pass_quality(p: Pass, state: Frame | None = None) -> float:
    """0-1 = outcome x (0.2 + 0.4 difficulty + 0.4 progression); outcome 1 or 0.25 if missed."""
    difficulty = pass_difficulty(p, state) / 100
    gain = (p.x1 - p.x0) * (1 if p.attack_x > 52.5 else -1)
    progression = _clamp(gain / 30, 0, 1)
    outcome = 1.0 if p.completed else 0.25
    return _clamp(outcome * (0.2 + 0.4 * difficulty + 0.4 * progression), 0, 1)


def ball_speed_kmh(
    samples: Sequence[tuple[float, float, float, float]],
    event_time_ms: float,
    window_ms: float = 500,
) -> float:
    """Ball speed in km/h from tracking samples (t_ms, x, y, z) within +/- window of the event.

    Speed is the 3D distance between the first and last sample in the window over their time gap.
    Returns 0.0 with fewer than two samples."""
    w = sorted(s for s in samples if abs(s[0] - event_time_ms) <= window_ms)
    if len(w) < 2 or w[-1][0] == w[0][0]:
        return 0.0
    (t0, x0, y0, z0), (t1, x1, y1, z1) = w[0], w[-1]
    return math.dist((x0, y0, z0), (x1, y1, z1)) / ((t1 - t0) / 1000) * 3.6


def pressure_index(x: float, y: float, state: Frame, radius_m: float = 5.0) -> float:
    """0-1 pressure: 0.7 nearest-opponent term (full at 1 m) + 0.3 crowding (3+ within radius)."""
    ds = [math.hypot(ox - x, oy - y) for ox, oy in state.opponents]
    near = _clamp((radius_m - min(ds, default=99.0)) / (radius_m - 1), 0, 1)
    crowd = min(sum(1 for d in ds if d <= radius_m), 3) / 3
    return 0.7 * near + 0.3 * crowd


_TYPE_SCORE = {
    "goal": 80.0,
    "penalty": 70.0,
    "red_card": 65.0,
    "corner": 20.0,
    "yellow_card": 15.0,
    "foul": 10.0,
    "pass": 5.0,
}


def moment_score(events: Sequence[dict], minute: float = 45.0, goal_margin: int = 0) -> float:
    """0-100 importance of a passage of play. `events` are dicts with `type` and, for shots, `xg`.

    Highest event score, +10 per further event (max +30), x1.1 after minute 75 and x1.1 when
    the goal margin is 1 or level."""
    scores = sorted(
        (
            _clamp(25 + 120 * float(e.get("xg", 0.0)), 25, 75)
            if e["type"] == "shot"
            else _TYPE_SCORE.get(e["type"], 0.0)
            for e in events
        ),
        reverse=True,
    )
    if not scores:
        return 0.0
    s = scores[0] + min(30.0, 10.0 * (len(scores) - 1))
    if minute >= 75:
        s *= 1.1
    if abs(goal_margin) <= 1:
        s *= 1.1
    return _clamp(s, 0, 100)
