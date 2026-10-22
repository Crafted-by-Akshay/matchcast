"""Control, chaos and tempo over a rolling window (DAT-4). Pure functions over event dicts.

Events are dicts with `type` and `t_ms`. A pass also has `team`, `completed`, `x0`, `y0`,
`x1`, `y1` and `attack_x` (the x of the goal that team attacks). Turnovers are
`type == "turnover"`; duels are `slide_tackle`, `take_on`, `aerial_duel` or `duel`. Formulas are in docs/metrics.md.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

INDEX_VERSION = "1.0.0"
WINDOW_MS = 300_000
DUEL_TYPES = frozenset({"slide_tackle", "take_on", "aerial_duel", "duel"})
DIRECTION_BINS = 8


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _window(events: Sequence[dict], now_ms: float, window_ms: float) -> list[dict]:
    return [e for e in events if now_ms - window_ms < e["t_ms"] <= now_ms]


def tempo(events: Sequence[dict], now_ms: float, window_ms: float = WINDOW_MS) -> float:
    """Passes per minute in the window."""
    passes = sum(1 for e in _window(events, now_ms, window_ms) if e["type"] == "pass")
    return passes / (window_ms / 60_000)


def _direction_entropy(passes: Sequence[dict]) -> float:
    """Entropy of pass directions in 8 bins, 0 (all one way) to 1 (evenly spread)."""
    if len(passes) < 2:
        return 0.0
    counts = [0] * DIRECTION_BINS
    for p in passes:
        a = math.atan2(p["y1"] - p["y0"], p["x1"] - p["x0"])
        counts[int(((a + math.pi) / (2 * math.pi)) * DIRECTION_BINS) % DIRECTION_BINS] += 1
    n = len(passes)
    return -sum(c / n * math.log(c / n) for c in counts if c) / math.log(DIRECTION_BINS)


def control_index(events: Sequence[dict], now_ms: float, window_ms: float = WINDOW_MS) -> float:
    """0-100. 35% possession stability (few turnovers), 35% pass completion, 30% territory.

    Stability = 1 - clamp((turnovers per minute - 1) / 5). Completion = clamp((rate - 0.6) / 0.32).
    Territory = how far the team with most passes moves the ball up the pitch
    (mean pass end, 40 m to 80 m)."""
    w = _window(events, now_ms, window_ms)
    passes = [e for e in w if e["type"] == "pass"]
    minutes = window_ms / 60_000
    stability = 1 - _clamp((sum(1 for e in w if e["type"] == "turnover") / minutes - 1) / 5)
    completion = (
        _clamp((sum(1 for p in passes if p["completed"]) / len(passes) - 0.6) / 0.32)
        if passes
        else 0.5
    )
    territory = 0.5
    if passes:
        teams = sorted({p["team"] for p in passes})
        lead = max(teams, key=lambda t: sum(1 for p in passes if p["team"] == t))
        ends = [
            abs(p["x1"] - (p["attack_x"] - 105 if p["attack_x"] > 52.5 else p["attack_x"]))
            for p in passes
            if p["team"] == lead
        ]
        territory = _clamp((sum(ends) / len(ends) - 40) / 40)
    return 100 * (0.35 * stability + 0.35 * completion + 0.30 * territory)


def chaos_index(events: Sequence[dict], now_ms: float, window_ms: float = WINDOW_MS) -> float:
    """0-100. 40% turnover rate (6 a minute is full), 30% duel density (12 a minute is full),
    30% ball-direction entropy."""
    w = _window(events, now_ms, window_ms)
    minutes = window_ms / 60_000
    turnovers = _clamp(sum(1 for e in w if e["type"] == "turnover") / minutes / 6)
    duels = _clamp(sum(1 for e in w if e["type"] in DUEL_TYPES) / minutes / 12)
    entropy = _direction_entropy([e for e in w if e["type"] == "pass"])
    return 100 * (0.4 * turnovers + 0.3 * duels + 0.3 * entropy)


def rolling_series(
    events: Sequence[dict], end_ms: float, step_ms: float = 60_000, window_ms: float = WINDOW_MS
) -> list[dict]:
    """One point per step: the three indices over the window ending then (for the sparkline)."""
    out = []
    t = step_ms
    while t <= end_ms:
        out.append(
            {
                "t_ms": t,
                "control": control_index(events, t, window_ms),
                "chaos": chaos_index(events, t, window_ms),
                "tempo": tempo(events, t, window_ms),
            }
        )
        t += step_ms
    return out
