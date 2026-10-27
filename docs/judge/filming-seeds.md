# Filming seeds: when does a goal arrive?

Measured 23 Oct 2026 and re-measured 27 Oct 2026 on main 3be6bc3 (after #463, the deterministic-maths fix). Two methods, which disagreed on 23 Oct, so the video needs one dry run on the filming machine.

## 1. The deterministic runner (fixed 0.02 s step, no rendering)

Command: `node services/simulation/run.cjs --seeds 2026,8,13,1 --half 45 --workers 4 --events --out <dir>` (full density, 90 match minutes; about 100 s a match on this machine). One seed always gives the same events here. The runner picks the two clubs from the seed. The table gives minutes only; the club is not re-read on 27 Oct.

| Seed | Goals, match minute (club) |
| --- | --- |
| 2026 | 4.2, 17.0, 34.9, 47.5, 92.2; final 4-1 |
| 1 | 6.8, 12.4, 15.6, 40.5, 52.3, 77.5, 93.4; final 6-1 |
| 13 | 37.9, 74.3, 86.7; final 1-2 |
| 8 | 20.0, 29.4, 56.3, 59.1; final 3-1 |

Across seeds 1 to 200 (`data/calibration/results/seeds-1-200-post463/summary.json`, after #463) the mean is 2.84 goals a match and 15 of 200 matches are goalless.

## 2. The live app path (frame loop with a viewing-time budget)

A headless drive of the shell (`/index.html?seed=<n>&speed=4#watch`, `__mcHeadless`, `__mcDt = 0.1`, `mc.frame(0.05)` until `S.mclock` passed 46 match minutes, then the `goal` events of `ENV.events`) gave **different matches for the same seed**:

- seed 2026: no goal before minute 46 (on 23 Oct the runner gave goals at 18.4 and 22.4; the runner now gives 4.2 and 17.0, so re-measure this);
- seed 8: goals at minutes 17 and 30 (on 23 Oct the runner gave its first goal at 51.3; it now gives 20.0).

**Cause found and fixed (Data lane, 23 Oct).** Two separate things:

1. **The URL.** The runner picks the two clubs, the stadium and the month from the seed and puts them in the query (`h=`, `a=`, `st=`, `month=`). `?seed=2026&speed=4` alone gives the shell's own fixture, so it is a different match. Get the exact URL with `node services/simulation/run.cjs --seeds 2026 --url`: seed 2026 is `/watch/index.html?seed=2026&half=45&st=1&month=3&h=NAV&a=LOM`.
2. **The engine.** `frame()` stepped the engine in `ceil(dt x speed / 0.02)` equal pieces, so the step size changed with frame time and speed, and `animate()` (the head-scan animation, frame-only) drew from the match's random stream, so the number of frames changed the match. Now the engine always steps exactly 0.02 s and carries the remainder to the next frame, and the head-scan uses its own stream. Test: `tests/e2e/sim-engine.spec.ts` ("one seed gives the same events at any frame time or playback speed") compares 0.013, 0.1 and 0.37 s of viewing time per frame, with and without the condensed director, against the runner's fixed-step loop. Checked by hand on an earlier build (re-check once before filming): with the URL above the live frame loop reproduced the runner's goals for seed 2026 at minutes 18.4 and 22.4 (LOM). That check predates #463, which moved every seed's match, so repeat it against the current runner's 4.2 and 17.0 before filming.

The speed control and the condensed fast-forward therefore change only how fast you watch, never what happens. The first section's table is valid for the live app when it is opened with the URL from `--url`.

## What to do for the video

- **Do not rely on a goal at a fixed time.** Beat 2 of `docs/judge/storyboard.md` uses the first Match Pulse card, which a shot already produces.
- **Dry run once on the filming machine** (a real GPU) with the exact filming URL, and write down the wall-clock seconds of the first card, the first goal and match minute 12 (the api's seeded bad claim starts at `seed_bad_claim_at_ms=720_000` and corrupts the first claim at or after that time, which may or may not be a goal).
- If the dry run shows no early goal on seed 2026, try seeds 1 (first goal at minute 6.8 in the runner) or 13 (37.9) with the same URL shape and keep whichever repeats on two takes. Other docs (`docs/video-script.md`, `docs/submission/shot-list.md`, `docs/judge/walkthrough.md`) still say `seed=2026`; Quality owns them and changes them after the dry run.
