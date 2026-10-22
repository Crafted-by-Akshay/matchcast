# Databricks notebook source
"""Train the danger-moment model (DAT-6).

Reads the scene Parquet written by scripts/generate_scenes.py (DAT-5), trains a gradient-boosted
classifier for `danger` (the event's team shoots within 10 s), logs to MLflow when it is installed
(always, on Databricks), and exports `model.onnx` plus `model-card.json`.

    Databricks job : set SCENES to an abfss:// or /Volumes path, and UC_MODEL to the Unity Catalog name.
    Local          : python data/databricks/train_danger.py --scenes data/scenes/v1/scenes.parquet --out out/danger

Validation is by match, never by event: every event of a match seed lands on the same side of the
split, so the score is not inflated by near-duplicate neighbours.
"""

# COMMAND ----------
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score

TYPES = ("pass", "turnover", "shot", "take_on", "slide_tackle", "aerial_duel", "foul", "corner", "goal")
NUMERIC = ("t_rel_s", "dist_m", "quality", "difficulty", "xg", "x", "y", "own_x", "stamina",
           "passes_prev_10s", "turnovers_prev_10s", "shots_prev_10s")  # fmt: skip
SEED = 2026
HOLDOUT_SHARE = 0.25
UC_MODEL = "matchcast.ml.danger"


def feature_names(phases: list[str], kinds: list[str]) -> list[str]:
    return (list(NUMERIC) + [f"type={t}" for t in TYPES] + [f"phase={p}" for p in phases]
            + [f"kind={k}" for k in kinds])  # fmt: skip


def load(path: str):
    t = pq.read_table(path).to_pydict()
    n = len(t["danger"])
    phases = sorted({p or "" for p in t["phase"]})
    kinds = sorted({k or "" for k in t["kind"]})
    rows = np.zeros((n, len(feature_names(phases, kinds))), dtype=np.float32)
    for j, c in enumerate(NUMERIC):
        rows[:, j] = [np.nan if v is None else v for v in t[c]]
    off = len(NUMERIC)
    for i in range(n):
        if t["type"][i] in TYPES:
            rows[i, off + TYPES.index(t["type"][i])] = 1
        rows[i, off + len(TYPES) + phases.index(t["phase"][i] or "")] = 1
        rows[i, off + len(TYPES) + len(phases) + kinds.index(t["kind"][i] or "")] = 1
    return rows, np.array(t["danger"], dtype=np.int8), np.array(t["match_seed"]), phases, kinds


def split_by_match(seeds: np.ndarray) -> np.ndarray:
    """True for held-out rows. Whole matches go to one side."""
    uniq = np.array(sorted(set(seeds.tolist())))
    rng = np.random.default_rng(SEED)
    held = set(rng.choice(uniq, size=max(1, math.ceil(len(uniq) * HOLDOUT_SHARE)), replace=False))
    return np.array([s in held for s in seeds.tolist()])


def calibration_bins(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:], strict=True):
        m = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        if m.any():
            out.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": int(m.sum()),
                        "predicted": round(float(p[m].mean()), 4),
                        "observed": round(float(y[m].mean()), 4)})  # fmt: skip
    return out


def export_onnx(model, n_features: int, path: Path) -> bool:
    try:
        from skl2onnx import to_onnx
    except ImportError:
        return False
    onx = to_onnx(model, np.zeros((1, n_features), dtype=np.float32),
                  options={id(model): {"zipmap": False}}, target_opset=17)  # fmt: skip
    path.write_bytes(onx.SerializeToString())
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--scenes", required=True)
    ap.add_argument("--out", default="out/danger")
    ap.add_argument("--version", default="1")
    a = ap.parse_args()

    X, y, seeds, phases, kinds = load(a.scenes)
    names = feature_names(phases, kinds)
    held = split_by_match(seeds)
    model = HistGradientBoostingClassifier(
        max_iter=200, learning_rate=0.06, max_depth=4, l2_regularization=1.0, random_state=SEED
    ).fit(X[~held], y[~held])
    p = model.predict_proba(X[held])[:, 1]
    metrics = {
        "auc": round(float(roc_auc_score(y[held], p)), 4),
        "brier": round(float(brier_score_loss(y[held], p)), 4),
        "base_rate_brier": round(float(brier_score_loss(y[held], np.full(held.sum(), y[~held].mean()))), 4),
        "train_rows": int((~held).sum()),
        "heldout_rows": int(held.sum()),
        "heldout_matches": len(set(seeds[held].tolist())),
        "positive_rate": round(float(y.mean()), 4),
    }  # fmt: skip
    card = {
        "name": UC_MODEL, "version": a.version, "label": "danger = same-team shot within 10 s",
        "features": names, "metrics": metrics, "calibration": calibration_bins(y[held], p),
        "training_data": "synthetic scenes from scripts/generate_scenes.py; no real match data",
        "limits": "learned from simulator events; probabilities describe the simulator, not real football",
    }  # fmt: skip

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    onnx_ok = export_onnx(model, X.shape[1], out / "model.onnx")
    card["onnx"] = onnx_ok
    (out / "model-card.json").write_text(json.dumps(card, indent=2) + "\n")
    # held-out probabilities let predict_danger be checked against this run to within 0.001
    sample = np.flatnonzero(held)[:10]
    (out / "heldout-sample.json").write_text(json.dumps(
        [{"features": X[i].tolist(), "p": round(float(model.predict_proba(X[i:i + 1])[0, 1]), 6)}
         for i in sample]) + "\n")  # fmt: skip

    try:
        import mlflow
        import mlflow.sklearn
    except ImportError:
        mlflow = None
    if mlflow:
        with mlflow.start_run(run_name="train-danger"):
            mlflow.log_params({"model": "HistGradientBoosting", "max_iter": 200, "max_depth": 4, "seed": SEED})
            mlflow.log_metrics({k: v for k, v in metrics.items() if isinstance(v, float)})
            mlflow.log_artifacts(str(out))
            mlflow.sklearn.log_model(model, "model", registered_model_name=UC_MODEL)  # type: ignore[attr-defined]
    print(json.dumps(metrics))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
