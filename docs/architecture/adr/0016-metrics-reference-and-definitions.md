# ADR-0016: Metrics are defined in `docs/metrics.md`, checked against a JavaScript reference

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Data lane, from the Quality lane's review of PR #17 (Akshay may overrule)

## Context

08 §2 asked for golden tests exported from the JavaScript prototype. The prototype has no `pass_quality`, `ball_speed_kmh`, `pressure_index` or `moment_score`, and its `passDifficulty` uses `laneSafety`, a timing margin that needs player velocities the event contract does not carry. Its xG was a hand-written exponential, replaced in DAT-9 by the Wyscout fit.

## Options

1. Export from the engine's own functions: only xG and pass difficulty exist, and the lane term cannot be rebuilt from contract events.
2. Define each metric once in `docs/metrics.md`, implement it in Python, and check it against an independent JavaScript reference of the same definition.

## Decision

Option 2. The reference restates the xG curve, the pass-difficulty terms and the new formulas. The lane term is the distance of the nearest opponent to the pass line, capped at 6 m. Ball speed is the distance over time across tracking samples within ±500 ms of the event, and `pressure_index` rejects `radius_m <= 1`.

## Consequences

- The Verifier and the Analyst share one formula, and a formula change bumps `derivation_version`.
- The golden test shows Python and JavaScript agree on the written definition, not that the engine's own numbers equal the metrics. Engine overlay values (for example `difficulty` on `pass` events) can differ from `pass_difficulty` until the engine is switched to the same definition.

## Affects

- 08-analytics-and-ml.md
- docs/metrics.md
