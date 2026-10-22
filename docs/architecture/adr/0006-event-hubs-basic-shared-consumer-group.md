# ADR-0006: Event Hubs Basic with one shared consumer group

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Platform lane

## Context

Basic allows 1 consumer group per hub (Microsoft Learn, Compare Event Hubs tiers); Standard allows 20 but costs more per hour. We have three readers: api, fn-recap, Fabric.

## Options

1. Standard tier with a consumer group per reader
2. Basic with all readers on $Default, each with its own checkpoints

## Decision

Basic, all readers on $Default, separate checkpoint folders in Blob eh-checkpoints (Fabric keeps its own position). A consumer group allows up to 5 readers per partition. The backlog's named consumer groups (api, state, recap, fabric) are replaced by $Default.

## Consequences

- Lowest cost.
- If readers interfere, move to Standard (risk R6).

## Affects

- 07-data-and-storage.md §7
- 12-api.md §5
