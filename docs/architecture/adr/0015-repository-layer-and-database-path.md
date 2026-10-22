# ADR-0015: Repository layer, and the path to a database if one is ever needed

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** Akshay (22 Oct 2026); Data lane

## Context

ADR-0007 chose Table Storage, Blob and DuckDB, with no database server, for cost. Akshay asked what happens if a feature needs a database. Without a rule, a lane could add one ad hoc, with keys in settings and an unplanned monthly cost.

## Options

1. No rule: decide case by case
2. Repository interfaces now, a fixed decision list, and Cosmos DB for NoSQL serverless (partition key `/sk`) as the default if a database is ever justified
3. Move to a database now

## Decision

Option 2. All storage access goes through the repositories in `packages/agents/matchcast_agents/store.py` with `TableStore` and `MemoryStore` implementations and one shared contract test suite. A database is added only after the four questions in 07-data-and-storage.md §12 all answer no, with its own ADR approved by Akshay. The default is Cosmos DB for NoSQL serverless with managed identity; PostgreSQL Flexible Server Burstable B1ms only if relational joins are the need.

## Consequences

- Nothing changes in the cost plan today.
- Tests run without Azure (`MemoryStore`) and against Azurite (`TableStore`).
- Changing the store later is limited to one module, Bicep and a copy script.
- A small extra layer of code to write in AGT-2 and DAT-2.

## Affects

- 07-data-and-storage.md
- 16-testing-and-quality.md
- 19-engineering-practices.md
