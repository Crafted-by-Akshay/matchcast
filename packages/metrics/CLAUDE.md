# Data lane (packages/metrics, services/simulation, services/worker, data/, scripts/ for fit, build and replay; packages/shared is not in the doc 19 §1 table yet, shared by all lanes, change it with care)

Read first: root `CLAUDE.md`, then `docs/architecture/06-simulation.md`, `07-data-and-storage.md`, `08-analytics-and-ml.md`, `09-vision-identification.md`, ADR-0004, 0006, 0007, 0010, 0012, 0015, 0016, `docs/metrics.md`.
Skills: `databricks-mlflow`, `fabric-realtime`, `matchcast-contracts`, `tdd-workflow`, `verification-loop`, `handoff`. Agents: `tester`, `explorer`.

- Metric functions are pure and versioned (`DERIVATION_VERSIONS`). A formula change bumps the version, updates `docs/metrics.md` and regenerates `golden/golden.json`.
- Randomness only through seeded sub-streams. Real data only as aggregate statistics from CC0 or licensed sources; never real events, players or clubs. Record licences in the README credits.
- Event Hubs Basic has one consumer group: every reader uses `$Default` (ADR-0006).
- Databricks and Fabric run on the Mac mini; stop compute and pause capacity when done.
