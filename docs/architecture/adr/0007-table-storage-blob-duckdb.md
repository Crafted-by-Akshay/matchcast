# ADR-0007: Table Storage and Blob for state; DuckDB for season queries

- **Status:** Accepted
- **Date:** 2026-10-18 (Cosmos dropped), 2026-10-22 (DuckDB)
- **Decided by:** Akshay (cost); Data lane

## Context

All live access is by match and sequence. Season analytics need SQL over 28 matches. Budget rules out an always-on database.

## Options

1. Cosmos DB
2. Azure SQL serverless
3. Table Storage + Blob, with DuckDB reading Parquet in the mcp container

## Decision

Table Storage for match data keyed by the stream key; Blob for files and Parquet; DuckDB in mcp, read-only, SELECT on allowed views only.

## Consequences

- Pennies a month, managed identity throughout.
- No cross-match live queries in Tables; the season uses DuckDB instead.

## Affects

- 07-data-and-storage.md
- 08-analytics-and-ml.md
