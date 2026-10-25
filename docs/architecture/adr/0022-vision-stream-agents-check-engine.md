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
- Vision's agreement is the share of Vision's passes an engine pass backs within 8 s, over the span both streams have covered. It is precision, not identity accuracy; identity stays in the Tracking lab (docs/architecture/09).
- The engine's agents do not yet cite Vision in engine lines. That is a later change that needs its own ADR.
- Vision state and the `_vision_lines` counter are in memory. A restart rebuilds the passes from the store and the counter starts again at zero.
- Not checked live: gpt-5-mini on the Vision summary and the agreement numbers on a real match. The rules twin covers the pass count and its Verifier check.
