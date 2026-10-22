# ADR-0003: Watch is the single live match source

- **Status:** Accepted
- **Date:** 2026-10-19
- **Decided by:** Akshay (decision card, option A)

## Context

The unified app ran one engine per view, so Watch, Broadcast and Analyst could show different scores for the same fixture.

## Options

1. A: Watch emits events; the others consume
2. B: one engine per view with a stated limit
3. C: one headless engine in the shell

## Decision

Option A. The Watch engine is the only source; Broadcast and Analyst render from bus messages and the api stream.

## Consequences

- Scores always match across views.
- Broadcast needs a consumer-mode refactor (EXP-2).

## Affects

- 11-frontend.md
- 03-runtime-flows.md F1
