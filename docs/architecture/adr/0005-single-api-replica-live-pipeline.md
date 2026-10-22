# ADR-0005: One api replica hosts the edge and the live pipeline

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Platform and Agents lanes

## Context

SSE clients, the Event Hubs consumer and the workflow need the same in-memory view of a match. Demo load is small, and the budget is about $49.

## Options

1. Separate worker container plus a pub/sub service (Web PubSub) for fan-out
2. api is both edge and consumer, max 1 replica, with checkpoints and resume

## Decision

api runs the consumer as a background task, the reducer (from services/worker) and the workflow, with max replicas 1 and KEDA scale from zero. State is checkpointed so a restart resumes within 60 s.

## Consequences

- Fewer moving parts and no extra service cost; the kill-and-resume clip shows the recovery.
- A single point of failure and a ceiling of about 50 concurrent viewers (accepted debt).

## Affects

- 02-context-and-containers.md
- 03-runtime-flows.md F9
- 13-deployment-and-operations.md
