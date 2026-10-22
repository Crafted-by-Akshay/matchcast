---
name: verifier-rules
description: Use when adding or changing Verifier checks, tolerances, persona limits, repair or abstain behaviour, or the seeded bad-claim demo.
---

# Verifier rules

Spec: `docs/architecture/04-agents.md` §5. Code: `packages/agents/matchcast_agents/verify/checks.py`, `rules/verifier.py`, `live/verifier.py`, `metrics_spec.py`, `personas.py`.

## Checks in order (first failure decides)
1 sources exist at the cited revision (exact) · 2 freshness (snapshot revision within 5, match time within 30 s) · 3 numbers (every number in the line appears in a claim and each claim value is recomputed: counts exact, ratios 0.01, km/h 0.5, metres 0.5) · 4 names in the roster · 5 persona limits (casual 140 chars and 1 number; analyst 280 and 6; broadcast 180 and 2; watch modes map to these) · 6 citations (Ask only) · 7 safety (Content Safety severity under 2) · 8 meaning (model, runs only if 1 to 7 pass; `unclear` gives `review`).
In rules mode check 8 is skipped; a template line is `verified`, anything else is `review`.

## Principles
- Recount from the stored events with `recompute()` (counts) or `packages/metrics` (xG and the rest). Never trust agent state. `EPSILON` absorbs float noise.
- Verdicts attach to lines, not claims (ADR-0013). Audit actions: `line_verified`, `line_review`, `line_rejected`, `line_repair_requested`, `line_abstained`.
- A rejected line gets exactly one repair: number, source or freshness errors go to the Analyst; wording errors to the Narrator. Second rejection is `line_abstained`; publish nothing.
- Translations are re-checked: numbers and names must survive (ADR-0011); a failing translation is `translation_rejected` and the English line stands.
- Changing a tolerance or a persona limit changes `derivation_version` and the doc table in the same PR.

## Tests
Each check needs a passing and a failing case in `packages/agents/tests/test_verifier.py`, plus a repair case and an abstain case. The red-team set is `tests/test_redteam.py`; the demo scene uses `seed_bad_claim` (`X-MatchCast-Seed-Bad-Claim: 1` or `?seedBadClaim=1`).
