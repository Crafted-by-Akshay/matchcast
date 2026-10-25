# ADR-0021: Talk reads the whole match log, by relevance

- **Status:** Accepted
- **Date:** 2026-10-25
- **Decided by:** Akshay (judge test: the player should know what happened in the match, every event and who did it)

## Context

The player's talk saw his own counts, the last eight events, and every goal and card. A fan who asks "what happened in the second half?" or "who had the ball before that?" got nothing to say. The full log is the source of truth, so the talk must read it, not guess.

## Options

1. Put the full log in every prompt. Rejected: a full match is thousands of events, which makes every talk slow and expensive.
2. Retrieve the events that match the question and the speaker, and always include the last events and every goal and card. Chosen.
3. A separate search service over the log. Rejected for now: the log is in memory and small per match, and BM25 over one line per event is enough.

## Decision

- **The log.** `match.log` holds up to 40 events that best match the question and his name (BM25 over one line per event, built from the stored events), plus the last 30 and every goal and card. Each line names the minute, the event, the player, the recipient and the club, all from the log.
- **Names.** Any player of the match may be named, by his whole name. A sentence that names another player may not carry a count; his counts are his own.
- **Minutes.** A minute may be written as `minute 12` only when an event of the match happened in that minute. Any other minute is refused. Otherwise he says "a little while ago".
- **Numbers.** Counts are still recounted from the log and written as digits with their metric (ADR-0016, ADR-0018).
- **Generic source.** Everything comes from the match context (names, clubs, events), not from a team list, so a change of teams (real national sides) needs no code change.

## Consequences

- A reply about a minute can be refused when no event happened in that minute, which is the intent: a minute is a log fact.
- Retrieval runs per talk over the events of the match so far. At the scale of one match this is milliseconds; a much longer log would need a cached index.
