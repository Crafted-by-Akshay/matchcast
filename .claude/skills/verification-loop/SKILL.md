---
name: verification-loop
description: Use before merging any MatchCast PR: run the local checks (GitHub Actions is down), post the output on the PR, get the reviewer verdict, then merge.
---

# Verification loop (local-check merge rule)

1. Rebase or merge `origin/main` into your branch; resolve conflicts without rewriting anyone else's history.
2. Run what your change touches with `scripts/local_ci.sh`:
   - `checks`: `make install lint typecheck test build`
   - `e2e`: Playwright (`E2E_ARGS="tests/e2e/x.spec.ts"` to narrow; the full suite is slow under load; one re-run is allowed for a failure in code you did not touch, and say so)
   - `bicep`, `secrets`, `openapi`: when infra, the history or routes changed (needs `az`, `gitleaks`)
   Skipped jobs print `SKIPPED` with the reason; say that on the PR instead of hiding it.
3. Post the final `=== summary for <sha> ===` block as a PR comment, with the commit it was run on. If you pushed after, run again.
4. Ask the `reviewer` agent for a verdict in a fresh context (Opus; high effort for contracts, the audit chain, the Verifier, and Bicep or RBAC). Fix every finding or answer it in a PR comment.
5. All green and no open finding: squash merge your own PR with `AB#<id>` in the title. Then close the task in Azure Boards and write the handoff (skill `handoff`).

Never: merge on red, push an empty commit to kick CI, skip or quarantine a test, force-push shared branches, or claim a check passed that you did not run.
