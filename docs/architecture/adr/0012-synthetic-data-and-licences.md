# ADR-0012: Synthetic data, CC0 assets, aggregate-only calibration

- **Status:** Accepted
- **Date:** 2026-10-18 (assets), 2026-10-22 (data sources)
- **Decided by:** Akshay

## Context

Rules require synthetic, football-realistic data and licensed third-party material (§4.3, §4.7, §4.11).

## Options

1. Use real event data directly
2. Generate synthetic matches and calibrate them to aggregate statistics from openly licensed data

## Decision

Synthetic only. Calibrate to Wyscout (CC BY 4.0) and martj42 (CC0) aggregates; StatsBomb optional with credit; no EA-derived Kaggle data; CC0 3D assets with our own motion; fictional names only.

## Consequences

- No rights risk.
- Credit lines needed in the README and dataset card.

## Affects

- 06-simulation.md
