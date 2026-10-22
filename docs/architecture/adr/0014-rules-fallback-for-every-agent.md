# ADR-0014: Every agent has a deterministic rules twin

- **Status:** Accepted
- **Date:** 2026-10-19
- **Decided by:** Akshay (recover-from-failure requirement)

## Context

Model quota is pending, models can time out, and judges look for failure recovery.

## Options

1. Fail the line when the model fails
2. Run a rules implementation with the same interface and label it

## Decision

Every executor has a rules twin in packages/agents/rules, chosen on timeout, 429 after one retry, 5xx or an open circuit. Lines are labelled Rules fallback and derivation_version ends with +rules.

## Consequences

- The demo works before quota arrives and during outages.
- Two implementations to keep in step; golden tests cover both.

## Affects

- 04-agents.md §7
- 03-runtime-flows.md F2
