# MatchCast: rules for Claude Code sessions

Read this first. Lane-specific rules live in the `CLAUDE.md` of each folder.

## What this repo is
MatchCast turns a synthetic football match into explainable insight: a four-agent pipeline on Microsoft Foundry (Producer, Analyst, Narrator, Verifier) runs behind a broadcast UI. The hackathon rules are in the project files; the 3-day plan is `plan/full-3-day-plan.md` in the project folder.

## Hard rules
- Never write a secret, key, token or `.env` value into a file, a commit or a PR. Azure access uses `az login` and managed identity. GitHub Actions uses OIDC.
- Synthetic data only. Football-realistic, never real players or clubs.
- Anything that is not really working must say **Simulated** or **Planned** in the UI.
- Write the failing test first, then the code. Before you say "done", run lint and the tests for your lane and show the output.
- One lane, one folder. Don't edit another lane's folder; ask in the project thread instead.
- Don't read built or generated files (large `index.html` builds, `players.json`). Edit the source and run the build.
- Don't change `docs/contracts.md` or the contract schemas without an agreed change.

## Commands
- `make install`: install npm and Python dependencies
- `make lint`: ruff, eslint and the contract check
- `make test`: contract build and tests, then pytest
- `make build`: production build of the web app

## Git
- Branch per lane: `lane/<name>` (for example `lane/agents`). Merge to `main` through a PR, twice a day at most.
- Commit messages say what changed and why, in plain English.

## Done means
Visible in the app, a test covers it, the README or the demo mentions it, and the handoff note is written.
