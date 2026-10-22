---
name: databricks-mlflow
description: Use when building the Azure Databricks jobs (danger classifier, xG fit), MLflow tracking, Unity Catalog or model export for MatchCast.
---

# Databricks and MLflow

Design: `docs/architecture/08-analytics-and-ml.md` §4, `docs/architecture/06-simulation.md` (xG), stories DAT-5 to DAT-7. Owner: Data lane. Status: not built yet in the repo; `data/` holds only `calibration/xg.json` and `wyscout_rates.json`, and `scripts/fit_xg.py` is the local xG fit. Check `ls data/databricks` first.

## Plan
- Workspace `dbw-matchcast-dev` (Premium, East US 2). One single-node jobs cluster `Standard_D4ds_v5` (fallback `Standard_DS3_v2`), auto-terminate when the run ends. Never leave all-purpose compute running.
- Code: `data/databricks/train_danger.py` and `fit_xg.py` as a Databricks Asset Bundle `data/databricks/databricks.yml`.
- `train-danger`: gradient-boosted classifier, label = a shot within the next 10 s, 80/20 split by match (not by row), log params, AUC, Brier score and a calibration plot to MLflow experiment `matchcast-danger`, register in Unity Catalog `matchcast.ml.danger`, export ONNX plus `model-card.json` to Blob `models/danger/<version>/`.
- `fit-xg`: logistic regression on angle and distance; log log-loss and a reliability plot; write `b0..b2` to `data/calibration/xg.json` (commit it). Source data is Wyscout (CC BY 4.0), kept in a temporary DBFS folder and never committed. Never use the EA-derived Kaggle European Soccer DB.

## Rules
- Training data is the synthetic scenes only (seeded). No real player or club data.
- The Python `xg` in `packages/metrics` must agree with the fitted constants; update the golden cases when `xg.json` changes (`docs/metrics.md`).
- `predict_danger` serves the ONNX model from Blob; the UI shows the model version and says Simulated if no model is loaded.
- After the runs: stop all compute, record run URLs and metrics in `docs/data.md`. Auth by Entra (`az login`); no token in the bundle or repo.
