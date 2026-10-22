# Demo data

Everything here is synthetic. Clubs, players and stadiums are fictional; no real match events or names are used (see `docs/dataset-card.md` for what real data fed the calibration, as aggregate numbers only).

## The season

`apps/unified/sources/enterprise-console/data/M001.json` to `M028.json` hold a 28-match season produced by the headless engine. Each file has the events, the roster, the timeline and the setup (stadium, month, kick-off, seed). These matches were generated with `half = 15`, so each is a 30-minute match, before the DAT-9 recalibration. They stay as fixtures for the Analyst views and for replay. New full-length matches come from `services/simulation/run.cjs` (see `docs/simulator.md`).

## Three demo matches

Pick these for a demo or a replay test. Each shows something different.

| Match | Score | Seed | Why use it |
| --- | --- | --- | --- |
| M017 HAR v MON, The Arch, London, August, 12:30 | 2-1 | 1592 | Seven cards (5 yellow, 2 red). Shows discipline, the Verifier gate and a changed game after a red. |
| M025 HAR v TRV, The Arch, London, August, 12:30 | 3-3 | 1888 | Six goals and swings in the win odds. Best for the Broadcast view's calls and win probability. |
| M028 LOM v GUA, Arena Lombarda, Milan, August, 20:45 | 0-4 | 1999 | One-sided result with a red card. Shows the Analyst's control and chaos indices against the scoreline. |

## Replay a match

```
uv run python scripts/replay_match.py --match M025 --speed 4 --sink jsonl --out m025.jsonl
```

This turns the engine events into contract v1.1 events (goal, shot, pass, foul, card, possession change), validates each one against `packages/contracts`, and writes them in match order, paced at match time divided by `--speed`. `--sink http --url <api>` posts them to `POST /v1/matches/{id}/events` in batches of 50. `--no-wait` skips the pacing.

## Make a fresh match

```
node services/simulation/run.cjs --seeds 1-1 --half 45 --events --out /tmp/mc-run
```

The same seed gives the same events. The seed alone decides the clubs, stadium, month and weather for the runner, so a seed number is a complete match id.
