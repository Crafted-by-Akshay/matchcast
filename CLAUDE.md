# MatchCast: rules for Claude Code sessions

Read this first. Each lane folder has its own `CLAUDE.md` with only that lane's rules.
Project skills are in `.claude/skills/` (load the one that matches the task), helper agents in
`.claude/agents/`, hooks in `.claude/settings.json`.

## What this repo is
MatchCast turns a synthetic football match into explainable insight: four agents (Producer, Analyst,
Narrator, Verifier) on Microsoft Foundry sit behind a unified Watch / Analyst / Broadcast app.
The Verifier recounts every number from the stored events before a line reaches a screen.

## Hard rules
- Never write a secret, key, token or `.env` value into a file, a commit, a PR or a chat message.
  Azure access is `az login` and managed identity; GitHub Actions uses OIDC. The Azure DevOps token
  is the env var `ADO_PAT`; read it from the environment, never print it.
- Never use or set `ANTHROPIC_API_KEY` or a third-party model base URL in a build session. That moves
  the session off the Claude plan. The app's own agents call Foundry with Entra ID, no API key.
- Synthetic data only: football-realistic, never real players, clubs or events.
- Anything not really working is labelled **Simulated** or **Planned** in the UI and docs.
- Failing test first, then the code. Before you say "done", run the checks for your lane and show the output.
- One lane, one folder (table in `docs/architecture/19-engineering-practices.md` §1). A change in
  another lane's folder goes through a PR that lane reviews.
- Do not read built or generated files: `apps/unified/**/index.html` builds, `players.json`,
  `intl.json`, `apps/unified/sources/**` (read-only prototype copy), `uv.lock`, `package-lock.json`.
  Edit the source and run the build.
- Contract changes (`packages/contracts`, `docs/contracts.md`) need all-lane agreement first.
- Randomness only through seeded sub-streams. No live Azure or Foundry call in PR checks.
- Azure: provisioning in `rg-matchcast` is pre-authorised within the agreed budget caps. Never delete
  resources, never exceed the caps, stop and ask for a real blocker only (missing permission,
  cost above cap, destructive action).

## Architecture (read before coding)
Source of truth: docs/architecture/README.md. If code and docs disagree, stop and say so.
- Every task: 01-goals-and-constraints.md §4-5, 19-engineering-practices.md, 18-glossary.md
- Platform lane: 13-deployment-and-operations.md, 14-security-and-responsible-ai.md, 15-observability.md, adr/0005-0008
- Agents lane: 04-agents.md, 05-assistant-rag.md, 12-api.md, 03-runtime-flows.md (F1-F6, F8-F10), adr/0002, 0009, 0013, 0014
- Experience lane: 11-frontend.md, 10-voice-and-translation.md, 12-api.md §2-3, 03-runtime-flows.md (F1, F3-F6)
- Data lane: 06-simulation.md, 07-data-and-storage.md, 08-analytics-and-ml.md, 09-vision-identification.md, adr/0004, 0006, 0007, 0010, 0012, 0015
- Quality lane: 16-testing-and-quality.md, 01-goals-and-constraints.md §5, 14-security-and-responsible-ai.md §3-4, 17-risks-and-debt.md
- Changing a contract: docs/contracts.md first, then 07-data-and-storage.md
- A decision not covered: write an ADR from adr/0000-template.md in the same PR

## Commands
- `make install` · `make lint` (ruff, eslint, contract drift) · `make typecheck` · `make test` · `make build`
- `make e2e` (Playwright, Chromium); `E2E_ARGS="tests/e2e/x.spec.ts" make e2e` to narrow
- `scripts/local_ci.sh [checks e2e bicep secrets openapi]`: the CI jobs on this machine

## Git and merging
- Branch `<lane>/<AB id>-<slug>`; commit and PR titles carry `AB#<id>`; squash merge; small PRs. Doc 19 §2 sets merge windows 13:00 and 21:00 local; Akshay's Oct 22 "everything autonomous" rule means merge when green, so treat the windows as a batching preference.
- GitHub Actions is off on purpose (it costs money; both workflows are manual-only). The local-check merge rule: run `scripts/local_ci.sh` for the affected jobs,
  paste the summary block into the PR as a comment, get the reviewer agent's verdict on a fresh
  context, resolve its findings in a PR comment, then merge your own PR.
- Update the matching `docs/architecture/` file in the same PR as the behaviour.

## Done means
Visible in the app, a test covers it, docs say it, the handoff note is written (skill `handoff`).
