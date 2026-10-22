import math
import random

from matchcast_metrics import chaos_index, control_index, rolling_series, tempo

MIN = 60_000


def calm(rng, start, end):
    """Settled passing: mostly forward and sideways short passes, rare turnovers."""
    out, t = [], start
    while t < end:
        out.append({"type": "pass", "t_ms": t, "team": "A", "completed": rng.random() < 0.9,
                    "x0": 50, "y0": 34, "x1": 60 + rng.random() * 10, "y1": 34 + rng.random() * 4,
                    "attack_x": 105})  # fmt: skip
        t += 5_000
    out += [{"type": "turnover", "t_ms": s} for s in range(start + 40_000, end, 120_000)]
    return out


def scramble(rng, start, end):
    """Loose ball: many turnovers and duels, passes in every direction."""
    out, t = [], start
    while t < end:
        a = rng.random() * 6.283
        team = "AB"[int(rng.random() * 2)]
        out.append({"type": "pass", "t_ms": t, "team": team, "completed": rng.random() < 0.55,
                    "x0": 50, "y0": 34, "x1": 50 + 8 * math.cos(a), "y1": 34 + 8 * math.sin(a),
                    "attack_x": 105})  # fmt: skip
        out.append({"type": "turnover", "t_ms": t + 500})
        out.append({"type": "slide_tackle", "t_ms": t + 900})
        t += 2_500
    return out


def match():
    rng = random.Random(7)
    return (
        calm(rng, 0, 30 * MIN) + scramble(rng, 30 * MIN, 36 * MIN) + calm(rng, 36 * MIN, 60 * MIN)
    )


def test_chaos_rises_above_match_average_in_a_scramble():
    events = match()
    series = rolling_series(events, 60 * MIN)
    average = sum(p["chaos"] for p in series) / len(series)
    scramble_peak = max(p["chaos"] for p in series if 33 * MIN <= p["t_ms"] <= 36 * MIN)
    assert scramble_peak > average * 1.5


def test_control_falls_in_a_scramble():
    events = match()
    assert control_index(events, 35 * MIN) < control_index(events, 28 * MIN)


def test_tempo_counts_passes_per_minute():
    events = [{"type": "pass", "t_ms": i * 6_000, "team": "A", "completed": True, "x0": 0, "y0": 0,
               "x1": 1, "y1": 0, "attack_x": 105} for i in range(1, 51)]  # fmt: skip
    assert tempo(events, 5 * MIN) == 10.0


def test_indices_are_bounded_and_empty_safe():
    assert 0 <= control_index([], MIN) <= 100
    assert chaos_index([], MIN) == 0.0
    assert tempo([], MIN) == 0.0


def mirror(events):
    out = []
    for e in events:
        if e["type"] == "pass":
            e = {**e, "x0": 105 - e["x0"], "x1": 105 - e["x1"], "attack_x": 0}
        out.append(e)
    return out


def test_control_is_the_same_when_the_team_attacks_the_other_way():
    events = calm(random.Random(3), 0, 5 * MIN)
    assert math.isclose(control_index(events, 5 * MIN), control_index(mirror(events), 5 * MIN))
