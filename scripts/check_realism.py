"""Check that simulated matches hit the realism targets in data/calibration/targets.json.

    uv run python scripts/check_realism.py --matches 200 [--workers 4] [--results DIR]

Runs services/simulation/run.cjs for seeds 1..N at full density (or reads an existing summary.json
with --results), prints simulated against target for every measure, names each miss and
exits 1 if there is one.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ROOT / "data" / "calibration" / "targets.json"
RUNNER = ROOT / "services" / "simulation" / "run.cjs"


def measure(matches: list[dict]) -> dict[str, float]:
    n = len(matches)
    goals = sum(sum(m["score"]) for m in matches)
    shots = sum(sum(m["shots"]) for m in matches)
    late = sum(1 for m in matches for g in m["goalMinutes"] if 75 < g <= 100)
    duels = sum(
        m["counts"].get(k, 0)
        for m in matches
        for k in ("aerial_duel", "slide_tackle", "take_on", "turnover")
    )
    return {
        "goals": goals / n,
        "draws": sum(1 for m in matches if m["score"][0] == m["score"][1]) / n,
        "nil_nil": sum(1 for m in matches if sum(m["score"]) == 0) / n,
        "shots": shots / n,
        "goals_per_shot": goals / shots if shots else 0.0,
        "passes": sum(sum(m["passes"]) for m in matches) / n,
        "duels": duels / n,
        "late_goals": late / goals if goals else 0.0,
        "penalty_goals": sum(m["penaltyGoals"] for m in matches) / goals if goals else 0.0,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", type=int, default=200)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--first-seed", type=int, default=1)
    ap.add_argument(
        "--results", type=Path, help="reuse a folder holding summary.json instead of running"
    )
    a = ap.parse_args()
    out = a.results
    if out is None:
        out = Path(tempfile.mkdtemp(prefix="realism-"))
        seeds = f"{a.first_seed}-{a.first_seed + a.matches - 1}"
        subprocess.run(
            [
                "node",
                str(RUNNER),
                "--seeds",
                seeds,
                "--half",
                "45",
                "--workers",
                str(a.workers),
                "--out",
                str(out),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    summary = json.loads((out / "summary.json").read_text())
    matches = summary["matches"]
    got = measure(matches)
    wall = sorted(m["wallMs"] for m in matches)
    print(
        f"{len(matches)} matches, half={summary['half']}, "
        f"median wall time {wall[len(wall) // 2] / 1000:.0f} s per match"
    )
    print(f"{'measure':34} {'simulated':>10} {'target':>9} {'band':>16}  result")
    misses = []
    for t in json.loads(TARGETS.read_text())["targets"]:
        v = got[t["id"]]
        ok = t["min"] <= v <= t["max"]
        if not ok:
            misses.append(t["label"])
        print(
            f"{t['label']:34} {v:10.3f} {t['value']:9.3f} "
            f"{t['min']:7.3f}-{t['max']:<7.3f}  {'ok' if ok else 'MISS'}"
        )
    if misses:
        print("outside the pass band: " + "; ".join(misses), file=sys.stderr)
        return 1
    print("all measures inside their pass bands")
    return 0


if __name__ == "__main__":
    sys.exit(main())
