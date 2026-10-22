"""Writes indices-golden.json: a seeded 60-minute match and the Python results for it.

The match has settled play, a scramble from minute 30 to 36, then settled play again.
apps/unified/embed/indices.js is a JavaScript port of matchcast_metrics.indices;
tests/e2e/indices.spec.ts holds it to these numbers.
    uv run python packages/metrics/golden/export_indices_golden.py \\
        > packages/metrics/golden/indices-golden.json
"""

import json
import math
import random

from matchcast_metrics import chaos_index, control_index, rolling_series, tempo

MIN = 60_000


def build():
    rng = random.Random(11)
    events = []
    t = 0
    while t < 60 * MIN:
        scramble = 30 * MIN <= t < 36 * MIN
        a = rng.random() * 2 * math.pi
        team = "AB"[int(rng.random() * 2)] if scramble else ("A" if rng.random() < 0.7 else "B")
        flip = team == "B"
        x0 = 20 + rng.random() * 60
        length = 6 + rng.random() * (6 if scramble else 20)
        completed = rng.random() < (0.55 if scramble else 0.88)
        y0 = round(10 + rng.random() * 48, 3)
        reach = length * math.cos(a) * (1 if scramble else 0.9)
        push = 0 if scramble else (-10 if flip else 10)
        x1 = round(max(0, min(105, x0 + reach + push)), 3)
        y1 = round(max(0, min(68, 34 + length * math.sin(a))), 3)
        events.append(
            {
                "type": "pass",
                "t_ms": t,
                "team": team,
                "completed": completed,
                "x0": round(x0, 3),
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "attack_x": 0 if flip else 105,
            }
        )
        if rng.random() < (0.5 if scramble else 0.04):
            events.append({"type": "turnover", "t_ms": t + 400, "team": team})
        if rng.random() < (0.4 if scramble else 0.05):
            kind = ["slide_tackle", "take_on", "aerial_duel", "duel"][int(rng.random() * 4)]
            events.append({"type": kind, "t_ms": t + 700, "team": team})
        t += int((2_500 if scramble else 4_000) + rng.random() * 1_500)
    events.sort(key=lambda e: e["t_ms"])
    return events


def main():
    events = build()
    probes = [
        0,
        30_000,
        4 * MIN,
        12 * MIN,
        29 * MIN,
        33 * MIN,
        35 * MIN,
        41 * MIN,
        59 * MIN,
        60 * MIN,
    ]
    out = {
        "events": events,
        "probes": [
            {
                "now_ms": n,
                "control": control_index(events, n),
                "chaos": chaos_index(events, n),
                "tempo": tempo(events, n),
            }
            for n in probes
        ],
        "series": rolling_series(events, 60 * MIN),
    }
    print(json.dumps(out, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
