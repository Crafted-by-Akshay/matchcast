# Filming seeds: when does a goal arrive?

Measured 23 Oct 2026. Two methods, which disagree, so the video needs one dry run on the filming machine.

## 1. The deterministic runner (fixed 0.02 s step, no rendering)

Command: `node services/simulation/run.cjs --seeds 2026,8,13,1 --half 45 --workers 4 --events --out <dir>` (full density, 90 match minutes; about 100 s a match on this machine). One seed always gives the same events here. The runner picks the two clubs from the seed.

| Seed | Goals, match minute (club) |
| --- | --- |
| 2026 | 18.4 (LOM), 22.4 (LOM), 36.3 (NAV), 37.1 (NAV), 54.3 (LOM), 68.7 (LOM); final 2-4 |
| 1 | 7.4 (HAR), 92.6 (HAR), 94.0 (HAR); final 3-0 |
| 13 | 10.2 (MON), 66.7 (GUA), 76.3 (GUA); final 1-2 |
| 8 | 51.3, 64.1, 66.9, 70.7, 76.5; final 2-3 (first shot at 14.0) |

Across seeds 1 to 200 (`data/calibration/results/seeds-1-200/summary.json`) the mean is 2.90 goals a match and 19 of 200 matches are goalless.

## 2. The live app path (frame loop with a viewing-time budget)

A headless drive of the shell (`/index.html?seed=<n>&speed=4#watch`, `__mcHeadless`, `__mcDt = 0.1`, `mc.frame(0.05)` until `S.mclock` passed 46 match minutes, then the `goal` events of `ENV.events`) gave **different matches for the same seed**:

- seed 2026: no goal before minute 46 (the runner gives goals at 18.4 and 22.4);
- seed 8: goals at minutes 17 and 30 (the runner gives its first goal at 51.3).

So the live path is not step-identical to the runner. Likely reasons: `speed=4` and the frame time change the step the engine integrates with, and the shell plays its own fixture clubs rather than the runner's seed-picked pair. This was not isolated here, and the scan used a software-GL machine, so treat it as a warning, not a finding about a GPU. It is a Data-lane question: whether a seed should give the same match at any speed and frame rate.

## What to do for the video

- **Do not rely on a goal at a fixed time.** Beat 2 of `docs/judge/storyboard.md` uses the first Match Pulse card, which a shot already produces.
- **Dry run once on the filming machine** (a real GPU) with the exact filming URL, and write down the wall-clock seconds of the first card, the first goal and match minute 12 (the api's seeded bad claim starts at `seed_bad_claim_at_ms=720_000` and corrupts the first claim at or after that time, which may or may not be a goal).
- If the dry run shows no early goal on seed 2026, try seeds 1 (goal at minute 7.4 in the runner) or 13 (10.2) with the same URL shape and keep whichever repeats on two takes. Other docs (`docs/video-script.md`, `docs/submission/shot-list.md`, `docs/judge/walkthrough.md`) still say `seed=2026`; Quality owns them and changes them after the dry run.
