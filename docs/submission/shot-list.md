# Demo video shot list

Status: **Superseded 26 Oct** by the crew-build shot list (kept with the recording plan, outside the repo) (failure drill, Event → on air pill, Crew spawn tree, six-up desk, ten languages); this file predates the crew build and the national teams, so its fixture codes and shots are out of date. Was: **Draft**. Companion to `docs/video-script.md` (the scenes, timing and narration). This file says how to capture each shot and which proof line from `make judge-path` backs it, so the video can be re-shot from a clean machine. Under 2 minutes (rules: less than two, so end by 1:58), public, no third-party trademarks or music (rules §4.4).

## Before filming (26 Oct)

1. `make judge-path` on the filming machine. It must end `Judge path OK`. Keep the terminal output for shot 9.
2. Deployed run (preferred, rules §4.4 wants footage of the Project on its platform): `scripts/health_check.sh <api-url> <web-url>` prints `HEALTHY`; `make e2e-live E2E_BASE_URL=<web-url>` passes.
3. Fixed seed and speed so every take is identical: `?seed=2026&half=45&st=1&month=3&h=NAV&a=LOM&speed=4`, `&seedBadClaim=1` for shot 3. In the runner this match has goals at minutes 4.2, 17.0, 34.9, 47.5 and 92.2 (4-1, re-measured 27 Oct after #463); confirm on the filming machine (docs/judge/filming-seeds.md).
4. Browser at 1440 × 900, fresh profile, logged out, captions on, voice on for shot 2.
5. Run `docs/release-check.md` and write the commit in its run log.

## Shots

| # | Time | Shot | How to capture | Proof line or check behind it |
| --- | --- | --- | --- | --- |
| 1 | 0:00 – 0:10 | Title card, then Watch paused at kick-off | Web URL, Watch | `PASS  app shell has the three views` |
| 2 | 0:10 – 0:35 | Goal, Match Pulse card with a tick, spoken line, captions | Watch playing to the first goal, voice on | `PASS  match to verified claims - OK: <n> verified claims` (every spoken line is a verified claim) |
| 3 | 0:35 – 0:50 | Verifier rejects a wrong number and repairs it | Watch with `seedBadClaim=1`, trace panel open | Same line; the rejection is in the trace panel, not in the terminal |
| 4 | 0:50 – 1:05 | Casual vs Analyst mode on the same moment, then Spanish with numbers unchanged | Mode switch, then language picker | Show Spanish only if the live URL really translates (`GET /v1/status` lists `translator` as `live`, which only means the endpoint is configured, so also read the Spanish output on the deployed URL); otherwise cut it and give the time to shot 5 |
| 5 | 1:05 – 1:15 | Producer approves a line, lower-third goes on air | Broadcast, producer mode | `approval.spec.ts` passes in `make e2e` |
| 6 | 1:15 – 1:25 | Copilot Agent Mode calls the MatchCast MCP tool | VS Code screen recording, `get_state` | Needs PLT-11; if it is not recorded, cut |
| 7 | 1:25 – 1:45 | Architecture diagram | `docs/architecture/img/4-azure-deployment.png`, only boxes that are provisioned shown as solid, others labelled Planned | `GET /v1/status` on the live URL: show only `live` items as live |
| 8 | 1:45 – 1:52 | Single agent vs four agents | `docs/eval/agents-eval.md` table | Only after the eval has run; quote the file's numbers, never estimates |
| 9 | 1:52 – 1:58 | End card: repo URL and "Synthetic data only", then the `Judge path OK` terminal | Terminal capture of `make judge-path` | `Judge path OK` |

## Honesty rules for the edit

- Anything that is not running on the filmed platform carries a "Simulated" or "Planned" caption; the status document (`GET /v1/status`) is the source of truth for what may be called live.
- Cut a shot rather than fake it. Shots 4, 6 and 8 depend on deployments or runs that may slip; the script says what absorbs their time.
- Fictional club and brand names only; no real logos on the ad boards.
