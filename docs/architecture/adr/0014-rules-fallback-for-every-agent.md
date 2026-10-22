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

Every executor has a rules twin in packages/agents/rules, chosen on timeout, 429 after one retry, 5xx or an open circuit. Fallbacks are recorded as `fallback_used` audit records (with `fallback_reason`) and as an SSE `status` event with `reason`.

Deviation: the contract pattern for `derivation_version` is `x.y.z`, so it cannot end with `+rules`. The label lives in the audit record and the status event instead. The status returns to `live` only when every wrapped agent is live again.

## Consequences

- The demo works before quota arrives and during outages.
- Two implementations to keep in step; golden tests cover both.

## Affects

- 04-agents.md §7
- 03-runtime-flows.md F2
