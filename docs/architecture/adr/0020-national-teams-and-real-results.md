# ADR-0020: National teams and real past results as reference data

- **Status:** Accepted. Supersedes the fictional-names part of ADR-0012.
- **Date:** 2026-10-25
- **Decided by:** Akshay (chose "safe international mode" in the project thread)

## Context

Akshay asked for real international football: real countries, the real national teams and what
actually happened between them, so pre-match analysis and commentary can say "these two last met in
2014". The rules (official rules §4.7) require the project to use synthetic, football-realistic data,
and §4.4, §4.11 and §7 forbid third-party trademark, IP and publicity violations. The rules never name
FIFA, UEFA, clubs or players, so silence is not clearance.

The dataset (martj42 international football results, CC0) gives scorelines and dates for national
teams, not player events, and the live match stays a seeded simulation.

## Options

1. Keep fictional clubs and fictional names only (ADR-0012 as written).
2. National teams by country name and real past results as reference context; clubs, players,
   officials and every simulated event stay fictional. **Chosen.**
3. Real players and real squads, which needs written permission from the organisers first.

## Decision

- Country names and national team names may be used as facts.
- Real past results from martj42 (CC0) may be used for head-to-head, Elo, recent form and
  pre-match context. They never become the events of the live match.
- The simulated match stays seeded and synthetic. Players, managers, officials, stadium and
  match events are fictional and labelled as such.
- No FIFA or UEFA name, no federation crest or logo, no trademarked kit or sponsor marks.
- Real player names, faces and likenesses stay blocked by `tests/test_synthetic_names.py` until
  the organisers confirm in writing that they are allowed.

## Consequences

- The International mode (Elo relabel and head-to-head card in the prototype `history.js`) is the
  feature this ADR allows; its squads stay fictional.
- Tests that block real footballer surnames and require fictional clubs are unchanged, because
  they already match this rule.
- Anyone who wants real players must first get written organiser permission and then supersede this ADR.

## Affects

- CLAUDE.md (hard rule on synthetic data)
- docs/architecture/14-security-and-responsible-ai.md
- docs/architecture/adr/0012-synthetic-data-and-licences.md
