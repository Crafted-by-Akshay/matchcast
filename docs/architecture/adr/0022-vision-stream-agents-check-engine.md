# ADR-0022: The Vision stream's agents count passes and check them against the engine

- **Status:** Accepted
- **Date:** 2026-10-25
- **Decided by:** Agents lane with the Experience lane, from the audit of the live app (Vision passes reached a hidden match whose agents wrote "Shots so far: 0-0")

## Context

The browser's pixel tracker sends its passes to the match `<session>.vision` (docs/architecture/09). That match has its own workflow, so the four agents run on it. Two things were wrong:

1. The Analyst's summary was hard-wired to shots. A tracker that sees only passes wrote 16 published lines, every one "Shots so far: Home 0, Away 0". The Verifier passed them because it recounted against the Vision log, which had no shots, so it checked Vision against Vision.
2. Nothing on screen showed what Vision contributed, so a viewer could not tell a measured pass count from an engine count.

## Options

1. Hide the Vision match and show nothing. Honest, but the vision story has no evidence on screen.
2. Rewire the engine match to take Vision passes into its own claims. Changes the engine record's path and every engine line, a larger risk than the time allowed.
3. Keep the Vision match as a stream of its own, make its agents count passes, have its Verifier check the counts against the engine's own passes, and show the result beside the engine's commentary.

## Decision

Option 3.

- The summary on a Vision stream counts `passes:<team>` (`VISION_COUNT_METRICS`), every `VISION_SUMMARY_MS` (60 s) of match time, at priority 3: the rules twin writes it, so the summaries cost no model call (a live model call every minute would be five times the engine's rate).
- `MatchContext.truth` carries the engine match's events into the Vision stream (`truth_feed_for`, read from the store). The Verifier's `vision` check compares each count with the engine's count at the same match time and reports the agreement. It does not block a line.
- `GET /v1/matches/{id}/vision/summary` reads the Vision stream's state and the agreement over the match.
- The engine record and the engine's lines are unchanged. Vision never writes to the engine stream.

## Consequences

- The Vision stream's lines say "Vision has tracked ..." and carry the agreement with the engine as a Verifier check, so a judge sees the measured accuracy beside the count.
- Vision's agreement is the share of Vision's passes an engine pass backs within 8 s, over the span both streams have covered. It keys on the team, the passer and the receiver, so a wrong player lowers it as well as an invented pass; it is not identity accuracy, which stays in the Tracking lab (docs/architecture/09). The Verifier's check reports this same figure, so the trace, the chip and the strip agree.
- The engine feed carries one Vision moment per match (below). Its lines are labelled Vision, and no engine line changes.
- Vision state and the `_vision_lines` counter are in memory. A restart rebuilds the passes from the store and the counter starts again at zero.
- Not checked live: gpt-5-mini on the Vision summary and the agreement numbers on a real match. The rules twin covers the pass count and its Verifier check.

## Addendum: the engine feed's one Vision moment (25 Oct)

The judges need to see Vision in the feed, not only on the Watch chip. So the engine match gets one Vision moment, once its clock reaches `WorkflowConfig.vision_moment_ms` (15 min of match time) and a pass is due:

- The moment is made by the workflow, not by the Producer, so both orchestrators run it (`_decide_moment`). Its claims are six: `vision_passes:<team>` (Vision's pass count up to the moment), `passes:<team>` (the engine's own count, as before), and `vision_precision:<team>` (the share of Vision's passes an engine pass backs, rounded to two decimals) for each team.
- The Verifier recounts `vision_passes` from the Vision passes the api gives the match as a feed (`ctx.extra["vision_passes"]`), and `vision_precision` by the same `agreement()` the summary uses. A claim it cannot recount is refused. `passes:` still recounts from the engine log.
- The Narrator states Vision's count beside the engine's, and the share as "of Vision's passes match an engine pass". Each number is a claim value.
- The match window stays at 8 s. The browser run that would size the tracker's detection lag did not finish in this sandbox, so no per-pass time claim is made: the line says what was counted, not when each pass happened.
- The engine record is still not written by Vision. The moment is a line on the engine feed, verified against both streams.

