# Demo data

Everything here is synthetic. Clubs, players and stadiums are fictional; no real match events or names are used (see `docs/dataset-card.md` for what real data fed the calibration, as aggregate numbers only).

## The season

`apps/unified/sources/enterprise-console/data/M001.json` to `M028.json` hold a 28-match season produced by the headless engine. Each file has the events, the roster, the timeline and the setup (stadium, month, kick-off, seed). These matches were generated with `half = 15`, so each is a 30-minute match, before the DAT-9 recalibration. They stay as fixtures for the Analyst views and for replay. New full-length matches come from `services/simulation/run.cjs` (see `docs/simulator.md`).

## Three demo matches

Pick these for a demo or a replay test. Each shows something different.

| Match | Score | Seed | Why use it |
| --- | --- | --- | --- |
| M017 HAR v MON, The Arch, London, August, 12:30 | 2-1 | 1592 | Seven cards (5 yellow, 2 red). Shows discipline, the Verifier gate and a changed game after a red. |
| M025 HAR v TRV, The Arch, London, August, 12:30 | 3-3 | 1888 | Six goals and swings in the win odds. Best for the Broadcast view's calls and win probability. |
| M028 LOM v GUA, Arena Lombarda, Milan, August, 20:45 | 0-4 | 1999 | One-sided result with a red card. Shows the Analyst's control and chaos indices against the scoreline. |

## Replay a match

```
uv run python scripts/replay_match.py --match M025 --speed 4 --sink jsonl --out m025.jsonl
```

This turns the engine events into contract v1.1 events (goal, shot, pass, foul, card, possession change), validates each one against `packages/contracts`, and writes them in match order, paced at match time divided by `--speed`. `--sink http --url <api>` posts them to `POST /v1/matches/{id}/events` in batches of 50. `--no-wait` skips the pacing.

## Make a fresh match

```
node services/simulation/run.cjs --seeds 1-1 --half 45 --events --out /tmp/mc-run
```

The same seed gives the same events, at any playback speed and frame rate (the engine steps a fixed 0.02 s and carries the remainder). The runner derives the clubs, stadium and month from the seed and passes them in the query; `node services/simulation/run.cjs --seeds 2026 --url` prints that query so the live app plays the same match. A seed number plus that query is a complete match id.

## Cloud runs (24 Oct 2026)

Run from the Mac mini with `az login`; no key or token was stored. Azure had no VM capacity or quota for the planned classic cluster in East US 2 (`Standard_D4ds_v5` quota 0; `DS3_v2` and `D4ds_v4` stockout) or in Central US (`D4ds_v4` stockout), so the job ran on Databricks serverless jobs compute.

- Blob (DAT-5): `scenes/v1/` (`scenes.parquet` 42,794 B, `manifest.json` 336 B) and `models/danger/v1/` (`model.onnx` 98,807 B, `model-card.json`, `heldout-sample.json`) in `stmatchcastdev`; sizes match the repo files.
- Databricks (DAT-6): workspace `dbw-matchcast-cus` (Premium, Central US), catalog `dbw_matchcast_cus`, schemas `raw` and `ml`, managed volumes `raw/scenes` and `ml/models`. `train_danger.py` ran once (with the MLflow experiment set and the model name `dbw_matchcast_cus.ml.danger`, changed only in the uploaded copy). Held-out AUC 0.8855, Brier 0.0432 (base rate 0.0447), the same as the local run. Registered in Unity Catalog as `dbw_matchcast_cus.ml.danger`. ONNX export did not run in the serverless environment (`onnx: false` in its card); the ONNX in Blob is the local export. The run page reports a failure only because the script ends with `SystemExit(0)`. No compute is left running.
- Event Hubs (DAT-1): `replay_match.py --match M025 --speed 4 --sink eventhub` published 453 events to `match-events`. The live api stays in `direct` mode, so nothing consumed them; arrival at the hub was not counted.
- Fabric (DAT-7/8): skipped. The account has no Fabric license ("User is not licensed"), so there is no trial or workspace; no paid capacity was bought.
