# Match metrics (`packages/metrics`)

One deterministic library used by the Analyst (to state a number) and the Verifier (to recompute it).
Positions are metres on a 105 x 68 pitch. `attack_x` is the x of the goal the team attacks (105 or 0).
Every function has a semver in `matchcast_metrics.DERIVATION_VERSIONS`; claims record it as `derivation_version`.
A formula change bumps the version and regenerates `golden/golden.json`.

| Function | Version | Returns | Formula |
| --- | --- | --- | --- |
| `xg(shot, state)` | 1.0.0 | 0 to 1 | `1 / (1 + e^-(b0 + b1·angle + b2·distance))`, angle = angle the goal mouth subtends (rad), distance in m. Penalty 0.76; header x0.8; nearest defender within 2 m x0.7; clamped 0.005 to 0.95. Constants in `data/calibration/xg.json` (Wyscout, CC BY 4.0) |
| `pass_difficulty(pass, state)` | 1.0.0 | 0 to 100 | Sum of rounded terms: distance `30·clamp((d-2)/48)`, pressure `18·clamp((5-nearest opponent to passer)/4)`, lane `22·clamp((4-lane margin)/6)`, marking `15·clamp((5-nearest opponent to receiver)/4)`, flight 7 if lofted + 5 if through ball or cross, weak foot 8. Lane margin = smallest opponent distance to the pass line, capped at 6 m |
| `pass_quality(pass, state)` | 1.0.0 | 0 to 1 | `outcome · (0.2 + 0.4·difficulty/100 + 0.4·progression)`; outcome 1 if completed else 0.25; progression = `clamp(forward gain / 30 m)` |
| `ball_speed_kmh(samples, event_time_ms)` | 1.0.0 | km/h | 3D distance between first and last tracking sample within ±500 ms of the event, over their time gap |
| `pressure_index(x, y, state, radius_m=5)` | 1.0.0 | 0 to 1 | `0.7·clamp((radius - nearest)/(radius - 1)) + 0.3·min(opponents within radius, 3)/3` |
| `moment_score(events, minute, goal_margin)` | 1.0.0 | 0 to 100 | Highest event score (goal 80, penalty 70, red card 65, shot `25 + 120·xG` capped 25 to 75, corner 20, yellow 15, foul 10, pass 5), +10 per further event (max +30), x1.1 from minute 75, x1.1 when margin ≤ 1 |

## Testing against the prototype

`golden/export_golden.cjs` writes 54 seeded cases with expected values from JavaScript reference formulas. The xG curve and the pass-difficulty terms are copied from the prototype engine (`apps/unified/sources/3d-source/v2/main.js` `xgAt`, `explain.js` `passDifficulty`); the other formulas are the ones in the table. `uv run pytest packages/metrics` requires every case to match within 0.001, calls `xg` twice for identical results, and checks the constants against `data/calibration/xg.json`.

Python rounds half to even and JavaScript rounds half up, so the difficulty terms use `floor(v + 0.5)`.
