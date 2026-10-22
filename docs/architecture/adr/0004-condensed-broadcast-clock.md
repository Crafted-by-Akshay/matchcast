# ADR-0004: Simulate the full 90 minutes and show a condensed broadcast

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Akshay (decision card, option A)

## Context

Five-minute halves gave 0.7 to 1.3 goals and 3 to 5 shots a match and about 50% draws. Real football has about 2.7 goals, 25 shots and 24% draws.

## Options

1. A: full-density engine, live key passages, fast-forward quiet spells
2. B: short halves with shot and goal weights scaled up

## Decision

Option A. The director plays passages scoring ≥ 0.5 live and fast-forwards the rest at 20x. If the headless timing test exceeds 60 s per 90 minutes, the live view falls back to B and the dataset keeps full density.

## Consequences

- Every count (passes, duels, shots, goals) can match real football.
- Needs a performance test first and the DAT-10 director.

## Affects

- 06-simulation.md
