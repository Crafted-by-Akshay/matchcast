# Fabric Real-Time Intelligence (DAT-7, DAT-8)

Files here are the whole Fabric side of MatchCast, so it can be rebuilt in minutes after a pause.

- `events.kql`: the Eventhouse commands (landing table `events_raw`, JSON mapping, `events` table, update policy).
- `queries.kql`: the four dashboard tiles (control vs chaos, pass quality leaders, shots and xG by team, events per minute).

Status: **written, not run**. No Fabric workspace exists yet and Kusto has no local emulator. The xG formula in tile 3 was checked against `packages/metrics` in Python (equal to 1e-15); the KQL syntax has not been executed.

## Set up (Mac mini or portal, about 30 minutes)

1. Capacity: Fabric F2 or the 60-day trial. Create workspace `MatchCast` on it. F2 costs about $0.36 an hour; keep it on about 12 hours in total (ADR and `docs/runbook-shutdown.md`).
2. Create Eventhouse `matchcast` with a KQL database `matchcast`. Run `events.kql` command by command.
3. Create an Eventstream. Source: Azure Event Hubs, namespace `evhns-matchcast-dev`, hub `match-events`, consumer group `$Default` (Basic tier has only one, ADR-0006), Entra auth through a cloud connection. If Fabric insists on a SAS key, put it in Key Vault and note it in `docs/infra.md`.
4. Eventstream destination: Eventhouse `matchcast`, table `events_raw`, data format JSON, mapping `events_raw_mapping`.
5. Create a Real-Time Dashboard with the four tiles from `queries.kql`, parameter `MatchId`, auto refresh 10 s.
6. Replay a match at 4x (`scripts/replay_match.py`, Event Hubs sink once it lands) and check `events | where match_id == "<match>" | count` equals the published count.
7. Film a 20 s clip, export screenshots into this folder, then **pause the capacity**: `docs/runbook-shutdown.md`, "Schedule".

## Known limits
- `events` keeps every revision of an event (a correction is a new row). Tiles read `EventsLatest()`, which keeps the newest revision and drops retractions.
- Control and chaos are per-minute proxies from event counts, not the 5-minute rolling indices of `packages/metrics`.
