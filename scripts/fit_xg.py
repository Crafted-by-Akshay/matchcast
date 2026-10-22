"""Fit the MatchCast xG curve on the Wyscout public events (Pappalardo et al. 2019, CC BY 4.0).

    xG = 1 / (1 + exp(-(b0 + b1 * angle + b2 * distance)))

angle is the angle (radians) the goal mouth subtends from the shot, distance is metres to the goal
centre. The raw events go to a temporary folder outside the repo and are never written into it;
only b0, b1, b2, the log-loss and counts go to data/calibration/xg.json. With --aggregates the same
download also yields per-match event rates for the realism targets (wyscout_rates.json).

    uv run python scripts/fit_xg.py [--events-dir DIR]   # DIR holds events_*.json
"""

from __future__ import annotations

import argparse
import json
import math
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

URL = "https://ndownloader.figshare.com/files/14464685"  # events.zip, figshare 7770599
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "calibration"
PITCH_X, PITCH_Y, GOAL_W = 105.0, 68.0, 7.32
GOAL_TAG = 101


def shot_features(x: float, y: float) -> tuple[float, float]:
    """Wyscout coordinates are percentages (0-100) with the attacked goal at x = 100."""
    dx = (100.0 - x) / 100.0 * PITCH_X
    dy = (y - 50.0) / 100.0 * PITCH_Y
    dist = math.hypot(dx, dy)
    angle = math.atan2(GOAL_W * dx, dx * dx + dy * dy - (GOAL_W / 2) ** 2)
    if angle < 0:
        angle += math.pi
    return angle, dist


def fit_logistic(X: np.ndarray, y: np.ndarray, iters: int = 50) -> np.ndarray:
    """Newton-Raphson (IRLS) logistic regression with an intercept column already in X."""
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1.0 / (1.0 + np.exp(-X @ b))
        grad = X.T @ (y - p)
        hess = (X * (p * (1 - p))[:, None]).T @ X + 1e-9 * np.eye(X.shape[1])
        step = np.linalg.solve(hess, grad)
        b += step
        if np.max(np.abs(step)) < 1e-10:
            break
    return b


def log_loss(y: np.ndarray, p: np.ndarray) -> float:
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def fetch_events(workdir: Path) -> Path:
    zpath = workdir / "events.zip"
    print(f"downloading {URL} to {workdir} (outside the repo)")
    urllib.request.urlretrieve(URL, zpath)  # noqa: S310 fixed https URL
    with zipfile.ZipFile(zpath) as z:
        z.extractall(workdir)
    return workdir


def scan(events_dir: Path):
    shots, rates, matches = [], {"shots": 0, "goals": 0, "passes": 0, "duels": 0}, set()
    for f in sorted(events_dir.glob("events_*.json")):
        for e in json.loads(f.read_text()):
            matches.add(e["matchId"])
            eid, sub = e["eventId"], e["subEventId"]
            tags = {t["id"] for t in e["tags"]}
            if eid == 10:  # shot
                rates["shots"] += 1
                rates["goals"] += GOAL_TAG in tags
                if sub == 100:  # open-play shot (33 free-kick shot, 35 penalty excluded)
                    pos = e["positions"][0]
                    shots.append((*shot_features(pos["x"], pos["y"]), int(GOAL_TAG in tags)))
            elif eid == 8:
                rates["passes"] += 1
            elif eid == 1:
                rates["duels"] += 1
    return np.array(shots), rates, len(matches)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events-dir", type=Path)
    a = ap.parse_args()
    tmp = None
    if a.events_dir is None:
        tmp = tempfile.TemporaryDirectory(prefix="wyscout-")
        a.events_dir = fetch_events(Path(tmp.name))
    data, rates, n_matches = scan(a.events_dir)
    X = np.column_stack([np.ones(len(data)), data[:, 0], data[:, 1]])
    y = data[:, 2]
    b = fit_logistic(X, y)
    ll = log_loss(y, 1.0 / (1.0 + np.exp(-X @ b)))
    base = log_loss(y, np.full_like(y, y.mean()))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "xg.json").write_text(
        json.dumps(
            {
                "model": "xg = 1 / (1 + exp(-(b0 + b1*angle_rad + b2*distance_m)))",
                "b0": round(float(b[0]), 6),
                "b1": round(float(b[1]), 6),
                "b2": round(float(b[2]), 6),
                "log_loss": round(ll, 5),
                "log_loss_constant_baseline": round(base, 5),
                "open_play_shots": int(len(y)),
                "open_play_goals": int(y.sum()),
                "source": "Wyscout soccer match event dataset, Pappalardo et al. 2019, CC BY 4.0",
                "source_url": "https://doi.org/10.6084/m9.figshare.7770599",
            },
            indent=2,
        )
        + "\n"
    )
    (OUT / "wyscout_rates.json").write_text(
        json.dumps(
            {
                "matches": n_matches,
                "per_match_both_teams": {k: round(v / n_matches, 2) for k, v in rates.items()},
                "goals_per_shot_all_shots": round(rates["goals"] / rates["shots"], 4),
                "note": "Aggregates only; shots include penalties and free kicks.",
                "source": "Wyscout soccer match event dataset, Pappalardo et al. 2019, CC BY 4.0",
            },
            indent=2,
        )
        + "\n"
    )
    print(
        f"b = {b.round(4).tolist()}  log-loss {ll:.4f} (constant {base:.4f})  "
        f"shots {len(y)}  matches {n_matches}"
    )
    print({k: round(v / n_matches, 1) for k, v in rates.items()})


if __name__ == "__main__":
    main()
