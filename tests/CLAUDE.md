# Quality lane (tests/, eval/, docs/evidence/)

Read first: root `CLAUDE.md`, then `docs/architecture/16-testing-and-quality.md`, `01-goals-and-constraints.md` §5, `14-security-and-responsible-ai.md` §3-4, `17-risks-and-debt.md`.
Skills: `tdd-workflow`, `verification-loop`, `demo-ready`, `handoff`. Agents: `reviewer`, `tester`, `bug-fixer`.

- The reviewer runs in a fresh context on every lane PR; use high effort for contracts, the audit chain, the Verifier and Bicep or RBAC.
- Never skip, delete or loosen a test to get green. Report flaky tests with the failing output.
- No Azure or Foundry call in PR checks. Live specs are tagged `@live` and run by hand (`npm run e2e-live`).
- Evaluation (`eval/`): fixed moments, same seeds, report real numbers or say they are not run yet.
- Keep `scripts/local_ci.sh` coverage in step with the CI jobs; record evidence in `docs/evidence/`.
