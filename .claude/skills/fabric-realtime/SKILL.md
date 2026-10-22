---
name: fabric-realtime
description: Use when setting up or filming the Microsoft Fabric Real-Time Intelligence dashboard (Eventstream, Eventhouse, KQL) fed from Event Hubs.
---

# Fabric Real-Time Intelligence

Design: `docs/architecture/08-analytics-and-ml.md` §5, `docs/architecture/07-data-and-storage.md` (Eventhouse), ADR-0006. Owner: Data lane. Not built yet; check `ls data/fabric`.

## Setup
- Workspace `MatchCast` on F2 (or the 60-day trial). Eventstream source: Event Hubs `match-events`, consumer group `$Default` (Event Hubs Basic has one consumer group, shared by every reader, ADR-0006), Entra auth, no connection string. Destination: Eventhouse `matchcast`, table `events`.
- Real-Time Dashboard with exactly four tiles: control vs chaos timeline, pass quality leaders, shots and xG by team, events per minute. Refresh 10 s. KQL saved in `data/fabric/queries.kql` so it is reviewable.
- Feed it with the replay publisher (DAT-1) in 4x mode so a whole match lands in a few minutes.

## Cost rule
Fabric capacity bills while running: about 12 active hours in total. Film a 20 s clip during a 4x replay, export screenshots, then pause the capacity (runbook). In the UI the Fabric tile reads "Paused after filming to save cost" and is a screenshot, clip and link, not a live embed. Never leave the capacity running overnight; do not delete it.
