## Story

AB#<work item id> — <one line on what this PR delivers>

<!-- The PR title starts with the same AB#<id> so Azure Boards links it. -->

## What changed and why

<!-- A short paragraph. Link the architecture file you updated. -->

## Checklist (the reviewer checks every line)

- [ ] Scope matches the story's acceptance criteria and stays inside this lane's folders
- [ ] Tests added for new logic; each acceptance criterion has a test or a recorded manual check
- [ ] `make lint typecheck test build` passes
- [ ] No secrets, keys or tokens in the diff
- [ ] UI labels honest: "Simulated" wherever an Azure service is not connected
- [ ] Contracts unchanged, or `docs/contracts.md` was agreed by all lanes first
- [ ] Docs updated (the matching `docs/architecture/` file; new ADR if a decision changed)
- [ ] New dependencies have an allowed licence (MIT, BSD, Apache-2.0, ISC, CC0, CC BY)

## Evidence

<!-- Test output, screenshot or recording. Infra PRs: bicep build and azd preview. -->
