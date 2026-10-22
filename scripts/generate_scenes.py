"""Generate the labelled synthetic scene dataset (DAT-5) from headless simulator matches.

    uv run python scripts/generate_scenes.py --count 240 --seed 2026 [--out data/scenes/v1]

Runs services/simulation/run.cjs for a block of match seeds starting at --seed, cuts each match into
30 s windows, labels each window with one of six scene families by fixed rules, then keeps the same
number of scenes per family (round-robin over seeds, so every family gets at least count/6).
Output is `scenes.parquet` (a row per event in a kept scene) and `manifest.json`.
The same --seed gives byte-identical files.

Label: `danger` is 1 when the event's team takes a shot in the 10 s after the event.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "services" / "simulation" / "run.cjs"
WINDOW_S = 30.0
DANGER_S = 10.0
FAMILIES = (
    "counter_attack",
    "high_press",
    "possession_build_up",
    "set_piece",
    "chaotic_scramble",
    "quiet_spell",
)
EVENT_TYPES = (
    "pass",
    "turnover",
    "shot",
    "take_on",
    "slide_tackle",
    "aerial_duel",
    "foul",
    "corner",
    "goal",
)
SET_PIECES = {"corner", "freekick", "penalty", "throw_in"}
SCHEMA = pa.schema(
    [
        ("scene_id", pa.string()),
        ("family", pa.string()),
        ("match_seed", pa.int32()),
        ("event_index", pa.int16()),
        ("t_rel_s", pa.float32()),
        ("minute", pa.float32()),
        ("type", pa.string()),
        ("team", pa.string()),
        ("phase", pa.string()),
        ("kind", pa.string()),
        ("dist_m", pa.float32()),
        ("quality", pa.float32()),
        ("difficulty", pa.float32()),
        ("xg", pa.float32()),
        ("x", pa.float32()),
        ("y", pa.float32()),
        ("own_x", pa.float32()),
        ("stamina", pa.float32()),
        ("passes_prev_10s", pa.int16()),
        ("turnovers_prev_10s", pa.int16()),
        ("shots_prev_10s", pa.int16()),
        ("danger", pa.int8()),
    ]
)


def classify(window: list[dict]) -> str:
    """Fixed rules, first match wins."""
    kinds = [e["type"] for e in window]
    passes = [e for e in window if e["type"] == "pass"]
    turns = [e for e in window if e["type"] == "turnover"]
    if any(k in SET_PIECES for k in kinds):
        return "set_piece"
    if sum(1 for e in passes if e.get("phase") == "counter") >= 2:
        return "counter_attack"
    if sum(1 for e in turns if e.get("ownX", 0) >= 66) >= 2:
        return "high_press"
    if len(turns) >= 6:
        return "chaotic_scramble"
    if len(passes) >= 12 and len(turns) <= 2:
        return "possession_build_up"
    if len(window) <= 12 and "shot" not in kinds:
        return "quiet_spell"
    return ""


def windows(events: list[dict]) -> list[list[dict]]:
    play = [e for e in events if e["type"] in EVENT_TYPES or e["type"] in SET_PIECES]
    out: list[list[dict]] = []
    if not play:
        return out
    t0, end = play[0]["simT"], play[-1]["simT"]
    t = t0
    while t < end:
        w = [e for e in play if t <= e["simT"] < t + WINDOW_S]
        if w:
            out.append(w)
        t += WINDOW_S
    return out


def rows_for(scene_id: str, family: str, seed: int, window: list[dict], context: list[dict]):
    base = window[0]["simT"]
    rows = []
    for i, e in enumerate(window):
        t = e["simT"]
        prev = [c for c in context if t - DANGER_S <= c["simT"] < t]
        nxt = [c for c in context if t < c["simT"] <= t + DANGER_S]
        rows.append(
            {
                "scene_id": scene_id,
                "family": family,
                "match_seed": seed,
                "event_index": i,
                "t_rel_s": round(t - base, 2),
                "minute": e["minute"],
                "type": e["type"],
                "team": e.get("team", ""),
                "phase": e.get("phase") or "",
                "kind": e.get("kind") or "",
                "dist_m": e.get("distM"),
                "quality": e.get("quality"),
                "difficulty": e.get("difficulty"),
                "xg": e.get("xg"),
                "x": e.get("x"),
                "y": e.get("y"),
                "own_x": e.get("ownX"),
                "stamina": e.get("stamina"),
                "passes_prev_10s": sum(1 for c in prev if c["type"] == "pass"),
                "turnovers_prev_10s": sum(1 for c in prev if c["type"] == "turnover"),
                "shots_prev_10s": sum(1 for c in prev if c["type"] == "shot"),
                "danger": int(
                    any(c["type"] == "shot" and c.get("team") == e.get("team") for c in nxt)
                ),
            }
        )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=240)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--matches", type=int, default=16)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--half", type=int, default=45)
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "scenes" / "v1")
    ap.add_argument("--events-dir", type=Path, help="reuse a folder of <seed>.json event logs")
    a = ap.parse_args()
    per_family = a.count // len(FAMILIES)

    events_dir = a.events_dir
    if events_dir is None:
        events_dir = Path(tempfile.mkdtemp(prefix="scenes-"))
        subprocess.run(
            ["node", str(RUNNER), "--seeds", f"{a.seed}-{a.seed + a.matches - 1}",
             "--half", str(a.half),
             "--workers", str(a.workers), "--events", "--out", str(events_dir)],
            check=True, stdout=subprocess.DEVNULL,
        )  # fmt: skip

    pools: dict[str, list[tuple[int, int, list[dict], list[dict]]]] = {f: [] for f in FAMILIES}
    for f in sorted(events_dir.glob("[0-9]*.json"), key=lambda p: int(p.stem)):
        m = json.loads(f.read_text())
        for n, w in enumerate(windows(m["events"])):
            fam = classify(w)
            if fam:
                pools[fam].append((m["seed"], n, w, m["events"]))

    scenes, counts = [], {}
    for fam in FAMILIES:
        # spread each family evenly over the matches: take every k-th candidate
        pool = pools[fam]
        step = max(1, len(pool) // per_family)
        picked = pool[::step][:per_family]
        counts[fam] = len(picked)
        scenes += [(fam, *p) for p in picked]
    rows = []
    for fam, seed, n, w, ctx in scenes:
        rows += rows_for(f"{fam}-{seed}-{n:03d}", fam, seed, w, ctx)
    cols = {name: [r[name] for r in rows] for name in SCHEMA.names}
    table = pa.Table.from_pydict(cols, schema=SCHEMA)
    a.out.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        table,
        a.out / "scenes.parquet",
        compression="snappy",
        version="2.6",
        data_page_version="2.0",
    )
    danger = sum(r["danger"] for r in rows)
    manifest = {
        "seed": a.seed, "matches": a.matches, "half": a.half, "scenes": len(scenes),
        "scenes_per_family": counts, "rows": len(rows),
        "danger_rate": round(danger / max(1, len(rows)), 4),
        "window_s": WINDOW_S, "danger_horizon_s": DANGER_S,
    }  # fmt: skip
    (a.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
