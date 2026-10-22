# ADR-0013: Lines, not claims, are the unit of verification and approval

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Agents lane

## Context

One claim can be worded for five personas, and the wording is what can mislead. The backlog's approve route was written per claim.

## Options

1. Approve claims
2. Approve lines (one persona's text), with the claim's approval_status set when any of its lines is approved

## Decision

Lines carry the verdict and the approval. Routes are /v1/lines/{line_id}/approve, edit and kill. The contract's claim approval_status mirrors its lines.

## Consequences

- The Verifier and the Producer judge exactly what viewers will see.
- One extra table (lines).

## Affects

- 04-agents.md
- 07-data-and-storage.md
- 12-api.md
