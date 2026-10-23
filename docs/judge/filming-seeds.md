# Filming seeds: which seed shows a goal early

Measured 23 Oct 2026 on a software-GL machine, so the **viewing times are not real GPU times**. Match minutes are exact for a given seed. Method: open `/index.html?seed=<n>&speed=4#watch` headless (`__mcHeadless`, a fixed frame budget), run the Watch frame loop to match minute 46 and list the `goal` events. The headless check ran seeds 2026, 8, 3, 5, 11, 13, 17, 21, 31, 64, 77, 100, 2024, 2028 and 4242 in the standalone Watch page, then 8 and 2026 in the shell, which plays its own fixture (the minutes differ between the two).

| Seed | Goals before minute 46 (shell, the filming path) |
| --- | --- |
| 2026 | none |
| 8 | minute 17 (Harbor City, P. Hirahara) and minute 30 (Thames Rovers, G. Zorlav) |
| standalone Watch only, not shell | seed 8: minutes 2 and 40; seed 13: minute 24; every other seed in the list: none |

What this means for the video (`docs/judge/storyboard.md`, `docs/video-script.md`, `docs/submission/shot-list.md`):

- **The documented filming seed 2026 has no goal in the first half**, so beat 2 ("a goal arrives") cannot be filmed on it. Seed 8 has goals at minutes 17 and 30 and is the better filming seed. Goals are rare in this engine (about 0.1 to 0.2 a half in this scan, against the 2.66 a match calibration target), so any seed needs a dry run.
- Beat 2 can use the first Match Pulse card instead of a goal: a shot already produces a card with its evidence.
- The api's seeded bad claim starts at match minute 12 (`seed_bad_claim_at_ms=720_000`), so a goal at minute 17 is a claim the api Verifier can reject after the switch is on.
- **Do the timing dry run on the filming machine (a real GPU), once, with the chosen seed**, and write the real wall-clock seconds of the first card, first goal and minute 12 into the beat sheet. This machine renders about 0.1 match minutes a second in the real loop, which is far slower than a laptop GPU.

Not changed: the filming URL in other docs still says `seed=2026`. Quality owns those files; switching to seed 8 is a one-line change in each once the dry run confirms it.
