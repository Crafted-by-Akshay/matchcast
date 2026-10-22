---
name: tdd-workflow
description: Use when implementing any MatchCast story or fix: failing test first, smallest code, then refactor, with the right test layer for the change.
---

# Test-driven workflow

Test strategy: `docs/architecture/16-testing-and-quality.md`.

1. Read the story's acceptance criteria. Write one test per criterion, name it after the criterion.
2. Pick the layer: pure logic and agents = pytest in the package's `tests/`; wire formats = contract fixtures (positive and `invalid/`); api = `tests/test_api_*.py` with the FastAPI test client; UI = Playwright in `tests/e2e/`; metrics = golden cases (`packages/metrics/golden`).
3. Run it and see it fail for the right reason (not an import error). Paste that failure.
4. Write the smallest code that passes. Run the narrow test, then the lane's checks.
5. Refactor with the tests green. Add edge cases: empty input, last event, duplicate, out of order, model timeout, Verifier rejection.
6. Docs in the same change. Then `make lint typecheck test build`.

Fixed rules: seeded randomness only; `MATCHCAST_MODE=local MATCHCAST_AGENT_MODE=rules MATCHCAST_STORE=memory` for CI-style runs; no live Azure or Foundry calls (use `ScriptedModelClient` or a mock); never skip, delete or loosen a test to get green; a flaky test is fixed or reported, not retried until it passes. Tests assert behaviour users see, not internals.
